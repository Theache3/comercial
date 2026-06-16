/* ============================================================
   db.js — almacenamiento (SQLite vía better-sqlite3)
   Todo el storage vive detrás de este módulo: si algún día se
   cambia el motor (DynamoDB, Postgres), solo se toca este archivo.

   Modelo:
     sessions  — un audio cargado (audio completo en disco + transcript + marcas).
                 Vence a los RETENTION_DAYS días DE LA CARGA.
     reports   — la vista que ve UNA marca (solo sus clips + sus menciones).
                 Hereda expires_at de su sesión (21 días desde la carga del audio).
============================================================ */
'use strict';

const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

// data/ guarda la DB y los archivos (audios completos + clips). Va en .gitignore.
const DATA_DIR = path.join(__dirname, 'data');
const SESSIONS_DIR = path.join(DATA_DIR, 'sessions');
const REPORTS_DIR = path.join(DATA_DIR, 'reports');
for (const d of [DATA_DIR, SESSIONS_DIR, REPORTS_DIR]) fs.mkdirSync(d, { recursive: true });

const db = new Database(path.join(DATA_DIR, 'menciones.db'));
db.pragma('journal_mode = WAL');   // mejor concurrencia lectura/escritura
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS sessions (
    id              TEXT PRIMARY KEY,
    file_name       TEXT NOT NULL,
    audio_file      TEXT,                       -- nombre del archivo dentro de sessions/<id>/
    audio_mime      TEXT,
    transcript_json TEXT NOT NULL,
    brands_json     TEXT NOT NULL DEFAULT '[]',
    created_at      INTEGER NOT NULL,
    expires_at      INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS reports (
    token            TEXT PRIMARY KEY,
    session_id       TEXT NOT NULL,
    brand_term       TEXT NOT NULL,
    brand_color_json TEXT NOT NULL,
    mentions_json    TEXT NOT NULL,
    program_name     TEXT,
    no_audio         INTEGER NOT NULL DEFAULT 0,
    created_at       INTEGER NOT NULL,
    expires_at       INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);
  CREATE INDEX IF NOT EXISTS idx_sessions_created ON sessions(created_at);
  CREATE INDEX IF NOT EXISTS idx_reports_expires  ON reports(expires_at);
  CREATE INDEX IF NOT EXISTS idx_reports_session  ON reports(session_id);
`);

// migración idempotente: columnas para "varios audios + transcripción asíncrona".
function ensureColumn(table, col, ddl) {
  const has = db.prepare(`PRAGMA table_info(${table})`).all().some(c => c.name === col);
  if (!has) db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
}
ensureColumn('sessions', 'status', "status TEXT NOT NULL DEFAULT 'ready'");
ensureColumn('sessions', 'error_msg', 'error_msg TEXT');
ensureColumn('sessions', 'duration', 'duration REAL');
ensureColumn('sessions', 'source_names_json', 'source_names_json TEXT');

/* ---------------- sessions ---------------- */
const _insertSession = db.prepare(`
  INSERT INTO sessions (id, file_name, audio_file, audio_mime, transcript_json, brands_json, created_at, expires_at, status, error_msg, duration, source_names_json)
  VALUES (@id, @file_name, @audio_file, @audio_mime, @transcript_json, @brands_json, @created_at, @expires_at, @status, @error_msg, @duration, @source_names_json)
`);
const _getSession = db.prepare(`SELECT * FROM sessions WHERE id = ?`);
const _listSessions = db.prepare(`
  SELECT id, file_name, transcript_json, brands_json, created_at, expires_at, status
  FROM sessions WHERE expires_at > ? ORDER BY created_at DESC LIMIT 200
`);
const _updateBrands = db.prepare(`UPDATE sessions SET brands_json = ? WHERE id = ?`);
const _updateStatus = db.prepare(`UPDATE sessions SET status = @status, error_msg = @error_msg WHERE id = @id`);
const _setResult = db.prepare(`UPDATE sessions SET status = 'ready', error_msg = NULL, audio_file = @audio_file, audio_mime = @audio_mime, transcript_json = @transcript_json, duration = @duration WHERE id = @id`);
const _failStale = db.prepare(`UPDATE sessions SET status = 'error', error_msg = 'Interrumpido por reinicio del servidor' WHERE status = 'processing'`);

function createSession(row) {
  _insertSession.run({
    id: row.id, file_name: row.file_name,
    audio_file: row.audio_file ?? null, audio_mime: row.audio_mime ?? null,
    transcript_json: row.transcript_json ?? '[]', brands_json: row.brands_json ?? '[]',
    created_at: row.created_at, expires_at: row.expires_at,
    status: row.status ?? 'ready', error_msg: row.error_msg ?? null,
    duration: row.duration ?? null, source_names_json: row.source_names_json ?? null,
  });
  return row;
}
function updateSessionStatus(id, status, error_msg = null) { return _updateStatus.run({ id, status, error_msg }).changes > 0; }
function setSessionResult(id, r) { return _setResult.run({ id, audio_file: r.audio_file, audio_mime: r.audio_mime, transcript_json: r.transcript_json, duration: r.duration ?? null }).changes > 0; }
function failStaleProcessing() { return _failStale.run().changes; }
function getSession(id, now = Date.now()) {
  const s = _getSession.get(id);
  if (!s || s.expires_at <= now) return null;
  return s;
}
function listSessions(now = Date.now()) { return _listSessions.all(now); }
function updateBrands(id, brandsJson) { return _updateBrands.run(brandsJson, id).changes > 0; }

/* ---------------- reports ---------------- */
const _insertReport = db.prepare(`
  INSERT INTO reports (token, session_id, brand_term, brand_color_json, mentions_json, program_name, no_audio, created_at, expires_at)
  VALUES (@token, @session_id, @brand_term, @brand_color_json, @mentions_json, @program_name, @no_audio, @created_at, @expires_at)
`);
const _getReport = db.prepare(`SELECT * FROM reports WHERE token = ?`);

function createReport(row) { _insertReport.run(row); return row; }
function getReport(token, now = Date.now()) {
  const r = _getReport.get(token);
  if (!r || r.expires_at <= now) return null;
  return r;
}

/* ---------------- borrar una sesión (descartar audio) ---------------- */
const _reportTokensBySession = db.prepare(`SELECT token FROM reports WHERE session_id = ?`);
const _delReportsBySession = db.prepare(`DELETE FROM reports WHERE session_id = ?`);
const _delSession = db.prepare(`DELETE FROM sessions WHERE id = ?`);
function reportTokensForSession(id) { return _reportTokensBySession.all(id).map(r => r.token); }
function deleteSession(id) { _delReportsBySession.run(id); return _delSession.run(id).changes; }

/* ---------------- cleanup (vencidos) ---------------- */
const _expiredSessions = db.prepare(`SELECT id FROM sessions WHERE expires_at <= ?`);
const _expiredReports = db.prepare(`SELECT token FROM reports WHERE expires_at <= ?`);
const _delExpiredSessions = db.prepare(`DELETE FROM sessions WHERE expires_at <= ?`);
const _delExpiredReports = db.prepare(`DELETE FROM reports WHERE expires_at <= ?`);

function expiredSessionIds(now = Date.now()) { return _expiredSessions.all(now).map(r => r.id); }
function expiredReportTokens(now = Date.now()) { return _expiredReports.all(now).map(r => r.token); }
function deleteExpiredRows(now = Date.now()) {
  const r = _delExpiredReports.run(now).changes;
  const s = _delExpiredSessions.run(now).changes;
  return { reports: r, sessions: s };
}

module.exports = {
  db,
  DATA_DIR, SESSIONS_DIR, REPORTS_DIR,
  createSession, getSession, listSessions, updateBrands,
  updateSessionStatus, setSessionResult, failStaleProcessing,
  createReport, getReport,
  reportTokensForSession, deleteSession,
  expiredSessionIds, expiredReportTokens, deleteExpiredRows,
};
