/* ============================================================
   hdx-bridge.js — cliente del "logger bridge" de cronograma.

   HDX vive en la red corp y solo es alcanzable a través del túnel que termina
   en el EC2 de cronograma. Comercial corre en OTRA caja (Lightsail), así que
   no puede hablar con HDX directo: le pega por HTTPS a los endpoints que expone
   cronograma (/api/hdx/logger*), autenticados con un bearer token propio.

   Auth:
     - token del bridge → va como ?token= (lo lee requireBridgeToken en cronograma).
       Se manda por query (no header) para no chocar con la basic-auth de nginx.
     - basic-auth de nginx (opcional) → header Authorization: Basic, si se configura
       LOGGER_BRIDGE_BASIC ("user:pass"). Así funciona sin tocar la config de nginx.

   Env:
     LOGGER_BRIDGE_URL    https://cronograma.cienradios.com
     LOGGER_BRIDGE_TOKEN  <secreto compartido con cronograma>
     LOGGER_BRIDGE_BASIC  user:pass  (creds basic-auth de nginx; opcional)
============================================================ */
'use strict';

const http = require('http');
const https = require('https');
const fs = require('fs');
const { URL } = require('url');

const TIMEOUT_MS = 180000; // bajar un bloque de 30 min puede tardar

// Reintentos para la descarga de bloques. El túnel cronograma↔HDX a veces corta la
// conexión a mitad de transferencia ("socket hang up" / ECONNRESET) o devuelve un 5xx
// transitorio; es pasajero, así que reintentamos con backoff antes de dar por muerta
// toda la franja por un solo bloque. Los 4xx (bloque inexistente, etc.) NO se reintentan.
const DL_MAX_ATTEMPTS = 3;           // 1 intento + 2 reintentos
const DL_BACKOFF_MS = [1500, 4000];  // espera antes del reintento 1 y 2

const _delay = (ms) => new Promise((r) => setTimeout(r, ms));
// ¿el error pinta transitorio? Vale tanto para errores de transporte locales como para
// el {error} que reenvía cronograma cuando se le cae la conexión a HDX.
const _isTransientMsg = (msg) =>
  /socket hang up|ECONNRESET|ETIMEDOUT|ECONNREFUSED|EPIPE|ENETUNREACH|EAI_AGAIN|timeout|reset/i.test(String(msg || ''));
const _isTransientStatus = (code) => code === 429 || code === 502 || code === 503 || code === 504;

// --- helpers de logging: para ver bien QUÉ hop falla y QUÉ devolvió cronograma ---
const _short = (s, n = 400) => { s = String(s == null ? '' : s); return s.length > n ? `${s.slice(0, n)}…(+${s.length - n}b)` : s; };
const _mb = (bytes) => `${(bytes / 1048576).toFixed(2)}MB`;
// Headers que ayudan a ubicar de qué lado vino la respuesta o el corte (nada sensible: sin token ni auth).
function _diagHeaders(h) {
  const out = {};
  for (const k of ['content-type', 'content-length', 'server', 'via', 'x-cache', 'age', 'connection', 'date']) {
    if (h && h[k] != null) out[k] = h[k];
  }
  return out;
}

// El env se lee LAZY (en cada llamada): server.js carga el .env DESPUÉS de los require(),
// así que leerlo a nivel módulo daría siempre vacío.
function _cfg() {
  return {
    url: (process.env.LOGGER_BRIDGE_URL || '').replace(/\/+$/, ''),
    token: process.env.LOGGER_BRIDGE_TOKEN || '',
    basic: process.env.LOGGER_BRIDGE_BASIC || '',
  };
}
function _cfgOk() { const c = _cfg(); return !!(c.url && c.token); }

function _get(pathAndQuery, onResponse, reject) {
  const c = _cfg();
  const u = new URL(c.url + pathAndQuery);
  u.searchParams.set('token', c.token);
  const mod = u.protocol === 'https:' ? https : http;
  const headers = {};
  if (c.basic) headers['Authorization'] = 'Basic ' + Buffer.from(c.basic).toString('base64');
  const req = mod.request(u, { method: 'GET', headers, timeout: TIMEOUT_MS }, onResponse);
  req.on('error', reject);
  req.on('timeout', () => { req.destroy(); reject(new Error('Timeout hablando con el logger bridge')); });
  req.end();
  return req;
}

function _requestJson(pathAndQuery) {
  const ep = pathAndQuery.split('?')[0]; // sin query → no logea el token
  return new Promise((resolve, reject) => {
    if (!_cfgOk()) return reject(new Error('Logger bridge no configurado (LOGGER_BRIDGE_URL / LOGGER_BRIDGE_TOKEN).'));
    const t0 = Date.now();
    _get(pathAndQuery, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        let json = null;
        try { json = JSON.parse(body); } catch (_) {}
        if (res.statusCode >= 200 && res.statusCode < 300) return resolve(json || {});
        console.error(`[logger] ${ep}: cronograma HTTP ${res.statusCode} tras ${Date.now() - t0}ms · headers=${JSON.stringify(_diagHeaders(res.headers))} · body=${_short(body)}`);
        reject(new Error((json && json.error) ? json.error : `HTTP ${res.statusCode}`));
      });
    }, (e) => {
      console.error(`[logger] ${ep}: fallo de conexión con cronograma (${(e && e.code) || (e && e.message)}) tras ${Date.now() - t0}ms`);
      reject(e);
    });
  });
}

/** Lista de radios con logger disponible. → { loggers: [{id,label}] } */
async function listLoggerRadios() {
  return _requestJson('/api/hdx/loggers');
}

/** Preview de bloques que cubren la franja (sin bajar audio). */
async function listLoggerBlocks({ radio, date, from, to }) {
  const qs = new URLSearchParams({ radio: radio || 'mitre', date, from, to }).toString();
  return _requestJson('/api/hdx/logger?' + qs);
}

/**
 * Un solo intento de descarga. Loguea el detalle del fallo y clasifica el `.hop`
 * (connect | timeout | upstream | stream) para distinguir qué tramo cortó, y
 * marca `.retryable` para que el wrapper decida.
 */
function _downloadBlockOnce({ radio, code }, destNoExt, attemptLabel) {
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    const tag = `[logger] ${code} (intento ${attemptLabel})`;
    const qs = new URLSearchParams({ radio: radio || 'mitre', code }).toString();
    const req = _get('/api/hdx/logger/audio?' + qs, (res) => {
      const status = res.statusCode;

      // (A) cronograma respondió con error. OJO: esto NO es un corte de la conexión
      // comercial↔cronograma (esa anduvo: llegó una respuesta HTTP completa). Casi siempre
      // es cronograma reenviando un fallo de SU túnel a HDX. Logueamos status+headers+body.
      if (status !== 200) {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('error', (e) => {
          console.error(`${tag}: HTTP ${status} pero se cortó leyendo el body (${(e && e.code) || (e && e.message)}) tras ${Date.now() - t0}ms`);
          e.hop = 'upstream'; e.status = status; e.retryable = true; reject(e);
        });
        res.on('end', () => {
          const ms = Date.now() - t0;
          const body = Buffer.concat(chunks).toString('utf8');
          let parsed = null; try { parsed = JSON.parse(body); } catch (_) {}
          const upstreamErr = (parsed && parsed.error) ? String(parsed.error) : null;
          console.error(`${tag}: cronograma HTTP ${status} tras ${ms}ms · headers=${JSON.stringify(_diagHeaders(res.headers))} · body=${_short(body)}`);
          const err = new Error(`Descarga de ${code} falló: cronograma HTTP ${status}${upstreamErr ? ` — ${upstreamErr}` : ''}`);
          err.hop = 'upstream'; err.status = status; err.upstreamError = upstreamErr;
          err.retryable = _isTransientStatus(status) || _isTransientMsg(upstreamErr || body);
          reject(err);
        });
        return;
      }

      // (B) 200: stream del audio a disco, contando bytes para detectar cortes/truncados.
      let ext = '.wav';
      const cd = res.headers['content-disposition'] || '';
      const m = /filename="?[^"]*?(\.[A-Za-z0-9]{1,5})"?\s*$/.exec(cd);
      if (m) ext = m[1];
      const dest = destNoExt + ext;
      const expected = Number(res.headers['content-length']) || 0; // bytes esperados (si vino el header)
      const ws = fs.createWriteStream(dest); // flag 'w': trunca cualquier parcial de un intento previo
      let received = 0, settled = false;
      res.on('data', (c) => { received += c.length; });

      // (C) corte a mitad de stream: la conexión murió DESPUÉS de los headers 200 — típico
      // de transferencias largas que atraviesan proxies (idle/transfer timeout, reset). El
      // parcial no se usa (no se resuelve dest) y lo pisa el próximo intento o el rmDir final.
      const failStream = (e) => {
        if (settled) return; settled = true;
        const ms = Date.now() - t0;
        const why = (e && e.code) || (e && e.message) || 'desconocido';
        try { req.destroy(); } catch (_) {}
        try { ws.destroy(); } catch (_) {}
        console.error(`${tag}: corte a mitad de descarga (${why}) tras ${ms}ms — ${_mb(received)}${expected ? ' de ' + _mb(expected) : ''}`);
        const err = e || new Error('stream interrumpido');
        err.message = `Descarga de ${code} cortada a mitad (${why}) — ${_mb(received)}${expected ? ' de ' + _mb(expected) : ''}`;
        err.hop = 'stream'; err.retryable = true;
        reject(err);
      };
      res.pipe(ws);
      ws.on('finish', () => {
        if (settled) return; settled = true;
        // (D) cierre "limpio" pero corto: cronograma mandó FIN antes de completar content-length.
        // Sin esto se concatenaría audio truncado como si estuviera OK.
        if (expected && received < expected) {
          console.error(`${tag}: descarga incompleta tras ${Date.now() - t0}ms — ${_mb(received)} de ${_mb(expected)} (content-length no cuadra)`);
          const err = new Error(`Descarga de ${code} incompleta — ${_mb(received)} de ${_mb(expected)}`);
          err.hop = 'stream'; err.retryable = true;
          return reject(err);
        }
        console.log(`${tag}: OK ${_mb(received)} en ${Date.now() - t0}ms`);
        resolve(dest);
      });
      ws.on('error', failStream);
      res.on('error', failStream);
    }, (e) => {
      // (E) error de transporte ANTES de la respuesta, o timeout esperándola: comercial no
      // pudo hablar con cronograma. ESTO sí sería "la conexión de cronograma falla".
      const ms = Date.now() - t0;
      const isTimeout = /timeout/i.test((e && e.message) || '');
      const why = (e && e.code) || (e && e.message) || 'error';
      e.hop = isTimeout ? 'timeout' : 'connect'; e.retryable = true;
      e.message = isTimeout
        ? `Descarga de ${code} falló: timeout (>${Math.round(TIMEOUT_MS / 1000)}s) esperando a cronograma`
        : `Descarga de ${code} falló: sin respuesta de cronograma (${why})`;
      console.error(`${tag}: ${isTimeout ? 'timeout' : 'fallo de conexión'} con cronograma (${why}) tras ${ms}ms`);
      reject(e);
    });
  });
}

/**
 * Baja un bloque del logger por código y lo escribe en disco.
 * Reintenta con backoff ante cortes transitorios del túnel cronograma↔HDX
 * (socket hang up / ECONNRESET / timeout / 5xx). Los 4xx no se reintentan.
 * @param {{radio:string, code:string}} sel
 * @param {string} destNoExt - ruta destino SIN extensión (se agrega según el archivo).
 * @returns {Promise<string>} ruta final del archivo escrito.
 */
async function downloadBlock({ radio, code }, destNoExt) {
  if (!_cfgOk()) throw new Error('Logger bridge no configurado.');
  let lastErr;
  for (let attempt = 1; attempt <= DL_MAX_ATTEMPTS; attempt++) {
    try {
      return await _downloadBlockOnce({ radio, code }, destNoExt, `${attempt}/${DL_MAX_ATTEMPTS}`);
    } catch (e) {
      lastErr = e;
      const where = e && e.hop ? `[${e.hop}${e.status ? ' ' + e.status : ''}]` : ''; // ej. [upstream 502], [stream], [timeout]
      if (!e || e.retryable !== true || attempt === DL_MAX_ATTEMPTS) {
        console.error(`[logger] ${code}: SE RINDE tras ${attempt} intento(s) ${where} — ${e && e.message}`);
        throw e;
      }
      const wait = DL_BACKOFF_MS[attempt - 1] || 4000;
      console.warn(`[logger] ${code}: intento ${attempt}/${DL_MAX_ATTEMPTS} falló ${where} — reintento en ${Math.round(wait / 1000)}s`);
      await _delay(wait);
    }
  }
  throw lastErr; // inalcanzable
}

module.exports = { listLoggerRadios, listLoggerBlocks, downloadBlock, isConfigured: _cfgOk };
