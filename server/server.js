/* ============================================================
   server.js — Verificador de menciones (backend)
   - Sirve el frontend estático + la API + el visor de reportes.
   - Persistencia 21 días desde la carga del audio (sessions).
   - Reportes compartibles por token, standalone, públicos (reports).
   - El recorte de audio se hace EN EL BROWSER; acá solo se guarda/sirve
     (idle ~100 MB, sin ffmpeg server-side) → entra en la caja compartida.

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
const { cleanupExpired } = require('./cleanup');

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
    t: m.t, start: m.start, end: m.end, dur: m.dur, text: m.text, ranges: m.ranges || [],
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
      const dir = path.join(db.SESSIONS_DIR, req.sessionId);
      fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename: (_req, file, cb) => cb(null, 'audio' + audioExt(file.originalname)),
  }),
  limits: { fileSize: MAX_AUDIO_BYTES, fieldSize: MAX_FIELD_BYTES, files: 1, fields: 12 },
});
const assignSessionId = (req, _res, next) => { req.sessionId = newId(12); next(); };

// crear sesión (subir audio + transcript + marcas)
app.post('/api/sessions', assignSessionId, uploadSession.single('audio'), (req, res) => {
  const partialDir = path.join(db.SESSIONS_DIR, req.sessionId);
  try {
    if (!req.file) return res.status(400).json({ error: 'Falta el archivo de audio.' });
    const segs = safeJson(req.body.transcript, null);
    if (!Array.isArray(segs) || !segs.length) { rmDir(partialDir); return res.status(400).json({ error: 'Transcript inválido (se espera un array de segmentos).' }); }
    let brands = safeJson(req.body.brands, []);
    if (!Array.isArray(brands)) brands = [];

    const created_at = Date.now();
    const expires_at = created_at + RETENTION_MS;
    db.createSession({
      id: req.sessionId,
      file_name: String(req.body.fileName || req.file.originalname || 'audio').slice(0, 200),
      audio_file: path.basename(req.file.path),
      audio_mime: req.file.mimetype || 'application/octet-stream',
      transcript_json: JSON.stringify(segs),
      brands_json: JSON.stringify(brands),
      created_at, expires_at,
    });
    res.json({ id: req.sessionId, createdAt: created_at, expiresAt: expires_at });
  } catch (e) {
    rmDir(partialDir);
    res.status(500).json({ error: 'No se pudo guardar la sesión.' });
  }
});

// listar audios recientes (no vencidos)
app.get('/api/sessions', (_req, res) => {
  const rows = db.listSessions().map((s) => ({
    id: s.id, fileName: s.file_name, createdAt: s.created_at, expiresAt: s.expires_at,
    segmentCount: safeJson(s.transcript_json, []).length,
    brandCount: safeJson(s.brands_json, []).length,
  }));
  res.json({ sessions: rows, retentionDays: RETENTION_DAYS });
});

// reabrir una sesión
app.get('/api/sessions/:id', (req, res) => {
  if (!idOk(req.params.id)) return res.status(404).json({ error: 'not_found' });
  const s = db.getSession(req.params.id);
  if (!s) return res.status(404).json({ error: 'not_found' });
  res.json({
    id: s.id, fileName: s.file_name, createdAt: s.created_at, expiresAt: s.expires_at,
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

/* ---------------- reports (links compartibles) ---------------- */
const uploadReport = multer({
  storage: multer.diskStorage({
    destination: (req, _file, cb) => {
      const dir = path.join(db.REPORTS_DIR, req.reportToken);
      fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename: (req, file, cb) => {
      // el front manda clip-<i>.wav; validamos el nombre y si no, numeramos.
      const ok = /^clip-\d{1,4}\.wav$/.test(file.originalname);
      cb(null, ok ? file.originalname : `clip-${req._ci++}.wav`);
    },
  }),
  limits: { fileSize: MAX_CLIP_BYTES, fieldSize: MAX_FIELD_BYTES, files: MAX_CLIPS, fields: 12 },
});
const requireSession = (req, res, next) => {
  if (!idOk(req.params.id)) return res.status(404).json({ error: 'Sesión no encontrada o vencida.' });
  const s = db.getSession(req.params.id);
  if (!s) return res.status(404).json({ error: 'Sesión no encontrada o vencida.' });
  req.session = s; next();
};
const assignReportToken = (req, _res, next) => { req.reportToken = newId(16); req._ci = 0; next(); };

// generar el reporte de una marca (recibe los clips ya recortados en el browser)
app.post('/api/sessions/:id/reports', requireSession, assignReportToken, uploadReport.array('clips', MAX_CLIPS), (req, res) => {
  const partialDir = path.join(db.REPORTS_DIR, req.reportToken);
  try {
    const fragments = safeJson(req.body.mentions, null);
    if (!Array.isArray(fragments) || !fragments.length) { rmDir(partialDir); return res.status(400).json({ error: 'mentions inválido.' }); }
    const brand_term = String(req.body.brandTerm || '').trim().slice(0, 200);
    if (!brand_term) { rmDir(partialDir); return res.status(400).json({ error: 'Falta la marca.' }); }

    const created_at = Date.now();
    const expires_at = req.session.expires_at;   // hereda: 21 días desde la carga del audio
    db.createReport({
      token: req.reportToken,
      session_id: req.session.id,
      brand_term,
      brand_color_json: JSON.stringify(safeJson(req.body.brandColor, {})),
      mentions_json: JSON.stringify(fragments),
      program_name: String(req.body.programName || req.session.file_name || '').slice(0, 200),
      no_audio: (req.body.noAudio === '1' || req.body.noAudio === 'true') ? 1 : 0,
      created_at, expires_at,
    });
    res.json({ token: req.reportToken, url: `${baseUrl(req)}/r/${req.reportToken}`, createdAt: created_at, expiresAt: expires_at });
  } catch (e) {
    rmDir(partialDir);
    res.status(500).json({ error: 'No se pudo generar el reporte.' });
  }
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
sweep();
setInterval(sweep, 6 * 60 * 60 * 1000).unref();   // cada 6 h

app.listen(PORT, () => {
  console.log(`Verificador de menciones — backend en http://localhost:${PORT}`);
  console.log(`  retención: ${RETENTION_DAYS} días · Basic Auth: ${APP_USER ? 'ON' : 'OFF (dev)'}`);
});
