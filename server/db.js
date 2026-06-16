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

/* ---------------- sessions ---------------- */
const _insertSession = db.prepare(`
  INSERT INTO sessions (id, file_name, audio_file, audio_mime, transcript_json, brands_json, created_at, expires_at)
  VALUES (@id, @file_name, @audio_file, @audio_mime, @transcript_json, @brands_json, @created_at, @expires_at)
`);
const _getSession = db.prepare(`SELECT * FROM sessions WHERE id = ?`);
const _listSessions = db.prepare(`
  SELECT id, file_name, transcript_json, brands_json, created_at, expires_at
  FROM sessions WHERE expires_at > ? ORDER BY created_at DESC LIMIT 200
`);
const _updateBrands = db.prepare(`UPDATE sessions SET brands_json = ? WHERE id = ?`);

function createSession(row) { _insertSession.run(row); return row; }
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
  createReport, getReport,
  reportTokensForSession, deleteSession,
  expiredSessionIds, expiredReportTokens, deleteExpiredRows,
};
