/* ============================================================
   report.js — visor standalone del reporte de UNA marca.
   - Lee el token de la URL (/r/<token>), pide /api/reports/<token>.
   - Muestra solo los clips y menciones de esa marca (aislamiento
     estructural: el backend nunca le manda el audio completo ni otras marcas).
   - NO tiene ningún link interno al resto de la app.
============================================================ */
(function () {
  'use strict';

  const PLAY = '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>';
  const PAUSE = '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M6 5h4v14H6zM14 5h4v14h-4z"/></svg>';
  const PLAY_SM = '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>';
  const LOCK = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 018 0v3"/></svg>';
  const PDF = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12M8 11l4 4 4-4M5 21h14"/></svg>';

  const content = document.getElementById('content');
  const footer = document.getElementById('footer');

  const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  function fmt(s) {
    if (!isFinite(s) || s < 0) s = 0;
    const m = Math.floor(s / 60), sec = Math.floor(s % 60);
    return (m < 10 ? '0' : '') + m + ':' + (sec < 10 ? '0' : '') + sec;
  }
  function dateLong(ms) {
    const d = new Date(ms);
    return d.getDate() + ' de ' + MESES[d.getMonth()] + ' de ' + d.getFullYear();
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  }
  // resalta los rangos de la marca dentro del texto del segmento
  function frHtml(text, ranges, c) {
    text = String(text == null ? '' : text);
    const rs = (ranges || []).slice().sort((a, b) => a.start - b.start);
    let html = '', pos = 0;
    for (const r of rs) {
      if (r.start < pos || r.start > text.length) continue;
      if (r.start > pos) html += esc(text.slice(pos, r.start));
      html += '<mark style="background:' + esc(c.bg) + ';color:' + esc(c.fg) + ';box-shadow:inset 0 -2px 0 ' + esc(c.line) + ';">'
        + esc(text.slice(r.start, r.end)) + '</mark>';
      pos = r.end;
    }
    if (pos < text.length) html += esc(text.slice(pos));
    return html || esc(text);
  }

  function tokenFromPath() {
    const parts = location.pathname.split('/').filter(Boolean);
    return parts.length ? decodeURIComponent(parts[parts.length - 1]) : '';
  }

  function renderError(title, msg) {
    content.innerHTML = '<div class="state"><h2>' + esc(title) + '</h2><p>' + esc(msg) + '</p></div>';
    footer.textContent = 'Radio Mitre — Verificador de menciones';
  }

  function renderReport(d) {
    const c = (d.brandColor && d.brandColor.bg) ? d.brandColor : { bg: '#EDF2F7', fg: '#2D3748', line: '#A0AEC0', dot: '#A0AEC0' };
    const hasAudio = !d.noAudio && d.mentions.some(m => m.clipUrl);

    const summary = (d.mentionCount === d.fragmentCount)
      ? (d.mentionCount + (d.mentionCount === 1 ? ' mención' : ' menciones'))
      : (d.mentionCount + ' menciones en ' + d.fragmentCount + (d.fragmentCount === 1 ? ' fragmento' : ' fragmentos'));

    const fragsHtml = d.mentions.map((m, i) => {
      const playable = !!m.clipUrl;
      return '<li class="frag">'
        + '<button class="play" data-i="' + i + '" ' + (playable ? '' : 'disabled') + ' aria-label="Reproducir mención">'
        + (playable ? PLAY : LOCK) + '</button>'
        + '<div class="body">'
        + '<span class="time">' + esc(m.clock || m.t || fmt(m.start)) + '</span>'
        + '<p class="text">' + frHtml(m.text, m.ranges, c) + '</p>'
        + (playable ? '<audio preload="none" src="' + esc(m.clipUrl) + '"></audio>'
          : '<span class="noaudio">Audio no disponible — verificar contra la emisión original.</span>')
        + '</div></li>';
    }).join('');

    content.innerHTML =
      '<div class="head">'
      + '<div class="brand"><span class="dot" style="background:' + esc(c.dot || c.line) + ';box-shadow:0 0 0 3px ' + esc(c.bg) + '"></span>' + esc(d.brandTerm) + '</div>'
      + '<div class="meta">' + esc(d.programName) + ' · generado el ' + dateLong(d.createdAt) + '</div>'
      + '<div class="chips"><span class="chip">' + esc(summary) + '</span><span class="chip">' + fmt(d.totalSec) + ' de audio</span></div>'
      + '<div class="actions">'
      + (hasAudio ? '<button class="playall" id="playall">' + PLAY_SM + ' Reproducir todo</button>' : '')
      + '<button class="pdfbtn" id="pdfbtn">' + PDF + ' Descargar PDF</button>'
      + '</div>'
      + (d.noAudio ? '<div class="banner">No se pudo procesar el audio; este reporte incluye solo los textos y horarios de cada mención.</div>' : '')
      + '<div class="expiry">Este reporte estará disponible hasta el ' + dateLong(d.expiresAt) + '.</div>'
      + '</div>'
      + '<ol class="frags">' + fragsHtml + '</ol>';

    footer.textContent = 'Generado el ' + dateLong(d.createdAt) + ' · Radio Mitre — Verificador de menciones';

    document.title = 'Menciones de ' + d.brandTerm + ' · Radio Mitre';
    wirePlayback();
    const pdf = document.getElementById('pdfbtn');
    if (pdf) pdf.addEventListener('click', () => window.print());
  }

  // un solo audio sonando a la vez; "Reproducir todo" encadena.
  function wirePlayback() {
    const frags = [].slice.call(document.querySelectorAll('.frag'));
    const audios = frags.map(f => f.querySelector('audio'));
    const btns = frags.map(f => f.querySelector('.play'));
    let cur = -1, chain = false;

    function stop(i) {
      if (i < 0 || !audios[i]) return;
      audios[i].pause(); audios[i].currentTime = 0;
      btns[i].classList.remove('playing'); btns[i].innerHTML = PLAY;
    }
    function play(i) {
      if (!audios[i]) return;
      if (cur !== -1 && cur !== i) stop(cur);
      cur = i; audios[i].play();
      btns[i].classList.add('playing'); btns[i].innerHTML = PAUSE;
    }
    btns.forEach((b, i) => {
      if (!audios[i]) return;
      b.addEventListener('click', () => {
        if (cur === i && !audios[i].paused) { audios[i].pause(); b.classList.remove('playing'); b.innerHTML = PLAY; }
        else { chain = false; play(i); }
      });
    });
    audios.forEach((a, i) => {
      if (!a) return;
      a.addEventListener('ended', () => {
        stop(i);
        if (chain) { let n = i + 1; while (n < audios.length && !audios[n]) n++; if (n < audios.length) play(n); else chain = false; }
      });
    });
    const pa = document.getElementById('playall');
    if (pa) pa.addEventListener('click', () => { chain = true; let f = 0; while (f < audios.length && !audios[f]) f++; if (f < audios.length) play(f); });
  }

  /* ---------------- arranque ---------------- */
  const token = tokenFromPath();
  if (!token) { renderError('Reporte no encontrado', 'El enlace no es válido.'); return; }

  fetch('/api/reports/' + encodeURIComponent(token))
    .then(r => {
      if (r.status === 404) return r.json().then(() => { throw new Error('missing'); }, () => { throw new Error('missing'); });
      if (!r.ok) throw new Error('http');
      return r.json();
    })
    .then(renderReport)
    .catch(err => {
      if (err && err.message === 'missing') {
        renderError('Reporte no disponible', 'Este reporte expiró o el enlace no es válido. Los reportes se borran a los 21 días de cargado el audio.');
      } else {
        renderError('No se pudo cargar', 'Hubo un problema al cargar el reporte. Probá de nuevo en un momento.');
      }
    });
})();
