/* ============================================================
   transcribe.js — transcripción automática (español).
   Estrategia: AssemblyAI primario; si falla o no hay key → OpenAI Whisper.
   Devuelve segmentos [{start,end,text,words?}] con tiempos en SEGUNDOS,
   en el formato exacto que ya consume la app.
   Sólo fetch nativo (Node 18+) + ffmpeg (vía ./audio) para el chunking de Whisper.
============================================================ */
'use strict';

const fs = require('fs');
const path = require('path');
const audio = require('./audio');

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const aaiKey = () => process.env.ASSEMBLYAI_API_KEY || '';
const oaiKey = () => process.env.OPENAI_API_KEY || '';

async function transcribe(filePath, opts = {}) {
  const language = opts.language || 'es';
  const errs = [];
  if (aaiKey()) {
    try { return await viaAssemblyAI(filePath, language); }
    catch (e) { errs.push('AssemblyAI: ' + (e && e.message || e)); }
  }
  if (oaiKey()) {
    try { return await viaWhisper(filePath, language); }
    catch (e) { errs.push('Whisper: ' + (e && e.message || e)); }
  }
  throw new Error(errs.length
    ? errs.join(' | ')
    : 'No hay API key de transcripción (configurá ASSEMBLYAI_API_KEY u OPENAI_API_KEY en server/.env).');
}

/* ---------------- AssemblyAI ---------------- */
async function viaAssemblyAI(filePath, language) {
  const key = aaiKey();
  const base = 'https://api.assemblyai.com/v2';
  const H = { authorization: key };

  // 1) upload (streameado, sin cargar el archivo entero en RAM)
  const up = await fetch(base + '/upload', {
    method: 'POST',
    headers: { ...H, 'content-type': 'application/octet-stream' },
    body: fs.createReadStream(filePath),
    duplex: 'half',
  });
  if (!up.ok) throw new Error('upload ' + up.status);
  const { upload_url } = await up.json();

  // 2) crear transcript
  const cr = await fetch(base + '/transcript', {
    method: 'POST',
    headers: { ...H, 'content-type': 'application/json' },
    body: JSON.stringify({ audio_url: upload_url, language_code: language, punctuate: true, format_text: true }),
  });
  if (!cr.ok) throw new Error('create ' + cr.status);
  const created = await cr.json();
  const id = created.id;
  if (!id) throw new Error('sin id de transcript');

  // 3) poll (hasta ~40 min)
  let status = created.status || 'queued';
  for (let i = 0; i < 800 && status !== 'completed'; i++) {
    await sleep(3000);
    const pr = await fetch(base + '/transcript/' + id, { headers: H });
    if (!pr.ok) throw new Error('poll ' + pr.status);
    const j = await pr.json();
    status = j.status;
    if (status === 'error') throw new Error(j.error || 'estado error');
  }
  if (status !== 'completed') throw new Error('timeout esperando la transcripción');

  // 4) oraciones → segmentos (si no hay, armar desde words)
  const sr = await fetch(base + '/transcript/' + id + '/sentences', { headers: H });
  if (sr.ok) {
    const sj = await sr.json();
    const sents = (sj && sj.sentences) || [];
    if (sents.length) {
      return sents.map(s => ({
        start: ms(s.start), end: ms(s.end), text: norm(s.text),
        words: Array.isArray(s.words) ? s.words.map(w => ({ word: w.text, start: ms(w.start), end: ms(w.end) })) : undefined,
      })).filter(x => x.text);
    }
  }
  const pr2 = await fetch(base + '/transcript/' + id, { headers: H });
  const j2 = await pr2.json();
  return wordsToSegments(j2.words || []);
}

const ms = (v) => (Number(v) || 0) / 1000;
const norm = (t) => String(t == null ? '' : t).normalize('NFC').trim();

function wordsToSegments(words) {
  const segs = []; let cur = null;
  for (const w of words) {
    const t = String(w.text || '');
    if (!cur) cur = { start: ms(w.start), end: ms(w.end), text: t, words: [] };
    else { cur.text += ' ' + t; cur.end = ms(w.end); }
    cur.words.push({ word: t, start: ms(w.start), end: ms(w.end) });
    if (/[.?!…]$/.test(t) || cur.words.length >= 14) { cur.text = norm(cur.text); segs.push(cur); cur = null; }
  }
  if (cur) { cur.text = norm(cur.text); segs.push(cur); }
  return segs.filter(s => s.text);
}

/* ---------------- OpenAI Whisper (fallback) ---------------- */
const WHISPER_LIMIT = 24 * 1024 * 1024; // un poco por debajo de los 25MB

async function viaWhisper(filePath, language) {
  const size = fs.statSync(filePath).size;
  if (size <= WHISPER_LIMIT) return whisperOne(filePath, language, 0);

  const outDir = filePath + '.chunks';
  const chunks = await audio.splitByTime(filePath, 15 * 60, outDir); // trozos de 15 min
  const all = [];
  try {
    for (const c of chunks) all.push(...await whisperOne(c.path, language, c.offset));
  } finally {
    try { fs.rmSync(outDir, { recursive: true, force: true }); } catch (_) {}
  }
  return all;
}

async function whisperOne(filePath, language, offset) {
  const buf = fs.readFileSync(filePath);
  const fd = new FormData();
  fd.append('file', new Blob([buf]), path.basename(filePath));
  fd.append('model', 'whisper-1');
  fd.append('language', language);
  fd.append('response_format', 'verbose_json');
  fd.append('timestamp_granularities[]', 'segment');
  fd.append('timestamp_granularities[]', 'word');

  const r = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST', headers: { authorization: 'Bearer ' + oaiKey() }, body: fd,
  });
  if (!r.ok) throw new Error('whisper ' + r.status + ' ' + (await r.text().catch(() => '')).slice(0, 200));
  const j = await r.json();
  const words = Array.isArray(j.words) ? j.words : [];
  return (j.segments || []).map(s => {
    const ws = words
      .filter(w => (w.start || 0) >= (s.start || 0) - 1e-6 && (w.end || 0) <= (s.end || 0) + 1e-6)
      .map(w => ({ word: w.word, start: (w.start || 0) + offset, end: (w.end || 0) + offset }));
    return {
      start: (s.start || 0) + offset, end: (s.end || 0) + offset, text: norm(s.text),
      words: ws.length ? ws : undefined,
    };
  }).filter(s => s.text);
}

module.exports = { transcribe };
