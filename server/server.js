/* ============================================================
   server.js — Verificador de menciones (backend)
   - Sirve el frontend estático + la API + el visor de reportes.
   - Persistencia 21 días desde la carga del audio (sessions).
   - Reportes compartibles por token, standalone, públicos (reports).
   - El recorte de clips se hace EN EL BROWSER. La concatenación de varios audios
     y la transcripción automática (AssemblyAI→Whisper) corren acá en un job de a uno.

   Auth: Basic Auth (en la app) sobre la herramienta interna.
         Público: /health, /r/:token, /report.js, /api/reports/*.
============================================================ */
'use strict';

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const multer = require('multer');
const db = require('./db');
const audioLib = require('./audio');
const { transcribe } = require('./transcribe');
const { cleanupExpired } = require('./cleanup');
const hdxBridge = require('./hdx-bridge');

/* ---------------- .env mínimo (sin dependencias) ---------------- */
(function loadEnv() {
  const p = path.join(__dirname, '.env');
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Za-z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (!m) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (!(m[1] in process.env)) process.env[m[1]] = v;
  }
})();

/* ---------------- config ---------------- */
const PORT = Number(process.env.PORT) || 8090;
const APP_USER = process.env.APP_USER || '';        // si está vacío → auth deshabilitada (dev local)
const APP_PASSWORD = process.env.APP_PASSWORD || '';
const RETENTION_DAYS = Number(process.env.RETENTION_DAYS) || 21;
const RETENTION_MS = RETENTION_DAYS * 24 * 60 * 60 * 1000;
const PUBLIC_BASE_URL = (process.env.PUBLIC_BASE_URL || '').replace(/\/+$/, '');
const LOGGER_MAX_AUDIO_SEC = Number(process.env.LOGGER_MAX_AUDIO_SEC) || 7 * 3600;  // guarda dura (franja capada a 6h + bloques de borde)

const MAX_AUDIO_BYTES = 250 * 1024 * 1024;  // audio completo por sesión
const MAX_CLIP_BYTES = 40 * 1024 * 1024;    // un clip de mención
const MAX_FIELD_BYTES = 30 * 1024 * 1024;   // transcript JSON puede ser grande
const MAX_CLIPS = 800;

const ROOT = path.join(__dirname, '..');    // archivos del frontend (index.html, app.js, ...)
const ASSETS_DIR = path.join(ROOT, 'assets');
const AUDIO_EXTS = new Set(['.mp3', '.wav', '.m4a', '.ogg', '.oga', '.aac', '.flac', '.webm', '.mp4']);

/* ---------------- helpers ---------------- */
const newId = (bytes) => crypto.randomBytes(bytes).toString('base64url');
const idOk = (s) => typeof s === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(s);
const rmDir = (dir) => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {} };

function safeEq(a, b) {
  const ab = Buffer.from(String(a)), bb = Buffer.from(String(b));
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}
function baseUrl(req) {
  if (PUBLIC_BASE_URL) return PUBLIC_BASE_URL;
  return `${req.protocol}://${req.get('host')}`;
}
function audioExt(name) {
  const e = (path.extname(name || '') || '').toLowerCase();
  return AUDIO_EXTS.has(e) ? e : '.bin';
}

/* ---------------- app ---------------- */
const app = express();
app.disable('x-powered-by');
app.set('trust proxy', true);   // respeta X-Forwarded-Proto detrás de Caddy

/* ===========================================================
   RUTAS PÚBLICAS (sin auth) — van ANTES del gate de Basic Auth
=========================================================== */
app.get('/health', (_req, res) => res.json({ status: 'ok' }));

// visor de reportes (standalone) + su script
app.get('/report.js', (_req, res) => res.sendFile(path.join(ROOT, 'report.js')));
app.get('/r/:token', (_req, res) => res.sendFile(path.join(ROOT, 'report.html')));

// JSON de un reporte (lo que ve la marca) — público por token
app.get('/api/reports/:token', (req, res) => {
  const { token } = req.params;
  if (!idOk(token)) return res.status(404).json({ error: 'expired_or_missing' });
  const r = db.getReport(token);
  if (!r) return res.status(404).json({ error: 'expired_or_missing' });

  let fragments = [];
  try { fragments = JSON.parse(r.mentions_json) || []; } catch (_) {}
  const mentions = fragments.map((m, i) => ({
    t: m.t, clock: m.clock || null, start: m.start, end: m.end, dur: m.dur, text: m.text, ranges: m.ranges || [],
    clipUrl: (m.clip != null) ? `/api/reports/${token}/clip/${m.clip}` : null,
  }));
  const mentionCount = fragments.reduce((a, m) => a + (Array.isArray(m.ranges) ? m.ranges.length : 1), 0);
  const totalSec = fragments.reduce((a, m) => a + (Number(m.dur) || 0), 0);

  res.json({
    brandTerm: r.brand_term,
    brandColor: safeJson(r.brand_color_json, {}),
    programName: r.program_name || '',
    noAudio: !!r.no_audio,
    mentions, mentionCount, fragmentCount: fragments.length, totalSec,
    createdAt: r.created_at, expiresAt: r.expires_at,
  });
});

// un clip de audio del reporte — público por token
app.get('/api/reports/:token/clip/:i', (req, res) => {
  const { token, i } = req.params;
  if (!idOk(token) || !/^\d{1,4}$/.test(i)) return res.status(404).end();
  if (!db.getReport(token)) return res.status(404).end();
  const file = path.join(db.REPORTS_DIR, token, `clip-${i}.wav`);
  res.sendFile(file, (err) => { if (err && !res.headersSent) res.status(404).end(); });
});

function safeJson(s, fallback) { try { return JSON.parse(s); } catch (_) { return fallback; } }

/* ===========================================================
   BASIC AUTH GATE — todo lo de abajo es la herramienta interna
=========================================================== */
app.use((req, res, next) => {
  if (!APP_USER) return next();   // auth deshabilitada (dev local sin .env)
  const hdr = req.headers.authorization || '';
  const [scheme, encoded] = hdr.split(' ');
  if (scheme === 'Basic' && encoded) {
    const [user, pass] = Buffer.from(encoded, 'base64').toString('utf8').split(':');
    if (safeEq(user || '', APP_USER) && safeEq(pass || '', APP_PASSWORD)) return next();
  }
  res.set('WWW-Authenticate', 'Basic realm="Verificador de menciones", charset="UTF-8"');
  return res.status(401).send('Autenticación requerida.');
});

app.use(express.json({ limit: '4mb' }));   // para PUT brands (no afecta multipart)

/* ---------------- sessions (persistencia 21 días) ---------------- */
const uploadSession = multer({
  storage: multer.diskStorage({
    destination: (req, _file, cb) => {
      const dir = path.join(db.SESSIONS_DIR, req.sessionId, 'raw');
      fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    // los archivos llegan en el orden en que el front los agregó al FormData
    filename: (req, file, cb) => { req._n = (req._n || 0); cb(null, 'src-' + String(req._n++).padStart(3, '0') + audioExt(file.originalname)); },
  }),
  limits: { fileSize: MAX_AUDIO_BYTES, fieldSize: MAX_FIELD_BYTES, files: 50, fields: 12 },
});
const assignSessionId = (req, _res, next) => { req.sessionId = newId(12); req._n = 0; next(); };

/* ---- job de a uno: concatena los audios (en orden) y los transcribe ---- */
let _jobBusy = false; const _jobQ = [];
function enqueueJob(fn) { _jobQ.push(fn); pumpJobs(); }
async function pumpJobs() {
  if (_jobBusy) return;
  const fn = _jobQ.shift(); if (!fn) return;
  _jobBusy = true;
  try { await fn(); } catch (e) { console.error('[job] error', e); }
  finally { _jobBusy = false; pumpJobs(); }
}
// concat (en orden) + transcribe + guardar resultado. Compartido por la carga
// manual (processSession) y la carga desde el aire (processLoggerSession).
async function buildAndTranscribe(id, rawPaths) {
  const dir = path.join(db.SESSIONS_DIR, id);
  const outPath = path.join(dir, 'audio.mp3');
  const { duration } = await audioLib.concat(rawPaths, outPath);
  const segments = await transcribe(outPath, { language: 'es' });
  if (!segments.length) throw new Error('La transcripción no devolvió texto.');
  db.setSessionResult(id, {
    audio_file: 'audio.mp3', audio_mime: 'audio/mpeg',
    transcript_json: JSON.stringify(segments),
    duration: duration || segments[segments.length - 1].end || 0,
  });
  return { segments: segments.length, duration };
}

async function processSession(id, rawPaths) {
  const dir = path.join(db.SESSIONS_DIR, id);
  try {
    const { segments, duration } = await buildAndTranscribe(id, rawPaths);
    console.log(`[job] sesión ${id} lista (${segments} segmentos, ${Math.round(duration)}s).`);
  } catch (e) {
    db.updateSessionStatus(id, 'error', String((e && e.message) || e).slice(0, 500));
    console.error(`[job] sesión ${id} error:`, (e && e.message) || e);
  } finally {
    rmDir(path.join(dir, 'raw'));
  }
}

// Carga desde el aire: baja los bloques del logger (vía bridge) a raw/ y reusa
// el mismo concat + transcribe. La hora de inicio ya se setea en el endpoint.
async function processLoggerSession(id, radio, blocks) {
  const dir = path.join(db.SESSIONS_DIR, id);
  const rawDir = path.join(dir, 'raw');
  try {
    fs.mkdirSync(rawDir, { recursive: true });
    const rawPaths = [];
    for (let i = 0; i < blocks.length; i++) {
      const dest = path.join(rawDir, 'src-' + String(i).padStart(3, '0'));
      rawPaths.push(await hdxBridge.downloadBlock({ radio, code: blocks[i].code }, dest));
      console.log(`[job] logger ${id}: bloque ${i + 1}/${blocks.length} bajado (${blocks[i].code}).`);
    }
    const { segments } = await buildAndTranscribe(id, rawPaths);
    console.log(`[job] sesión logger ${id} lista (${blocks.length} bloques, ${segments} segmentos).`);
  } catch (e) {
    db.updateSessionStatus(id, 'error', String((e && e.message) || e).slice(0, 500));
    console.error(`[job] sesión logger ${id} error:`, (e && e.message) || e);
  } finally {
    rmDir(rawDir);
  }
}

// crear sesión: subir VARIOS audios (en orden) → se concatenan y transcriben (async).
// También acepta `transcript` directo (lo usa el audio de ejemplo: no transcribe).
app.post('/api/sessions', assignSessionId, uploadSession.array('audios', 50), (req, res) => {
  const dir = path.join(db.SESSIONS_DIR, req.sessionId);
  try {
    const files = req.files || [];
    if (!files.length) { rmDir(dir); return res.status(400).json({ error: 'Subí al menos un audio.' }); }
    const sourceNames = files.map(f => f.originalname);
    const programName = String(req.body.fileName || sourceNames[0] || 'programa').slice(0, 200);
    let brands = safeJson(req.body.brands, []); if (!Array.isArray(brands)) brands = [];
    const created_at = Date.now();
    const expires_at = created_at + RETENTION_MS;

    // modo directo (audio de ejemplo): un audio + transcripción provista, sin transcribir.
    const direct = safeJson(req.body.transcript, null);
    if (Array.isArray(direct) && direct.length) {
      const f = files[0];
      const audioName = 'audio' + audioExt(f.originalname);
      fs.renameSync(f.path, path.join(dir, audioName));
      rmDir(path.join(dir, 'raw'));
      db.createSession({
        id: req.sessionId, file_name: programName,
        audio_file: audioName, audio_mime: f.mimetype || 'audio/wav',
        transcript_json: JSON.stringify(direct), brands_json: JSON.stringify(brands),
        created_at, expires_at, status: 'ready',
        source_names_json: JSON.stringify(sourceNames),
        duration: direct[direct.length - 1].end || 0,
      });
      return res.json({ id: req.sessionId, status: 'ready', createdAt: created_at, expiresAt: expires_at });
    }

    // modo normal: crear 'processing' y encolar concat + transcripción.
    const rawPaths = files.map(f => f.path);
    db.createSession({
      id: req.sessionId, file_name: programName,
      audio_file: null, audio_mime: null, transcript_json: '[]', brands_json: JSON.stringify(brands),
      created_at, expires_at, status: 'processing',
      source_names_json: JSON.stringify(sourceNames), duration: null,
    });
    res.json({ id: req.sessionId, status: 'processing', createdAt: created_at, expiresAt: expires_at });
    enqueueJob(() => processSession(req.sessionId, rawPaths));
  } catch (e) {
    rmDir(dir);
    if (!res.headersSent) res.status(500).json({ error: 'No se pudo crear la sesión.' });
  }
});

/* ---------------- cargar desde el aire (logger HDX vía bridge) ---------------- */
// radios disponibles (para el selector; hoy solo Mitre)
app.get('/api/logger/radios', async (_req, res) => {
  try { res.json(await hdxBridge.listLoggerRadios()); }
  catch (e) { res.status(502).json({ error: e.message }); }
});

// preview: qué bloques cubren la franja (para mostrar "N bloques, ~1h30" antes de cargar)
app.get('/api/logger/preview', async (req, res) => {
  const radio = String(req.query.radio || 'mitre');
  const date = String(req.query.date || '');
  const from = String(req.query.from || '');
  const to = String(req.query.to || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ error: 'Fecha inválida (YYYY-MM-DD).' });
  if (!/^\d{1,2}:\d{2}$/.test(from) || !/^\d{1,2}:\d{2}$/.test(to)) return res.status(400).json({ error: 'Horas inválidas (HH:MM).' });
  try { res.json(await hdxBridge.listLoggerBlocks({ radio, date, from, to })); }
  catch (e) { res.status(502).json({ error: e.message }); }
});

// crear sesión desde el aire: baja los bloques que cubren la franja y los transcribe (async).
app.post('/api/sessions/from-logger', async (req, res) => {
  const radio = String((req.body && req.body.radio) || 'mitre');
  const date = String((req.body && req.body.date) || '');
  const from = String((req.body && req.body.from) || '');
  const to = String((req.body && req.body.to) || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ error: 'Fecha inválida (YYYY-MM-DD).' });
  if (!/^\d{1,2}:\d{2}$/.test(from) || !/^\d{1,2}:\d{2}$/.test(to)) return res.status(400).json({ error: 'Horas inválidas (HH:MM).' });

  let preview;
  try { preview = await hdxBridge.listLoggerBlocks({ radio, date, from, to }); }
  catch (e) { return res.status(502).json({ error: 'No se pudo consultar el aire: ' + e.message }); }

  const blocks = Array.isArray(preview.blocks) ? preview.blocks : [];
  if (!blocks.length) return res.status(404).json({ error: 'No se encontraron bloques del aire para esa franja.' });
  if ((preview.totalDurationSec || 0) > LOGGER_MAX_AUDIO_SEC) {
    return res.status(400).json({ error: 'El audio supera el máximo permitido (6 h por carga).' });
  }

  const id = newId(12);
  const dir = path.join(db.SESSIONS_DIR, id);
  try {
    fs.mkdirSync(dir, { recursive: true });
    const created_at = Date.now();
    const expires_at = created_at + RETENTION_MS;
    const label = preview.label || radio;
    const fileName = `Aire ${label} ${date} ${from}-${to}`;
    db.createSession({
      id, file_name: fileName,
      audio_file: null, audio_mime: null, transcript_json: '[]', brands_json: '[]',
      created_at, expires_at, status: 'processing',
      source_names_json: JSON.stringify(blocks.map(b => b.title)), duration: null,
    });
    if (preview.startOffsetSec != null) db.updateStartOffset(id, preview.startOffsetSec);
    res.json({
      id, status: 'processing', createdAt: created_at, expiresAt: expires_at,
      blockCount: blocks.length, totalDurationSec: preview.totalDurationSec || 0,
    });
    enqueueJob(() => processLoggerSession(id, radio, blocks));
  } catch (e) {
    rmDir(dir);
    if (!res.headersSent) res.status(500).json({ error: 'No se pudo crear la sesión.' });
  }
});

// listar audios recientes (no vencidos)
app.get('/api/sessions', (_req, res) => {
  const rows = db.listSessions().map((s) => ({
    id: s.id, fileName: s.file_name, createdAt: s.created_at, expiresAt: s.expires_at,
    status: s.status || 'ready',
    segmentCount: safeJson(s.transcript_json, []).length,
    brandCount: safeJson(s.brands_json, []).length,
  }));
  res.json({ sessions: rows, retentionDays: RETENTION_DAYS });
});

// reabrir una sesión (incluye estado de transcripción)
app.get('/api/sessions/:id', (req, res) => {
  if (!idOk(req.params.id)) return res.status(404).json({ error: 'not_found' });
  const s = db.getSession(req.params.id);
  if (!s) return res.status(404).json({ error: 'not_found' });
  res.json({
    id: s.id, fileName: s.file_name, createdAt: s.created_at, expiresAt: s.expires_at,
    status: s.status || 'ready', errorMsg: s.error_msg || null, duration: s.duration || 0,
    sourceNames: safeJson(s.source_names_json, []),
    startOffset: (s.start_offset == null ? null : s.start_offset),
    segments: safeJson(s.transcript_json, []), brands: safeJson(s.brands_json, []),
    hasAudio: !!s.audio_file,
  });
});

// servir el audio completo (privado) — con Range automático
app.get('/api/sessions/:id/audio', (req, res) => {
  if (!idOk(req.params.id)) return res.status(404).end();
  const s = db.getSession(req.params.id);
  if (!s || !s.audio_file) return res.status(404).end();
  res.sendFile(path.join(db.SESSIONS_DIR, s.id, s.audio_file), (err) => {
    if (err && !res.headersSent) res.status(404).end();
  });
});

// guardar marcas (debounced desde el front)
app.put('/api/sessions/:id/brands', (req, res) => {
  if (!idOk(req.params.id)) return res.status(404).json({ error: 'not_found' });
  if (!db.getSession(req.params.id)) return res.status(404).json({ error: 'not_found' });
  const brands = Array.isArray(req.body && req.body.brands) ? req.body.brands : null;
  if (!brands) return res.status(400).json({ error: 'brands inválido.' });
  db.updateBrands(req.params.id, JSON.stringify(brands));
  res.json({ ok: true });
});

// renombrar (poner un título para reconocer la transcripción después)
app.put('/api/sessions/:id/title', (req, res) => {
  if (!idOk(req.params.id)) return res.status(404).json({ error: 'not_found' });
  if (!db.getSession(req.params.id)) return res.status(404).json({ error: 'not_found' });
  const title = String((req.body && req.body.title) || '').trim().slice(0, 200);
  if (!title) return res.status(400).json({ error: 'Título vacío.' });
  db.updateTitle(req.params.id, title);
  res.json({ ok: true, title });
});

// hora de inicio del audio (para calcular el horario real de cada segmento/mención)
app.put('/api/sessions/:id/start', (req, res) => {
  if (!idOk(req.params.id)) return res.status(404).json({ error: 'not_found' });
  if (!db.getSession(req.params.id)) return res.status(404).json({ error: 'not_found' });
  let sec = req.body && req.body.startSeconds;
  if (sec === null || sec === '' || typeof sec === 'undefined') sec = null;
  else { sec = Math.floor(Number(sec)); if (!isFinite(sec) || sec < 0 || sec > 86399) return res.status(400).json({ error: 'startSeconds inválido (0-86399 o null).' }); }
  db.updateStartOffset(req.params.id, sec);
  res.json({ ok: true, startOffset: sec });
});

/* ---------------- reports (links compartibles) ---------------- */
const requireSession = (req, res, next) => {
  if (!idOk(req.params.id)) return res.status(404).json({ error: 'Sesión no encontrada o vencida.' });
  const s = db.getSession(req.params.id);
  if (!s) return res.status(404).json({ error: 'Sesión no encontrada o vencida.' });
  req.session = s; next();
};
const assignReportToken = (req, _res, next) => { req.reportToken = newId(16); next(); };

// generar el reporte de una marca: el front manda las menciones (timestamps + texto); el backend
// RECORTA los clips del audio de la sesión con ffmpeg (sirve para audios largos, sin decodificar en el browser).
app.post('/api/sessions/:id/reports', requireSession, assignReportToken, async (req, res) => {
  const token = req.reportToken;
  const dir = path.join(db.REPORTS_DIR, token);
  try {
    const s = req.session;
    const mentions = Array.isArray(req.body && req.body.mentions) ? req.body.mentions : null;
    if (!mentions || !mentions.length) return res.status(400).json({ error: 'mentions inválido.' });
    const brand_term = String(req.body.brandTerm || '').trim().slice(0, 200);
    if (!brand_term) return res.status(400).json({ error: 'Falta la marca.' });

    fs.mkdirSync(dir, { recursive: true });
    const audioPath = s.audio_file ? path.join(db.SESSIONS_DIR, s.id, s.audio_file) : null;
    const hasAudio = !!(audioPath && fs.existsSync(audioPath));

    const fragments = [];
    let clipIndex = 0;
    for (const m of mentions) {
      const start = Math.max(0, Number(m.start) || 0);
      const end = Number(m.end) || 0;
      let clip = null;
      if (hasAudio && end > start) {
        try {
          await audioLib.clip(audioPath, Math.max(0, start - 0.3), end + 0.3, path.join(dir, 'clip-' + clipIndex + '.wav'));
          clip = clipIndex; clipIndex++;
        } catch (e) { /* este fragmento queda sin audio */ }
      }
      fragments.push({
        t: String(m.t || ''), clock: m.clock || null, start, end, dur: Math.max(0, end - start),
        text: String(m.text || ''), ranges: Array.isArray(m.ranges) ? m.ranges : [], clip,
      });
    }
    const noAudio = !fragments.some(f => f.clip != null);

    const created_at = Date.now();
    const expires_at = s.expires_at;   // hereda: 21 días desde la carga del audio
    db.createReport({
      token, session_id: s.id, brand_term,
      brand_color_json: JSON.stringify((req.body && req.body.brandColor) || {}),
      mentions_json: JSON.stringify(fragments),
      program_name: String((req.body && req.body.programName) || s.file_name || '').slice(0, 200),
      no_audio: noAudio ? 1 : 0, created_at, expires_at,
    });
    res.json({ token, url: `${baseUrl(req)}/r/${token}`, createdAt: created_at, expiresAt: expires_at });
  } catch (e) {
    rmDir(dir);
    res.status(500).json({ error: 'No se pudo generar el reporte.' });
  }
});

// descartar (borrar) una sesión: su audio + todos los reportes generados para sus marcas
app.delete('/api/sessions/:id', (req, res) => {
  if (!idOk(req.params.id)) return res.status(404).json({ error: 'not_found' });
  const id = req.params.id;
  const tokens = db.reportTokensForSession(id);
  for (const t of tokens) rmDir(path.join(db.REPORTS_DIR, t));
  const changes = db.deleteSession(id);
  rmDir(path.join(db.SESSIONS_DIR, id));
  if (!changes) return res.status(404).json({ error: 'not_found' });
  res.json({ ok: true, reportsDeleted: tokens.length });
});

/* ---------------- frontend estático (herramienta interna) ---------------- */
app.get('/', (_req, res) => res.sendFile(path.join(ROOT, 'index.html')));
app.get('/index.html', (_req, res) => res.sendFile(path.join(ROOT, 'index.html')));
app.get('/app.js', (_req, res) => res.sendFile(path.join(ROOT, 'app.js')));
app.get('/colors_and_type.css', (_req, res) => res.sendFile(path.join(ROOT, 'colors_and_type.css')));
app.use('/assets', express.static(ASSETS_DIR, { fallthrough: false }));

/* ---------------- manejo de errores (multer, etc.) ---------------- */
app.use((err, _req, res, _next) => {
  if (err instanceof multer.MulterError) {
    const msg = err.code === 'LIMIT_FILE_SIZE' ? 'Archivo demasiado grande.' : ('Error de subida: ' + err.code);
    return res.status(413).json({ error: msg });
  }
  if (err) return res.status(500).json({ error: 'Error interno.' });
  res.status(404).end();
});

/* ---------------- arranque + limpieza programada ---------------- */
function sweep() {
  try {
    const r = cleanupExpired();
    if (r.sessions || r.reports) console.log(`[cleanup] ${r.sessions} sesiones y ${r.reports} reportes vencidos borrados.`);
  } catch (e) { console.error('[cleanup] error', e); }
}
try { const n = db.failStaleProcessing(); if (n) console.log(`[boot] ${n} sesión(es) 'processing' interrumpidas → error.`); } catch (_) {}
sweep();
setInterval(sweep, 6 * 60 * 60 * 1000).unref();   // cada 6 h

app.listen(PORT, () => {
  console.log(`Verificador de menciones — backend en http://localhost:${PORT}`);
  console.log(`  retención: ${RETENTION_DAYS} días · Basic Auth: ${APP_USER ? 'ON' : 'OFF (dev)'}`);
});
