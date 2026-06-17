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
  return new Promise((resolve, reject) => {
    if (!_cfgOk()) return reject(new Error('Logger bridge no configurado (LOGGER_BRIDGE_URL / LOGGER_BRIDGE_TOKEN).'));
    _get(pathAndQuery, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        let json = null;
        try { json = JSON.parse(body); } catch (_) {}
        if (res.statusCode >= 200 && res.statusCode < 300) return resolve(json || {});
        reject(new Error((json && json.error) ? json.error : `HTTP ${res.statusCode}`));
      });
    }, reject);
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
 * Baja un bloque del logger por código y lo escribe en disco.
 * @param {{radio:string, code:string}} sel
 * @param {string} destNoExt - ruta destino SIN extensión (se agrega según el archivo).
 * @returns {Promise<string>} ruta final del archivo escrito.
 */
function downloadBlock({ radio, code }, destNoExt) {
  return new Promise((resolve, reject) => {
    if (!_cfgOk()) return reject(new Error('Logger bridge no configurado.'));
    const qs = new URLSearchParams({ radio: radio || 'mitre', code }).toString();
    _get('/api/hdx/logger/audio?' + qs, (res) => {
      if (res.statusCode !== 200) {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          let msg = `HTTP ${res.statusCode}`;
          try { const j = JSON.parse(Buffer.concat(chunks).toString('utf8')); if (j.error) msg = j.error; } catch (_) {}
          reject(new Error(`Descarga de ${code} falló: ${msg}`));
        });
        return;
      }
      let ext = '.wav';
      const cd = res.headers['content-disposition'] || '';
      const m = /filename="?[^"]*?(\.[A-Za-z0-9]{1,5})"?\s*$/.exec(cd);
      if (m) ext = m[1];
      const dest = destNoExt + ext;
      const ws = fs.createWriteStream(dest);
      res.pipe(ws);
      ws.on('finish', () => resolve(dest));
      ws.on('error', reject);
      res.on('error', reject);
    }, reject);
  });
}

module.exports = { listLoggerRadios, listLoggerBlocks, downloadBlock, isConfigured: _cfgOk };
