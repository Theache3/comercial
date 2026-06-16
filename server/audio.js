/* ============================================================
   audio.js — utilidades de audio con ffmpeg/ffprobe (child_process).
   - concat(): une varios audios en orden en un solo archivo.
   - probeDuration(): duración en segundos.
   - splitByTime(): parte un archivo en trozos (para el límite de 25MB de Whisper).
   Sin dependencias npm. ffmpeg/ffprobe deben estar en PATH (o FFMPEG_PATH/FFPROBE_PATH).
============================================================ */
'use strict';

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const FFMPEG = process.env.FFMPEG_PATH || 'ffmpeg';
const FFPROBE = process.env.FFPROBE_PATH || 'ffprobe';

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    let p;
    try { p = spawn(cmd, args); } catch (e) { return reject(e); }
    let out = '', err = '';
    if (p.stdout) p.stdout.on('data', d => { out += d; });
    if (p.stderr) p.stderr.on('data', d => { err += d; });
    p.on('error', reject);
    p.on('close', code => code === 0
      ? resolve({ out, err })
      : reject(new Error(cmd + ' salió ' + code + ': ' + err.slice(-400))));
  });
}

async function probeDuration(file) {
  try {
    const { out } = await run(FFPROBE, ['-v', 'error', '-show_entries', 'format=duration',
      '-of', 'default=noprint_wrappers=1:nokey=1', file]);
    const d = parseFloat(String(out).trim());
    return isFinite(d) && d > 0 ? d : 0;
  } catch (_) { return 0; }
}

// Une `files` (en orden) en outPath. Intenta stream-copy (instantáneo); si el
// resultado no cuadra en duración o falla, reencoda a mp3. Devuelve { path, duration }.
async function concat(files, outPath) {
  if (!files || !files.length) throw new Error('concat: sin archivos');
  const listPath = outPath + '.list.txt';
  const list = files.map(f => "file '" + String(f).replace(/'/g, "'\\''") + "'").join('\n');
  fs.writeFileSync(listPath, list, 'utf8');

  const sumDur = (await Promise.all(files.map(probeDuration))).reduce((a, b) => a + b, 0);
  const copyArgs = ['-y', '-f', 'concat', '-safe', '0', '-i', listPath, '-c', 'copy', outPath];
  const encArgs = ['-y', '-f', 'concat', '-safe', '0', '-i', listPath, '-c:a', 'libmp3lame', '-b:a', '192k', outPath];

  try {
    try {
      await run(FFMPEG, copyArgs);
      const d = await probeDuration(outPath);
      // si copy produjo algo incoherente (codecs distintos), reencodar
      if (sumDur > 0 && Math.abs(d - sumDur) > 1.5) await run(FFMPEG, encArgs);
    } catch (_) {
      await run(FFMPEG, encArgs);
    }
  } finally {
    try { fs.unlinkSync(listPath); } catch (_) {}
  }
  return { path: outPath, duration: await probeDuration(outPath) };
}

// Parte `file` en trozos mp3 de <= maxSec. Devuelve [{ path, offset }] (offset en segundos).
async function splitByTime(file, maxSec, outDir) {
  fs.mkdirSync(outDir, { recursive: true });
  const pattern = path.join(outDir, 'chunk-%03d.mp3');
  await run(FFMPEG, ['-y', '-i', file, '-f', 'segment', '-segment_time', String(maxSec),
    '-c:a', 'libmp3lame', '-b:a', '128k', pattern]);
  const names = fs.readdirSync(outDir).filter(f => /^chunk-\d+\.mp3$/.test(f)).sort();
  const out = [];
  let offset = 0;
  for (const n of names) {
    const p = path.join(outDir, n);
    out.push({ path: p, offset });
    offset += await probeDuration(p);
  }
  return out;
}

module.exports = { concat, probeDuration, splitByTime, FFMPEG, FFPROBE };
