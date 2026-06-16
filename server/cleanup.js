/* ============================================================
   cleanup.js — borra sesiones y reportes vencidos (filas + carpetas).
   Lo usa server.js (al boot + cada 6 h) y también se puede correr a mano:
       node cleanup.js
   (útil como cron/systemd-timer aparte si se prefiere).
============================================================ */
'use strict';

const path = require('path');
const fs = require('fs');
const db = require('./db');

function rmDir(dir) {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) { /* ya no estaba */ }
}

function cleanupExpired(now = Date.now()) {
  // 1) juntar los ids/tokens vencidos ANTES de borrar las filas
  const sessionIds = db.expiredSessionIds(now);
  const reportTokens = db.expiredReportTokens(now);

  // 2) borrar las carpetas de disco
  for (const id of sessionIds) rmDir(path.join(db.SESSIONS_DIR, id));
  for (const token of reportTokens) rmDir(path.join(db.REPORTS_DIR, token));

  // 3) borrar las filas
  const deleted = db.deleteExpiredRows(now);

  return { sessions: sessionIds.length, reports: reportTokens.length, ...deleted };
}

module.exports = { cleanupExpired };

// Ejecución directa: `node cleanup.js`
if (require.main === module) {
  const res = cleanupExpired();
  console.log(`[cleanup] borradas ${res.sessions} sesiones y ${res.reports} reportes vencidos.`);
}
