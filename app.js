/* ============================================================
   Verificador de menciones — Radio Mitre
   Herramienta interna del equipo comercial: verifica menciones
   de marca al aire sobre un audio + su transcripción con timestamps.

   Recreado a partir del prototipo de Claude Design
   ("Verificador de menciones.dc.html") en JS vanilla, sin build.
   Estética: Radio Mitre Design System (tokens en colors_and_type.css).
============================================================ */
(() => {
  'use strict';

  // 'teal' = acento interno (default) · 'mitre' = rojo Mitre
  const ACCENT = 'teal';

  const ACCENT_VARS = {
    '--brand-50':'--mitre-50', '--brand-100':'--mitre-100', '--brand-300':'--mitre-300',
    '--brand-400':'--mitre-400', '--brand-500':'--mitre-500', '--brand-600':'--mitre-600', '--brand-700':'--mitre-700',
  };

  // Colores por marca (se asignan en orden a medida que se agregan marcas)
  const PALETTE = [
    { bg:'#FDE68A', fg:'#854D0E', line:'#F59E0B', dot:'#F59E0B' },
    { bg:'#A7F3D0', fg:'#065F46', line:'#10B981', dot:'#10B981' },
    { bg:'#BFDBFE', fg:'#1E40AF', line:'#3B82F6', dot:'#3B82F6' },
    { bg:'#FBCFE8', fg:'#9D174D', line:'#EC4899', dot:'#EC4899' },
    { bg:'#DDD6FE', fg:'#5B21B6', line:'#8B5CF6', dot:'#8B5CF6' },
    { bg:'#FED7AA', fg:'#9A3412', line:'#F97316', dot:'#F97316' },
    { bg:'#99F6E4', fg:'#115E59', line:'#14B8A6', dot:'#14B8A6' },
    { bg:'#E9D5FF', fg:'#6B21A8', line:'#A855F7', dot:'#A855F7' },
  ];

  /* ---------------- DOM helpers ---------------- */
  function h(tag, props, ...children) {
    const node = document.createElement(tag);
    if (props) for (const k in props) {
      const v = props[k];
      if (v == null) continue;
      if (k === 'style' && typeof v === 'object') Object.assign(node.style, v);
      else if (k === 'class') node.className = v;
      else if (k.slice(0, 2) === 'on' && typeof v === 'function') node.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k in node && k !== 'list') { try { node[k] = v; } catch (_) { node.setAttribute(k, v); } }
      else node.setAttribute(k, v);
    }
    for (const c of children.flat()) {
      if (c == null || c === false) continue;
      node.appendChild(typeof c === 'object' ? c : document.createTextNode(String(c)));
    }
    return node;
  }
  function svg(str) {
    const wrap = document.createElement('div');
    wrap.innerHTML = str.trim();
    return wrap.firstElementChild;
  }

  /* ---------------- icons ---------------- */
  const I = {
    wave: (stroke) => `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="${stroke}" stroke-width="2" stroke-linecap="round"><path d="M3 12h3l3-7 4 14 3-7h5"/></svg>`,
    waveBig: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 12h3l3-7 4 14 3-7h5"/></svg>`,
    upload: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 16V4M7 9l5-5 5 5M5 20h14"/></svg>`,
    json: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><path d="M14 2v6h6"/><path d="M9 13h6M9 17h6"/></svg>`,
    check: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--green-500)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>`,
    down: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12l7 7 7-7"/></svg>`,
    search: `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--gray-400)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>`,
    play: `<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" style="margin-left:2px;"><path d="M8 5v14l11-7z"/></svg>`,
    pause: `<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M6 5h4v14H6zM14 5h4v14h-4z"/></svg>`,
    triangle: `<svg width="9" height="9" viewBox="0 0 24 24" fill="currentColor" style="flex:none;"><path d="M8 5v14l11-7z"/></svg>`,
    x: (w) => `<svg width="${w}" height="${w}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><path d="M5 5l14 14M19 5L5 19"/></svg>`,
    xThin: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M5 5l14 14M19 5L5 19"/></svg>`,
    gauge: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 13l3.5-3.5"/><path d="M4 19a8 8 0 1116 0"/></svg>`,
    download: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v11M7.5 10.5L12 15l4.5-4.5M5 20h14"/></svg>`,
    link: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 007.07 0l3-3a5 5 0 00-7.07-7.07l-1.5 1.5"/><path d="M14 11a5 5 0 00-7.07 0l-3 3a5 5 0 007.07 7.07l1.5-1.5"/></svg>`,
    copy: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 012-2h10"/></svg>`,
    trash: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/></svg>`,
    karaoke: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h11M4 12h7M4 17h14"/></svg>`,
    spinner: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 3a9 9 0 109 9" opacity="0.9"/></svg>`,
  };

  /* ---------------- state ---------------- */
  let nextColor = 0;
  function makeBrand(term) {
    const color = PALETTE[nextColor % PALETTE.length];
    nextColor++;
    return { term: String(term).trim(), color };
  }

  const sampleSegs = sampleSegments();
  const state = {
    view: 'main',
    fileName: 'mañana-de-mitre-tanda.mp3',
    segments: sampleSegs,
    audioUrl: '',
    brands: [makeBrand('Mercado Libre'), makeBrand('Quilmes')],
    brandInput: '',
    isPlaying: false,
    currentTime: 0,
    duration: sampleSegs.length ? sampleSegs[sampleSegs.length - 1].end : 0,
    segmentStart: null,
    segmentEnd: null,
    flashSeg: -1,
    activeAppKey: null,
    rate: 1,                 // velocidad de reproducción
    wordKaraoke: true,       // resaltado palabra por palabra
    decodedBuffer: null,     // AudioBuffer decodificado (cache para "Enviar a la marca")
    // persistencia (backend): sesión guardada 21 días desde la carga del audio
    sessionId: null, sessionExpiresAt: null, sessionSaving: false, sessionError: false,
    // upload staging
    pendingAudioUrl: '', pendingAudioName: '', pendingSegments: null, pendingJsonName: '',
    uploadError: false, uploadErrorMsg: '',
  };

  const RATES = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
  const WORD_MAX = 600;      // por encima, se desactiva el karaoke por palabra (performance)
  const MAX_DECODE_BYTES = 150 * 1024 * 1024; // archivos más grandes se exportan solo como texto
  const API_BASE = '';       // same-origin: el backend Node sirve el front y la API

  // runtime refs (rebuilt on every renderApp)
  const refs = {};
  // audio + file inputs persist across renders so playback never breaks
  let audio, audioInput, jsonInput;
  let _sharedCtx = null;     // un único AudioContext reutilizado por todos los export
  let segGate = null;        // auto-pause boundary (seconds) for "play segment"
  let styledActive = -1;     // segment index currently styled as active
  let styledWordEl = null;   // word span currently ringed (karaoke)
  let lastScrolled = -1;
  let scrubbing = false;
  let raf = 0, lastTick = 0, flashTimer = 0, brandsSaveTimer = 0;
  const root = document.getElementById('app');

  /* ============================================================
     INIT
  ============================================================ */
  function init() {
    if (ACCENT === 'mitre') for (const k in ACCENT_VARS) root.style.setProperty(k, `var(${ACCENT_VARS[k]})`);

    audio = h('audio', { preload: 'auto', style: { display: 'none' } });
    audio.addEventListener('loadedmetadata', () => {
      audio.playbackRate = state.rate; // loading a new src resets playbackRate to 1
      if (isFinite(audio.duration) && audio.duration > 0) { state.duration = audio.duration; paintProgress(audio.currentTime); }
    });
    audio.addEventListener('timeupdate', () => {
      if (segGate != null && audio.currentTime >= segGate) {
        audio.pause(); segGate = null; state.segmentEnd = null; state.currentTime = audio.currentTime;
        paintProgress(audio.currentTime); paintStatus(); paintActive(audio.currentTime, false);
      } else if (audio.paused) {
        state.currentTime = audio.currentTime;
        paintProgress(audio.currentTime); paintActive(audio.currentTime, false);
      }
    });
    audio.addEventListener('play', () => { state.isPlaying = true; paintStatus(); startLoop(); });
    audio.addEventListener('pause', () => { state.isPlaying = false; paintStatus(); });
    audio.addEventListener('ended', () => {
      segGate = null; state.isPlaying = false; state.segmentStart = null; state.segmentEnd = null;
      paintStatus(); paintProgress(audio.currentTime); paintActive(audio.currentTime, false);
    });
    document.body.appendChild(audio);

    audioInput = h('input', { type: 'file', accept: '.mp3,.wav,.m4a,.ogg,audio/*', style: { display: 'none' } });
    audioInput.addEventListener('change', e => { const f = e.target.files[0]; if (f) acceptAudio(f); });
    jsonInput = h('input', { type: 'file', accept: '.json,application/json', style: { display: 'none' } });
    jsonInput.addEventListener('change', e => { const f = e.target.files[0]; if (f) acceptJson(f); });
    document.body.append(audioInput, jsonInput);

    audio.src = makeSampleAudio(state.segments);
    state.audioUrl = audio.src;

    renderApp();
  }

  /* ============================================================
     RENDER (structural — view / segments / brands / upload)
     Playback updates go through paint* without re-rendering.
  ============================================================ */
  function renderApp() {
    const keepScroll = refs.scroll ? refs.scroll.scrollTop : 0;
    styledActive = -1; lastScrolled = -1; styledWordEl = null;
    root.innerHTML = '';
    refs.scroll = null;

    const frame = h('div', { style: {
      height: '100vh', width: '100%', display: 'flex', flexDirection: 'column',
      fontFamily: 'var(--font-sans)', background: 'var(--gray-50)', overflow: 'hidden', color: 'var(--gray-800)',
    } });
    frame.appendChild(buildTopbar());
    if (state.view === 'upload') frame.appendChild(buildUpload());
    else frame.appendChild(buildMain());
    root.appendChild(frame);

    if (state.view === 'main' && refs.scroll) refs.scroll.scrollTop = keepScroll;
    if (state.view === 'upload') loadRecentSessions();
    paintAll();
  }

  /* ---------------- topbar ---------------- */
  function buildTopbar() {
    const logo = svg(`<span></span>`); // placeholder, replaced below
    const left = h('div', { style: { display: 'flex', alignItems: 'center', gap: '14px' } },
      h('img', { src: 'assets/radiomitre.svg', alt: 'Radio Mitre', style: { height: '26px', width: 'auto' } }),
      h('div', { style: { width: '1px', height: '28px', background: 'var(--gray-200)' } }),
      h('div', { style: { display: 'flex', flexDirection: 'column', lineHeight: '1.2' } },
        h('span', { style: { fontSize: '15px', fontWeight: '700', color: 'var(--gray-800)', whiteSpace: 'nowrap' } }, 'Verificador de menciones'),
        h('span', { style: { fontSize: '12px', color: 'var(--gray-500)' } }, 'Control de marcas al aire'),
      ),
    );

    const right = h('div', { style: { display: 'flex', alignItems: 'center', gap: '12px' } });
    if (state.view === 'main') {
      const chip = h('div', { style: {
        display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 12px', background: 'var(--gray-50)',
        border: '1px solid var(--gray-200)', borderRadius: '999px', fontSize: '13px', color: 'var(--gray-600)', maxWidth: '320px',
      } },
        svg(I.wave('var(--brand-500)')),
        h('span', { style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: '500', color: 'var(--gray-700)' } }, state.fileName),
      );
      right.appendChild(chip);
      const save = h('div', { style: { fontSize: '12px', fontWeight: '600', whiteSpace: 'nowrap' } });
      refs.saveStatus = save;
      right.appendChild(save);
    }
    if (state.view === 'main') {
      const discardBtn = h('div', { class: 'discard-btn', onClick: discardAudio, title: 'Descartar el audio cargado (lo borra del servidor)', style: {
        display: 'inline-flex', alignItems: 'center', gap: '7px', padding: '8px 14px', border: '1px solid var(--gray-300)',
        borderRadius: '6px', fontSize: '13px', fontWeight: '600', color: 'var(--gray-700)', cursor: 'pointer', background: '#fff',
      } }, svg(I.trash), 'Descartar audio');
      right.appendChild(discardBtn);
    }
    const newBtn = h('div', { class: 'tb-btn', onClick: goUpload, style: {
      display: 'inline-flex', alignItems: 'center', gap: '7px', padding: '8px 14px', border: '1px solid var(--gray-300)',
      borderRadius: '6px', fontSize: '13px', fontWeight: '600', color: 'var(--gray-700)', cursor: 'pointer', background: '#fff',
    } }, svg(I.upload), 'Cargar nuevo audio');
    right.appendChild(newBtn);

    return h('div', { style: {
      height: '58px', flex: 'none', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '0 20px', background: '#fff', borderBottom: '1px solid var(--gray-200)', zIndex: '5',
    } }, left, right);
  }

  /* ---------------- upload view ---------------- */
  function dropzone(kind, ok, title, sub, onPick, onDrop) {
    const zone = h('div', { class: 'dropzone', onClick: onPick,
      onDragover: (e) => e.preventDefault(), onDrop: onDrop, style: {
        display: 'flex', alignItems: 'center', gap: '14px', padding: '16px', borderRadius: '8px', cursor: 'pointer',
        border: '1.5px dashed ' + (ok ? 'var(--green-500)' : 'var(--gray-300)'),
        background: ok ? '#F0FFF4' : 'var(--gray-50)', transition: 'all .15s',
      } },
      h('div', { style: { width: '40px', height: '40px', flex: 'none', borderRadius: '8px', background: 'var(--brand-50)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--brand-600)' } },
        svg(kind === 'audio' ? I.waveBig : I.json)),
      h('div', { style: { flex: '1', minWidth: '0' } },
        h('div', { style: { fontSize: '14px', fontWeight: '600', color: 'var(--gray-800)' } }, title),
        h('div', { style: { fontSize: '13px', color: 'var(--gray-500)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, sub),
      ),
      ok ? svg(I.check) : null,
    );
    return zone;
  }

  function buildUpload() {
    const hasA = !!state.pendingAudioUrl, hasJ = !!state.pendingSegments;
    const ready = hasA && hasJ;

    const card = h('div', { style: {
      width: '560px', maxWidth: '100%', background: '#fff', border: '1px solid var(--gray-200)',
      borderRadius: '10px', boxShadow: 'var(--shadow-md)', padding: '30px',
    } },
      h('div', { style: { fontSize: '21px', fontWeight: '700', color: 'var(--gray-800)' } }, 'Cargar audio y transcripción'),
      h('div', { style: { fontSize: '14px', color: 'var(--gray-600)', marginTop: '6px', lineHeight: '1.5' } },
        'Subí el archivo de audio (mp3, wav, m4a) junto con su transcripción en JSON con timestamps por segmento.'),
      h('div', { style: { display: 'flex', flexDirection: 'column', gap: '14px', marginTop: '24px' } },
        dropzone('audio', hasA, hasA ? state.pendingAudioName : 'Archivo de audio',
          hasA ? 'Listo para reproducir' : 'Arrastrá o hacé click — mp3, wav, m4a',
          () => audioInput.click(), (e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) acceptAudio(f); }),
        dropzone('json', hasJ, hasJ ? state.pendingJsonName : 'Transcripción (JSON)',
          hasJ ? (state.pendingSegments.length + ' segmentos detectados') : 'Array de { start, end, text } en segundos',
          () => jsonInput.click(), (e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) acceptJson(f); }),
      ),
      state.uploadError ? h('div', { style: {
        marginTop: '14px', padding: '10px 12px', background: '#FFF5F5', border: '1px solid #FEB2B2',
        borderRadius: '6px', fontSize: '13px', color: 'var(--red-600)',
      } }, state.uploadErrorMsg) : null,
      h('div', { style: {
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px',
        marginTop: '24px', paddingTop: '20px', borderTop: '1px solid var(--gray-100)',
      } },
        h('div', { class: 'link-sample', onClick: loadSample, style: { fontSize: '13px', fontWeight: '600', color: 'var(--brand-600)', cursor: 'pointer' } }, 'Usar audio de ejemplo'),
        h('div', { class: 'confirm-btn' + (ready ? ' ready' : ''), onClick: confirmUpload, style: {
          padding: '9px 18px', borderRadius: '6px', fontSize: '14px', fontWeight: '600',
          background: ready ? 'var(--brand-500)' : 'var(--gray-200)', color: ready ? '#fff' : 'var(--gray-400)',
          cursor: ready ? 'pointer' : 'not-allowed',
        } }, 'Ver transcripción'),
      ),
    );

    const recentList = h('div', {});
    const recentWrap = h('div', { style: { display: 'none', width: '560px', maxWidth: '100%', marginTop: '20px' } },
      h('div', { style: { fontSize: '14px', fontWeight: '700', color: 'var(--gray-700)' } }, 'Audios recientes'),
      h('div', { style: { fontSize: '12px', color: 'var(--gray-500)', margin: '3px 0 12px' } }, 'Se borran automáticamente a los 21 días de cargados.'),
      recentList,
    );
    refs.recentWrap = recentWrap; refs.recent = recentList;

    return h('div', { style: {
      flex: '1', minHeight: '0', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'var(--gray-50)', padding: '40px', overflow: 'auto',
    } }, h('div', { style: { display: 'flex', flexDirection: 'column', alignItems: 'center' } }, card, recentWrap));
  }

  /* ---------------- main view ---------------- */
  function buildMain() {
    const wrap = h('div', { style: { flex: '1', minHeight: '0', display: 'flex', flexDirection: 'column' } });
    const cols = h('div', { style: { flex: '1', minHeight: '0', display: 'flex' } },
      buildTranscript(), buildBrands());
    wrap.appendChild(cols);
    wrap.appendChild(buildPlayer());
    return wrap;
  }

  function buildTranscript() {
    const dur = state.duration || (state.segments.length ? state.segments[state.segments.length - 1].end : 0);
    const header = h('div', { style: {
      flex: 'none', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '14px 22px', borderBottom: '1px solid var(--gray-100)',
    } },
      h('div', {},
        h('div', { style: { fontSize: '15px', fontWeight: '700', color: 'var(--gray-800)' } }, 'Transcripción'),
        h('div', { style: { fontSize: '12px', color: 'var(--gray-500)', marginTop: '2px' } }, state.segments.length + ' segmentos · ' + fmt(dur)),
      ),
      h('div', { style: { display: 'flex', alignItems: 'center', gap: '8px' } },
        karaokeToggle(),
        h('div', { class: 'jump-btn', onClick: jumpToCurrent, style: {
          display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '6px 11px', border: '1px solid var(--gray-200)',
          borderRadius: '6px', fontSize: '12px', fontWeight: '600', color: 'var(--gray-600)', cursor: 'pointer',
        } }, svg(I.down), 'Ir a lo que suena'),
      ),
    );

    const scroll = h('div', { style: {
      flex: '1', minHeight: '0', overflowY: 'auto', padding: '10px 14px 24px', position: 'relative',
    } });
    refs.scroll = scroll;
    refs.segEls = [];

    const mc = computeMatches();
    const karaoke = state.wordKaraoke && state.segments.length <= WORD_MAX;
    state.segments.forEach((seg, i) => {
      const fill = h('div', { style: {
        position: 'absolute', left: '0', top: '0', bottom: '0', width: '0%', background: 'var(--brand-50)',
        transition: 'width .12s linear', pointerEvents: 'none', zIndex: '0',
      } });
      const text = h('div', { style: {
        position: 'relative', zIndex: '1', flex: '1', minWidth: '0', fontSize: '15.5px', lineHeight: '1.62',
        color: 'var(--gray-700)', textWrap: 'pretty',
      } });
      const tn = transcriptNodes(seg, mc.segHL[i], karaoke);
      tn.nodes.forEach(p => text.appendChild(p));

      const row = h('div', { class: 'seg-row', onClick: () => playFrom(i), style: {
        display: 'flex', gap: '14px', padding: '9px 12px', cursor: 'pointer', position: 'relative', overflow: 'hidden',
        borderRadius: '6px', marginBottom: '1px', borderLeft: '3px solid transparent', background: 'transparent',
        boxShadow: 'none', transition: 'background .2s, box-shadow .2s', contentVisibility: 'auto', containIntrinsicSize: 'auto 52px',
      } },
        fill,
        h('div', { style: { position: 'relative', zIndex: '1', flex: 'none', width: '46px', fontVariantNumeric: 'tabular-nums', fontSize: '12px', color: 'var(--gray-400)', fontWeight: '600', paddingTop: '2px', letterSpacing: '0.01em' } }, fmt(seg.start)),
        text,
      );
      row.setAttribute('data-seg-index', i);
      refs.segEls.push({ row, fill, wordSpans: tn.wordSpans });
      scroll.appendChild(row);
    });

    return h('div', { style: {
      flex: '1', minWidth: '0', display: 'flex', flexDirection: 'column', background: '#fff', borderRight: '1px solid var(--gray-200)',
    } }, header, scroll);
  }

  function buildBrands() {
    const mc = computeMatches();

    // input + chips header
    const input = h('input', { class: 'brand-input', value: state.brandInput, placeholder: 'Ej: Mercado Libre', style: {
      flex: '1', minWidth: '0', padding: '9px 12px', border: '1px solid var(--gray-300)', borderRadius: '6px',
      fontFamily: 'var(--font-sans)', fontSize: '14px', color: 'var(--gray-800)', outline: 'none',
    } });
    refs.brandInput = input;
    input.addEventListener('input', e => { state.brandInput = e.target.value; });
    input.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addBrand(state.brandInput); } });

    const inputRow = h('div', { style: { display: 'flex', gap: '8px', marginTop: '12px' } },
      input,
      h('div', { class: 'brand-add', onClick: () => addBrand(state.brandInput), style: {
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '5px', padding: '9px 14px',
        background: 'var(--brand-500)', color: '#fff', borderRadius: '6px', fontSize: '14px', fontWeight: '600', cursor: 'pointer', flex: 'none',
      } }, 'Agregar'),
    );

    const totalMentions = mc.brandApp.reduce((a, arr) => a + arr.length, 0);
    const csvBtn = h('div', { class: 'csv-btn' + (totalMentions ? '' : ' disabled'), onClick: totalMentions ? exportCSV : null,
      title: totalMentions ? 'Exportar todas las menciones a CSV' : 'No hay menciones para exportar', style: {
        display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '6px 11px', border: '1px solid var(--gray-200)',
        borderRadius: '6px', fontSize: '12px', fontWeight: '600', cursor: totalMentions ? 'pointer' : 'default',
        color: totalMentions ? 'var(--gray-600)' : 'var(--gray-400)', background: '#fff', flex: 'none',
      } }, svg(I.download), 'Exportar CSV');

    const headerKids = [
      h('div', { style: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '10px' } },
        h('div', { style: { minWidth: '0' } },
          h('div', { style: { fontSize: '15px', fontWeight: '700', color: 'var(--gray-800)' } }, 'Marcas a verificar'),
          h('div', { style: { fontSize: '12px', color: 'var(--gray-500)', marginTop: '2px' } }, 'Buscá una o más marcas para ver y escuchar dónde se nombran.'),
        ),
        csvBtn,
      ),
      inputRow,
    ];
    if (state.brands.length) {
      const chips = h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '7px', marginTop: '12px' } });
      state.brands.forEach((b, i) => {
        chips.appendChild(h('div', { style: {
          display: 'inline-flex', alignItems: 'center', gap: '7px', padding: '5px 7px 5px 10px', background: '#fff',
          border: '1px solid var(--gray-200)', borderRadius: '999px', fontSize: '13px', fontWeight: '600', color: 'var(--gray-700)',
        } },
          h('span', { style: { width: '9px', height: '9px', borderRadius: '50%', background: b.color.dot, flex: 'none' } }),
          b.term,
          h('button', { class: 'chip-x', onClick: () => removeBrand(i), style: {
            display: 'flex', alignItems: 'center', justifyContent: 'center', width: '17px', height: '17px', border: '0',
            background: 'var(--gray-100)', borderRadius: '50%', color: 'var(--gray-500)', cursor: 'pointer', padding: '0',
          } }, svg(I.x(9))),
        ));
      });
      headerKids.push(chips);
    }
    const header = h('div', { style: { flex: 'none', padding: '16px 18px', background: '#fff', borderBottom: '1px solid var(--gray-200)' } }, ...headerKids);

    // cards / empty state
    const list = h('div', { style: { flex: '1', minHeight: '0', overflowY: 'auto', padding: '14px' } });
    if (state.brands.length) {
      state.brands.forEach((b, bi) => list.appendChild(buildBrandCard(b, bi, mc.brandApp[bi])));
    } else {
      list.appendChild(h('div', { style: {
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center',
        padding: '48px 24px', color: 'var(--gray-400)',
      } },
        h('div', { style: { width: '52px', height: '52px', borderRadius: '50%', background: '#fff', border: '1px solid var(--gray-200)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '14px' } }, svg(I.search)),
        h('div', { style: { fontSize: '14px', fontWeight: '600', color: 'var(--gray-600)' } }, 'Todavía no agregaste marcas'),
        h('div', { style: { fontSize: '13px', color: 'var(--gray-500)', marginTop: '4px', maxWidth: '240px', lineHeight: '1.5' } }, 'Escribí una marca arriba para resaltarla en la transcripción y listar sus menciones.'),
      ));
    }

    return h('div', { style: { flex: 'none', width: 'clamp(460px, 40vw, 760px)', display: 'flex', flexDirection: 'column', background: 'var(--gray-50)' } }, header, list);
  }

  function buildBrandCard(b, bi, apps) {
    const c = b.color;
    const count = apps.length;
    const countLabel = count === 0 ? 'Sin menciones' : (count === 1 ? '1 mención' : count + ' menciones');
    const head = h('div', { style: { display: 'flex', alignItems: 'center', gap: '10px', padding: '12px 14px', borderBottom: '1px solid var(--gray-100)' } },
      h('span', { style: { width: '12px', height: '12px', borderRadius: '50%', background: c.dot, flex: 'none', boxShadow: '0 0 0 3px ' + c.bg } }),
      h('span', { style: { fontSize: '15px', fontWeight: '700', color: 'var(--gray-800)', flex: '1', minWidth: '0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, b.term),
      h('span', { style: { flex: 'none', fontSize: '12px', fontWeight: '700', padding: '3px 9px', borderRadius: '999px', background: count ? c.bg : 'var(--gray-100)', color: count ? c.fg : 'var(--gray-500)' } }, countLabel),
    );

    const card = h('div', { style: { background: '#fff', border: '1px solid var(--gray-200)', borderRadius: '8px', overflow: 'hidden', marginBottom: '12px', boxShadow: 'var(--shadow-xs)' } }, head);

    if (count > 0) {
      const linkBtn = h('button', { class: 'link-btn', style: {
        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '7px', width: '100%',
        padding: '8px 10px', border: '0', borderRadius: '6px', background: 'var(--brand-500)',
        color: '#fff', fontFamily: 'var(--font-sans)', fontSize: '13px', fontWeight: '600', cursor: 'pointer',
      } }, svg(I.link), 'Generar link de reporte');
      const result = h('div', { style: { display: 'none' } });
      linkBtn.addEventListener('click', () => generateReport(b, bi, apps, linkBtn, result));
      card.appendChild(h('div', { style: { padding: '8px 8px 0', display: 'flex', flexDirection: 'column', gap: '6px' } }, linkBtn, result));

      const body = h('div', { style: { padding: '6px' } });
      apps.forEach(ap => {
        const seg = state.segments[ap.si];
        const key = ap.si + '-' + bi + '-' + ap.start;
        const isAct = state.activeAppKey === key;
        const pill = h('span', { style: { display: 'inline-flex', alignItems: 'center', gap: '5px', flex: 'none', fontVariantNumeric: 'tabular-nums', fontSize: '12px', fontWeight: '700', color: c.fg, background: c.bg, borderRadius: '4px', padding: '3px 7px' } },
          svg(I.triangle), fmt(seg.start));
        const snippet = h('span', { style: { fontSize: '13px', color: 'var(--gray-600)', lineHeight: '1.45', overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: '2', WebkitBoxOrient: 'vertical' } });
        buildSnippet(seg.text, ap.start, ap.end, c).forEach(p => snippet.appendChild(p));
        const btn = h('button', { class: 'appear-btn', onClick: () => playSegment(ap.si, key), style: {
          display: 'flex', alignItems: 'center', gap: '10px', width: '100%', textAlign: 'left', padding: '8px 10px',
          border: '1px solid ' + (isAct ? 'var(--brand-400)' : 'transparent'), background: isAct ? 'var(--brand-50)' : 'transparent',
          borderRadius: '6px', cursor: 'pointer', font: 'inherit', marginBottom: '2px',
        } }, pill, snippet);
        btn.setAttribute('data-app-key', key);
        body.appendChild(btn);
      });
      card.appendChild(body);
    } else {
      card.appendChild(h('div', { style: { padding: '14px', fontSize: '13px', color: 'var(--gray-500)' } }, 'Sin menciones en este audio.'));
    }
    return card;
  }

  function buildPlayer() {
    const playBtn = h('div', { class: 'play-btn', onClick: onPlayPause, style: {
      width: '46px', height: '46px', flex: 'none', borderRadius: '50%', background: 'var(--brand-500)', color: '#fff',
      display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
    } });
    refs.playBtn = playBtn;

    const statusLabel = h('span', { style: { fontWeight: '600', whiteSpace: 'nowrap', flex: 'none' } });
    const timeLabel = h('span', { style: { fontVariantNumeric: 'tabular-nums', color: 'var(--gray-500)', fontWeight: '500', whiteSpace: 'nowrap', flex: 'none', paddingLeft: '12px' } });
    refs.statusLabel = statusLabel; refs.timeLabel = timeLabel;

    const band = h('div', { style: { display: 'none' } });
    const prog = h('div', { style: { position: 'absolute', top: '0', bottom: '0', left: '0', width: '0%', background: 'var(--brand-500)', borderRadius: '999px', transition: 'width .1s linear', zIndex: '1' } });
    const knob = h('div', { style: { position: 'absolute', top: '50%', left: '0%', transform: 'translate(-50%,-50%)', width: '15px', height: '15px', borderRadius: '50%', background: '#fff', boxShadow: '0 1px 3px rgba(0,0,0,.3)', border: '3px solid var(--brand-500)', transition: 'left .1s linear', pointerEvents: 'none', zIndex: '2' } });
    refs.band = band; refs.prog = prog; refs.knob = knob;

    const bar = h('div', { style: { position: 'relative', height: '10px', borderRadius: '999px', background: 'var(--gray-200)', cursor: 'pointer', touchAction: 'none' } }, band, prog, knob);
    refs.bar = bar;
    bar.addEventListener('pointerdown', (e) => { scrubbing = true; try { bar.setPointerCapture(e.pointerId); } catch (_) {} seekFromEvent(e); });
    bar.addEventListener('pointermove', (e) => { if (scrubbing) seekFromEvent(e); });
    bar.addEventListener('pointerup', () => { scrubbing = false; restoreTransitions(); });

    const middle = h('div', { style: { flex: '1', minWidth: '0', display: 'flex', flexDirection: 'column', gap: '7px' } },
      h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '12.5px' } }, statusLabel, timeLabel),
      bar,
    );

    const rateLabel = h('span', {}, fmtRate(state.rate));
    refs.rateLabel = rateLabel;
    const rateBtn = h('div', { class: 'rate-btn', onClick: cycleRate, title: 'Velocidad de reproducción', style: {
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '6px', padding: '8px 11px',
      border: '1px solid var(--gray-300)', borderRadius: '6px', fontSize: '12.5px', fontWeight: '700', color: 'var(--gray-700)',
      cursor: 'pointer', flex: 'none', fontVariantNumeric: 'tabular-nums', minWidth: '64px',
    } }, svg(I.gauge), rateLabel);

    const exitBtn = h('div', { class: 'exit-seg', onClick: clearSegment, style: {
      display: 'none', alignItems: 'center', gap: '7px', padding: '8px 12px', border: '1px solid var(--gray-300)',
      borderRadius: '6px', fontSize: '12.5px', fontWeight: '600', color: 'var(--gray-600)', cursor: 'pointer', flex: 'none',
    } }, svg(I.xThin), 'Salir del segmento');
    refs.exitBtn = exitBtn;

    return h('div', { style: {
      flex: 'none', height: '86px', background: '#fff', borderTop: '1px solid var(--gray-200)', display: 'flex',
      alignItems: 'center', gap: '20px', padding: '0 24px', boxShadow: '0 -2px 8px rgba(0,0,0,.04)', zIndex: '6',
    } }, playBtn, middle, rateBtn, exitBtn);
  }

  function fmtRate(r) { return (r + '').replace('.', ',') + '×'; }
  function cycleRate() {
    const i = RATES.indexOf(state.rate);
    setRate(RATES[(i + 1) % RATES.length]);
  }
  function setRate(r) {
    state.rate = r;
    if (audio) audio.playbackRate = r;
    if (refs.rateLabel) refs.rateLabel.textContent = fmtRate(r);
  }

  function karaokeToggle() {
    const on = state.wordKaraoke;
    const disabled = state.segments.length > WORD_MAX;
    const btn = h('div', { class: 'jump-btn', onClick: disabled ? null : toggleKaraoke,
      title: disabled ? 'Desactivado en transcripciones muy largas' : 'Resaltar palabra por palabra mientras suena', style: {
        display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '6px 11px', borderRadius: '6px',
        fontSize: '12px', fontWeight: '600', cursor: disabled ? 'default' : 'pointer',
        border: '1px solid ' + (on && !disabled ? 'var(--brand-400)' : 'var(--gray-200)'),
        background: on && !disabled ? 'var(--brand-50)' : '#fff',
        color: disabled ? 'var(--gray-400)' : (on ? 'var(--brand-700)' : 'var(--gray-600)'),
      } }, svg(I.karaoke), 'Palabra por palabra');
    return btn;
  }
  function toggleKaraoke() { state.wordKaraoke = !state.wordKaraoke; renderApp(); }

  /* ============================================================
     PAINT (cheap live updates, no re-render)
  ============================================================ */
  function paintAll() {
    if (state.view !== 'main') return;
    const t = audio ? audio.currentTime : state.currentTime;
    paintStatus(); paintSaveStatus(); paintProgress(t); paintActive(t, false);
  }

  function paintStatus() {
    if (!refs.playBtn) return;
    refs.playBtn.innerHTML = '';
    refs.playBtn.appendChild(svg(state.isPlaying ? I.pause : I.play));
    const hasSeg = state.segmentStart != null && state.segmentEnd != null;
    let label, color;
    if (hasSeg) { label = 'Reproduciendo mención · ' + fmt(state.segmentStart) + ' – ' + fmt(state.segmentEnd); color = 'var(--brand-600)'; }
    else if (state.isPlaying) { label = 'Reproduciendo'; color = 'var(--gray-700)'; }
    else { label = 'En pausa'; color = 'var(--gray-500)'; }
    refs.statusLabel.textContent = label;
    refs.statusLabel.style.color = color;
    refs.exitBtn.style.display = hasSeg ? 'inline-flex' : 'none';
  }

  function paintProgress(t) {
    if (!refs.prog) return;
    const dur = state.duration || (state.segments.length ? state.segments[state.segments.length - 1].end : 0);
    const pct = dur ? Math.max(0, Math.min(100, (t / dur) * 100)) : 0;
    refs.prog.style.width = pct + '%';
    refs.knob.style.left = pct + '%';
    if (state.segmentStart != null && state.segmentEnd != null && dur) {
      Object.assign(refs.band.style, {
        display: 'block', position: 'absolute', top: '0', bottom: '0',
        left: (state.segmentStart / dur * 100) + '%', width: ((state.segmentEnd - state.segmentStart) / dur * 100) + '%',
        background: 'var(--brand-100)', borderRadius: '999px',
      });
    } else refs.band.style.display = 'none';
    refs.timeLabel.textContent = fmt(t) + ' / ' + fmt(dur);
  }

  function paintActive(t, doScroll) {
    if (!refs.segEls) return;
    const idx = findActive(t);
    if (idx !== styledActive) {
      const prev = refs.segEls[styledActive];
      if (prev) { prev.row.style.borderLeftColor = 'transparent'; prev.fill.style.width = '0%'; prev.fill.style.borderRight = 'none'; }
      const cur = refs.segEls[idx];
      if (cur) cur.row.style.borderLeftColor = 'var(--brand-500)';
      styledActive = idx;
    }
    if (idx >= 0) {
      const seg = state.segments[idx];
      const span = Math.max(0.001, seg.end - seg.start);
      const pct = Math.max(0, Math.min(100, ((t - seg.start) / span) * 100));
      const cur = refs.segEls[idx];
      if (cur) {
        cur.fill.style.width = pct + '%';
        cur.fill.style.borderRight = (pct > 0.5 && pct < 99.5) ? '2px solid var(--brand-300)' : 'none';
      }
      if (doScroll && idx !== lastScrolled) { lastScrolled = idx; maybeScroll(idx); }
    }
    // word-by-word karaoke ring
    let target = null;
    if (idx >= 0) {
      const ws = refs.segEls[idx] && refs.segEls[idx].wordSpans;
      if (ws && ws.length) {
        for (let j = 0; j < ws.length; j++) { if (t >= ws[j].start && t < ws[j].end) { target = ws[j].el; break; } }
      }
    }
    if (target !== styledWordEl) { deactivateWord(styledWordEl); activateWord(target); styledWordEl = target; }
  }

  function activateWord(el) {
    if (!el) return;
    el.style.borderRadius = '3px';
    el.style.boxShadow = el._bs ? (el._bs + ', 0 0 0 2px var(--brand-400)') : '0 0 0 2px var(--brand-400)';
    if (!el._brandBg) el.style.background = 'var(--brand-100)';
  }
  function deactivateWord(el) {
    if (!el) return;
    el.style.borderRadius = el._br || '';
    el.style.boxShadow = el._bs || '';
    if (!el._brandBg) el.style.background = '';
  }

  function restoreTransitions() {
    if (refs.prog) refs.prog.style.transition = 'width .1s linear';
    if (refs.knob) refs.knob.style.transition = 'left .1s linear';
  }

  /* ============================================================
     PLAYBACK
  ============================================================ */
  function startLoop() { if (raf) cancelAnimationFrame(raf); raf = requestAnimationFrame(loop); }
  function loop() {
    if (!audio) return;
    if (segGate != null && audio.currentTime >= segGate) {
      audio.pause(); segGate = null; state.segmentEnd = null; state.currentTime = audio.currentTime;
      paintProgress(audio.currentTime); paintStatus(); paintActive(audio.currentTime, false);
      return;
    }
    const now = performance.now();
    if (now - lastTick > 55) {
      lastTick = now;
      state.currentTime = audio.currentTime;
      paintProgress(audio.currentTime);
      paintActive(audio.currentTime, true);
    }
    if (!audio.paused) raf = requestAnimationFrame(loop);
  }

  function onPlayPause() {
    if (!audio) return;
    if (audio.paused) {
      segGate = null; state.segmentStart = null; state.segmentEnd = null;
      if (state.duration && audio.currentTime >= state.duration - 0.05) audio.currentTime = 0;
      paintStatus(); audio.play();
    } else audio.pause();
  }

  function playFrom(i) {
    const seg = state.segments[i]; if (!audio || !seg) return;
    segGate = null;
    audio.currentTime = seg.start;
    state.segmentStart = null; state.segmentEnd = null; state.activeAppKey = null; state.currentTime = seg.start;
    styledActive = -1; lastScrolled = i;
    clearActiveAppHighlight();
    paintStatus(); paintProgress(seg.start); paintActive(seg.start, false);
    audio.play();
  }

  function playSegment(i, key) {
    const seg = state.segments[i]; if (!audio || !seg) return;
    segGate = seg.end;
    audio.currentTime = seg.start;
    state.segmentStart = seg.start; state.segmentEnd = seg.end; state.flashSeg = i; state.activeAppKey = key; state.currentTime = seg.start;
    styledActive = -1; lastScrolled = i;
    setActiveAppHighlight(key);
    paintStatus(); paintProgress(seg.start); paintActive(seg.start, false);
    hardScroll(i);
    flashRow(i);
    audio.play();
  }

  function clearSegment() {
    segGate = null; state.segmentStart = null; state.segmentEnd = null;
    paintStatus(); paintProgress(audio ? audio.currentTime : state.currentTime);
  }

  function jumpToCurrent() { const i = findActive(state.currentTime); hardScroll(i >= 0 ? i : 0); }

  function seekFromEvent(e) {
    if (!refs.bar || !audio || !state.duration) return;
    const r = refs.bar.getBoundingClientRect();
    let f = (e.clientX - r.left) / r.width; f = Math.max(0, Math.min(1, f));
    segGate = null; state.segmentStart = null; state.segmentEnd = null;
    refs.prog.style.transition = 'none'; refs.knob.style.transition = 'none';
    audio.currentTime = f * state.duration; state.currentTime = audio.currentTime;
    paintStatus(); paintProgress(audio.currentTime); paintActive(audio.currentTime, false);
  }

  /* ---------------- transcript highlight helpers ---------------- */
  function flashRow(i) {
    refs.segEls.forEach(s => { s.row.style.background = ''; s.row.style.boxShadow = 'none'; });
    const cur = refs.segEls[i];
    if (cur) { cur.row.style.background = 'var(--brand-50)'; cur.row.style.boxShadow = 'inset 0 0 0 2px var(--brand-400)'; }
    state.flashSeg = i;
    clearTimeout(flashTimer);
    flashTimer = setTimeout(() => {
      state.flashSeg = -1;
      const r = refs.segEls[i];
      if (r) { r.row.style.background = ''; r.row.style.boxShadow = 'none'; }
    }, 2000);
  }
  function setActiveAppHighlight(key) {
    document.querySelectorAll('[data-app-key]').forEach(el => {
      const on = el.getAttribute('data-app-key') === key;
      el.style.border = '1px solid ' + (on ? 'var(--brand-400)' : 'transparent');
      el.style.background = on ? 'var(--brand-50)' : 'transparent';
    });
  }
  function clearActiveAppHighlight() {
    document.querySelectorAll('[data-app-key]').forEach(el => { el.style.border = '1px solid transparent'; el.style.background = 'transparent'; });
  }

  function findActive(t) {
    const s = state.segments;
    for (let i = 0; i < s.length; i++) if (t >= s[i].start && t < s[i].end) return i;
    return -1;
  }
  function maybeScroll(i) {
    const c = refs.scroll; if (!c) return;
    const el = c.querySelector('[data-seg-index="' + i + '"]'); if (!el) return;
    const top = el.offsetTop, hh = el.offsetHeight;
    if (top < c.scrollTop + 24 || top + hh > c.scrollTop + c.clientHeight - 24) {
      c.scrollTo({ top: Math.max(0, top - c.clientHeight * 0.38), behavior: 'smooth' });
    }
  }
  function hardScroll(i) {
    const c = refs.scroll; if (!c) return;
    const el = c.querySelector('[data-seg-index="' + i + '"]'); if (!el) return;
    c.scrollTo({ top: Math.max(0, el.offsetTop - c.clientHeight * 0.35), behavior: 'smooth' });
  }

  /* ============================================================
     BRANDS
  ============================================================ */
  function addBrand(raw) {
    const term = (raw || '').trim();
    if (!term) return;
    if (state.brands.some(b => b.term.toLowerCase() === term.toLowerCase())) { state.brandInput = ''; if (refs.brandInput) refs.brandInput.value = ''; return; }
    state.brands = state.brands.concat([makeBrand(term)]);
    state.brandInput = '';
    scheduleBrandsSave();
    renderApp();
    if (refs.brandInput) refs.brandInput.focus();
  }
  function removeBrand(idx) {
    state.brands = state.brands.filter((_, i) => i !== idx);
    scheduleBrandsSave();
    renderApp();
  }

  /* ============================================================
     UPLOAD
  ============================================================ */
  function goUpload() { state.view = 'upload'; state.uploadError = false; renderApp(); }

  function acceptAudio(f) {
    const url = URL.createObjectURL(f);
    state.pendingAudioUrl = url; state.pendingAudioName = f.name; state.uploadError = false;
    renderApp();
  }
  function acceptJson(f) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        let data = JSON.parse(reader.result);
        if (data && !Array.isArray(data) && Array.isArray(data.segments)) data = data.segments;
        if (!Array.isArray(data)) throw new Error('format');
        const segs = data.map(s => {
          // NFC: deja los acentos como un solo code point para que normSameLen preserve los offsets
          const seg = { start: Number(s.start), end: Number(s.end), text: String(s.text == null ? '' : s.text).normalize('NFC').trim() };
          if (Array.isArray(s.words)) seg.words = s.words.map(w => ({ word: w.word, start: Number(w.start), end: Number(w.end) }));
          return seg;
        }).filter(s => isFinite(s.start) && isFinite(s.end) && s.text);
        if (!segs.length) throw new Error('empty');
        segs.sort((a, b) => a.start - b.start);
        state.pendingSegments = segs; state.pendingJsonName = f.name; state.uploadError = false;
      } catch (err) {
        state.uploadError = true;
        state.uploadErrorMsg = 'No pudimos leer el JSON. Esperamos un array de segmentos { start, end, text } en segundos.';
        state.pendingSegments = null; state.pendingJsonName = '';
      }
      renderApp();
    };
    reader.readAsText(f);
  }
  function confirmUpload() {
    if (!state.pendingAudioUrl || !state.pendingSegments) {
      state.uploadError = true; state.uploadErrorMsg = 'Cargá el audio y la transcripción JSON para continuar.';
      renderApp(); return;
    }
    if (audio) { audio.pause(); audio.currentTime = 0; audio.src = state.pendingAudioUrl; }
    segGate = null; styledActive = -1; lastScrolled = -1;
    const segs = state.pendingSegments;
    Object.assign(state, {
      view: 'main', fileName: state.pendingAudioName, audioUrl: state.pendingAudioUrl, segments: segs,
      duration: segs[segs.length - 1].end, currentTime: 0, isPlaying: false,
      segmentStart: null, segmentEnd: null, flashSeg: -1, activeAppKey: null, decodedBuffer: null,
      sessionId: null, sessionExpiresAt: null, sessionSaving: false, sessionError: false, _persisting: null,
      pendingAudioUrl: '', pendingAudioName: '', pendingSegments: null, pendingJsonName: '', uploadError: false,
    });
    renderApp();
    persistSession();   // guarda la sesión en el backend (21 días) en background
  }
  function loadSample() {
    if (audio) { audio.pause(); audio.currentTime = 0; }
    segGate = null; styledActive = -1; lastScrolled = -1; nextColor = 0;
    const segs = sampleSegments();
    const url = makeSampleAudio(segs);
    if (audio) audio.src = url;
    Object.assign(state, {
      view: 'main', fileName: 'mañana-de-mitre-tanda.mp3', audioUrl: url, segments: segs,
      brands: [makeBrand('Mercado Libre'), makeBrand('Quilmes')],
      duration: segs[segs.length - 1].end, currentTime: 0, isPlaying: false,
      segmentStart: null, segmentEnd: null, flashSeg: -1, activeAppKey: null, decodedBuffer: null,
      sessionId: null, sessionExpiresAt: null, sessionSaving: false, sessionError: false, _persisting: null,
      pendingAudioUrl: '', pendingAudioName: '', pendingSegments: null, pendingJsonName: '', uploadError: false,
    });
    renderApp();
  }

  /* ============================================================
     BACKEND — persistencia (sesiones 21 días) + reportes
     El backend Node sirve esta misma app. Si no responde (p. ej. la app
     abierta como archivo suelto), estas features se degradan sin romper el core.
  ============================================================ */
  function brandsPayload() { return state.brands.map(b => ({ term: b.term, color: b.color })); }

  // Sube la sesión actual (audio + transcript + marcas) al backend. Idempotente.
  function persistSession() {
    if (state.sessionId) return Promise.resolve();
    if (state._persisting) return state._persisting;
    state.sessionSaving = true; state.sessionError = false; paintSaveStatus();
    state._persisting = (async () => {
      try {
        const blob = await fetch(state.audioUrl).then(r => r.blob());
        const fd = new FormData();
        fd.append('audio', blob, state.fileName || 'audio');
        fd.append('fileName', state.fileName || 'audio');
        fd.append('transcript', JSON.stringify(state.segments));
        fd.append('brands', JSON.stringify(brandsPayload()));
        const res = await fetch(API_BASE + '/api/sessions', { method: 'POST', body: fd });
        if (!res.ok) throw new Error('http ' + res.status);
        const data = await res.json();
        state.sessionId = data.id; state.sessionExpiresAt = data.expiresAt; state.sessionError = false;
      } catch (e) {
        state.sessionError = true;
      } finally {
        state.sessionSaving = false; state._persisting = null; paintSaveStatus();
      }
    })();
    return state._persisting;
  }

  async function ensureSession() {
    if (state.sessionId) return true;
    await persistSession();
    return !!state.sessionId;
  }

  // Guarda las marcas (debounced) si ya hay sesión.
  function scheduleBrandsSave() {
    if (!state.sessionId) return;
    clearTimeout(brandsSaveTimer);
    brandsSaveTimer = setTimeout(() => {
      fetch(API_BASE + '/api/sessions/' + state.sessionId + '/brands', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ brands: brandsPayload() }),
      }).catch(() => {});
    }, 800);
  }

  function paintSaveStatus() {
    const el = refs.saveStatus; if (!el) return;
    if (state.sessionSaving) { el.style.display = 'inline-flex'; el.textContent = 'Guardando…'; el.style.color = 'var(--gray-500)'; }
    else if (state.sessionId) { el.style.display = 'inline-flex'; el.textContent = 'Guardado · vence ' + shortDate(state.sessionExpiresAt); el.style.color = 'var(--brand-600)'; }
    else if (state.sessionError) { el.style.display = 'inline-flex'; el.textContent = 'Sin guardar (sin conexión)'; el.style.color = 'var(--red-600)'; }
    else { el.style.display = 'none'; }
  }

  function shortDate(ms) { const d = new Date(ms); return pad2(d.getDate()) + '/' + pad2(d.getMonth() + 1); }
  function shortDateLong(ms) {
    const meses = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
    const d = new Date(ms); return d.getDate() + ' de ' + meses[d.getMonth()] + ' de ' + d.getFullYear();
  }

  let toastTimer = 0;
  function toast(msg, isErr) {
    let el = document.getElementById('mtoast');
    if (!el) {
      el = h('div', { id: 'mtoast', style: {
        position: 'fixed', bottom: '104px', left: '50%', transform: 'translateX(-50%)', zIndex: '60',
        padding: '10px 16px', borderRadius: '8px', fontSize: '13px', fontWeight: '600', color: '#fff',
        boxShadow: 'var(--shadow-lg)', maxWidth: '90%', textAlign: 'center',
      } });
      document.body.appendChild(el);
    }
    el.style.background = isErr ? 'var(--red-600)' : 'var(--gray-800)';
    el.textContent = msg; el.style.display = 'block';
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { el.style.display = 'none'; }, 3200);
  }

  // Lista de audios recientes (no vencidos) en la pantalla de carga.
  async function loadRecentSessions() {
    const wrap = refs.recentWrap, list = refs.recent;
    if (!wrap || !list) return;
    try {
      const res = await fetch(API_BASE + '/api/sessions');
      if (!res.ok) throw new Error('http');
      const data = await res.json();
      const sessions = (data && data.sessions) || [];
      if (!sessions.length) { wrap.style.display = 'none'; return; }
      list.innerHTML = '';
      sessions.forEach(s => list.appendChild(renderRecentRow(s)));
      wrap.style.display = 'block';
    } catch (e) { wrap.style.display = 'none'; }
  }

  function renderRecentRow(s) {
    return h('div', { class: 'recent-row', onClick: () => openSession(s.id), style: {
      display: 'flex', alignItems: 'center', gap: '12px', padding: '11px 14px', background: '#fff',
      border: '1px solid var(--gray-200)', borderRadius: '8px', cursor: 'pointer', marginBottom: '8px', transition: 'background .15s, border-color .15s',
    } },
      h('div', { style: { width: '34px', height: '34px', flex: 'none', borderRadius: '7px', background: 'var(--brand-50)', display: 'flex', alignItems: 'center', justifyContent: 'center' } }, svg(I.wave('var(--brand-600)'))),
      h('div', { style: { flex: '1', minWidth: '0' } },
        h('div', { style: { fontSize: '14px', fontWeight: '600', color: 'var(--gray-800)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, s.fileName),
        h('div', { style: { fontSize: '12px', color: 'var(--gray-500)', marginTop: '2px' } },
          s.segmentCount + ' segmentos · ' + s.brandCount + (s.brandCount === 1 ? ' marca' : ' marcas') + ' · vence ' + shortDate(s.expiresAt)),
      ),
      h('div', { style: { flex: 'none', fontSize: '12px', fontWeight: '600', color: 'var(--brand-600)' } }, 'Abrir →'),
    );
  }

  // Reabre una sesión guardada (audio servido por el backend).
  async function openSession(id) {
    try {
      const res = await fetch(API_BASE + '/api/sessions/' + id);
      if (!res.ok) throw new Error('http');
      const s = await res.json();
      const segs = Array.isArray(s.segments) ? s.segments : [];
      const brands = (s.brands || []).map(b => (b && b.color) ? { term: b.term, color: b.color } : makeBrand(typeof b === 'string' ? b : (b && b.term) || ''));
      nextColor = brands.length;
      const audioUrl = API_BASE + '/api/sessions/' + id + '/audio';
      if (audio) { audio.pause(); audio.currentTime = 0; audio.src = audioUrl; }
      segGate = null; styledActive = -1; lastScrolled = -1;
      Object.assign(state, {
        view: 'main', fileName: s.fileName, audioUrl, segments: segs,
        duration: segs.length ? segs[segs.length - 1].end : 0, currentTime: 0, isPlaying: false,
        segmentStart: null, segmentEnd: null, flashSeg: -1, activeAppKey: null, decodedBuffer: null,
        brands, sessionId: s.id, sessionExpiresAt: s.expiresAt, sessionSaving: false, sessionError: false, _persisting: null,
        pendingAudioUrl: '', pendingAudioName: '', pendingSegments: null, pendingJsonName: '', uploadError: false,
      });
      renderApp();
    } catch (e) {
      state.uploadError = true;
      state.uploadErrorMsg = 'No se pudo abrir el audio guardado (puede haber vencido).';
      renderApp();
    }
  }

  // Descarta el audio cargado: lo borra del backend (sesión + reportes) y vuelve a la pantalla de carga.
  async function discardAudio() {
    const hasSession = !!state.sessionId;
    const msg = hasSession
      ? '¿Descartar este audio? Se borra del servidor junto con los reportes ya generados para sus marcas. Esta acción no se puede deshacer.'
      : '¿Descartar el audio cargado?';
    if (!window.confirm(msg)) return;
    const id = state.sessionId;
    if (id) { try { await fetch(API_BASE + '/api/sessions/' + id, { method: 'DELETE' }); } catch (e) {} }
    if (audio) { audio.pause(); try { audio.removeAttribute('src'); audio.load(); } catch (e) {} }
    segGate = null; styledActive = -1; lastScrolled = -1; nextColor = 0;
    Object.assign(state, {
      view: 'upload', fileName: '', audioUrl: '', segments: [], brands: [],
      duration: 0, currentTime: 0, isPlaying: false, segmentStart: null, segmentEnd: null,
      flashSeg: -1, activeAppKey: null, decodedBuffer: null,
      sessionId: null, sessionExpiresAt: null, sessionSaving: false, sessionError: false, _persisting: null,
      pendingAudioUrl: '', pendingAudioName: '', pendingSegments: null, pendingJsonName: '', uploadError: false,
    });
    renderApp();
    toast('Audio descartado.');
  }

  /* ============================================================
     TEXT MATCHING (case-insensitive, accent-insensitive, word-bounded)
  ============================================================ */
  const COMBINING = /[̀-ͯ]/g; // diacritical marks, stripped after NFD
  function normSameLen(text) {
    let out = '';
    for (const ch of text) out += ch.normalize('NFD').replace(COMBINING, '').toLowerCase();
    return out;
  }
  function buildRe(term) {
    const t = normSameLen(term).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
    if (!t) return null;
    return new RegExp('(^|[^\\p{L}\\p{N}])(' + t + ')(?=[^\\p{L}\\p{N}]|$)', 'giu');
  }
  function computeMatches() {
    const segHL = state.segments.map(() => []);
    const brandApp = state.brands.map(() => []);
    state.segments.forEach((seg, si) => {
      const norm = normSameLen(seg.text);
      state.brands.forEach((b, bi) => {
        const re = buildRe(b.term); if (!re) return;
        let m;
        while ((m = re.exec(norm))) {
          const start = m.index + m[1].length;
          const end = start + m[2].length;
          segHL[si].push({ start, end, bi });
          brandApp[bi].push({ si, start, end });
          re.lastIndex = end;
        }
      });
      segHL[si].sort((a, b) => a.start - b.start);
    });
    return { segHL, brandApp };
  }
  function buildParts(text, hls) {
    const parts = []; let pos = 0;
    for (const hl of hls) {
      if (hl.start < pos) continue;
      if (hl.start > pos) parts.push(document.createTextNode(text.slice(pos, hl.start)));
      const c = state.brands[hl.bi].color;
      parts.push(h('span', { style: {
        background: c.bg, color: c.fg, borderRadius: '3px', padding: '0.5px 3px', fontWeight: '700', boxShadow: 'inset 0 -2px 0 ' + c.line,
      } }, text.slice(hl.start, hl.end)));
      pos = hl.end;
    }
    if (pos < text.length) parts.push(document.createTextNode(text.slice(pos)));
    if (!parts.length) parts.push(document.createTextNode(text));
    return parts;
  }
  function buildSnippet(text, start, end, color) {
    const parts = [];
    if (start > 0) parts.push(document.createTextNode(text.slice(0, start)));
    parts.push(h('span', { style: { color: color.fg, fontWeight: '700' } }, text.slice(start, end)));
    if (end < text.length) parts.push(document.createTextNode(text.slice(end)));
    return parts;
  }

  function fmt(s) {
    if (!isFinite(s) || s < 0) s = 0;
    const m = Math.floor(s / 60), sec = Math.floor(s % 60);
    return (m < 10 ? '0' : '') + m + ':' + (sec < 10 ? '0' : '') + sec;
  }

  /* ============================================================
     WORD-LEVEL KARAOKE (resaltado palabra por palabra)
     Usa timestamps de palabras del JSON si están; si no, aproxima
     repartiendo el segmento por largo de palabra.
  ============================================================ */
  const TOKEN_RE = /\S+|\s+/g;
  function tokenize(text) {
    const toks = []; let m;
    TOKEN_RE.lastIndex = 0;
    while ((m = TOKEN_RE.exec(text))) toks.push({ text: m[0], isWord: /\S/.test(m[0]), cstart: m.index, cend: m.index + m[0].length });
    return toks;
  }
  function wordTimesFor(seg, words) {
    if (Array.isArray(seg.words) && seg.words.length === words.length
        && seg.words.every(w => isFinite(+w.start) && isFinite(+w.end))) {
      return seg.words.map(w => ({ start: +w.start, end: +w.end }));
    }
    const span = Math.max(0.001, seg.end - seg.start);
    const weights = words.map(w => Math.max(1, w.text.length));
    const total = weights.reduce((a, b) => a + b, 0) || 1;
    let acc = 0;
    return words.map((w, i) => {
      const start = seg.start + (acc / total) * span; acc += weights[i];
      return { start, end: seg.start + (acc / total) * span };
    });
  }
  // Build transcript nodes; when karaoke, words become spans carrying their time range.
  function transcriptNodes(seg, hls, karaoke) {
    if (!karaoke) return { nodes: buildParts(seg.text, hls), wordSpans: null };
    const text = seg.text;
    const words = tokenize(text).filter(t => t.isWord);
    const times = wordTimesFor(seg, words);
    const timeByStart = {};
    words.forEach((w, i) => { timeByStart[w.cstart] = times[i]; });
    const rangeTime = (a, b) => {
      let s = Infinity, e = -Infinity;
      for (let i = 0; i < words.length; i++) if (words[i].cstart < b && words[i].cend > a) { s = Math.min(s, times[i].start); e = Math.max(e, times[i].end); }
      if (s === Infinity) { const span = Math.max(0.001, seg.end - seg.start), L = Math.max(1, text.length); return { start: seg.start + (a / L) * span, end: seg.start + (b / L) * span }; }
      return { start: s, end: e };
    };
    const nodes = [], wordSpans = [];
    const emitGap = (sub, base) => {
      for (const tk of tokenize(sub)) {
        if (tk.isWord) {
          const span = h('span', {}, tk.text);
          const tm = timeByStart[base + tk.cstart] || rangeTime(base + tk.cstart, base + tk.cend);
          span._bs = ''; span._br = ''; span._brandBg = false;
          wordSpans.push({ el: span, start: tm.start, end: tm.end });
          nodes.push(span);
        } else nodes.push(document.createTextNode(tk.text));
      }
    };
    let pos = 0;
    for (const hl of hls) {
      if (hl.start < pos) continue;
      if (hl.start > pos) emitGap(text.slice(pos, hl.start), pos);
      const c = state.brands[hl.bi].color;
      const span = h('span', { style: { background: c.bg, color: c.fg, borderRadius: '3px', padding: '0.5px 3px', fontWeight: '700', boxShadow: 'inset 0 -2px 0 ' + c.line } }, text.slice(hl.start, hl.end));
      span._bs = 'inset 0 -2px 0 ' + c.line; span._br = '3px'; span._brandBg = true;
      const tm = rangeTime(hl.start, hl.end);
      wordSpans.push({ el: span, start: tm.start, end: tm.end });
      nodes.push(span);
      pos = hl.end;
    }
    if (pos < text.length) emitGap(text.slice(pos), pos);
    if (!nodes.length) nodes.push(document.createTextNode(text));
    wordSpans.sort((a, b) => a.start - b.start);
    return { nodes, wordSpans };
  }

  /* ============================================================
     EXPORT & SHARE
     - exportCSV: todas las menciones a CSV.
     - buildBrandClips / generateReport: recorta los clips de cada marca en el
       browser y los sube al backend; devuelve el link público del reporte (la
       marca solo ve y escucha SUS fragmentos — aislamiento estructural).
  ============================================================ */
  function slugify(s) {
    return (normSameLen(s) || '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'audio';
  }
  function baseName(name) { return (name || '').replace(/\.[^.]+$/, ''); }
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function todayISO() { const d = new Date(); return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); }
  function downloadBlob(content, filename, type) {
    const blob = content instanceof Blob ? content : new Blob([content], { type: type || 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = h('a', { href: url, download: filename, style: { display: 'none' } });
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }
  function csvCell(v) { const s = v == null ? '' : String(v); return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }
  function exportCSV() {
    const mc = computeMatches();
    const rows = [['Programa', 'Marca', 'Mención #', 'Inicio (mm:ss)', 'Fin (mm:ss)', 'Inicio (s)', 'Fin (s)', 'Duración (s)', 'Texto del segmento']];
    state.brands.forEach((b, bi) => {
      mc.brandApp[bi].forEach((ap, idx) => {
        const seg = state.segments[ap.si];
        rows.push([state.fileName, b.term, idx + 1, fmt(seg.start), fmt(seg.end), seg.start.toFixed(2), seg.end.toFixed(2), (seg.end - seg.start).toFixed(2), seg.text]);
      });
    });
    const csv = rows.map(r => r.map(csvCell).join(',')).join('\r\n');
    const BOM = String.fromCharCode(0xFEFF); // Excel lee acentos correctamente
    downloadBlob(BOM + csv, 'menciones_' + slugify(baseName(state.fileName)) + '_' + todayISO() + '.csv', 'text/csv;charset=utf-8');
  }

  // Clip [start,end] (+pad seconds) of an AudioBuffer to a mono 16-bit WAV (<= targetSR).
  function clipToWav(buffer, start, end, pad, targetSR) {
    const sr = buffer.sampleRate, ch = buffer.numberOfChannels;
    const s0 = Math.max(0, Math.floor((start - pad) * sr));
    const s1 = Math.min(buffer.length, Math.ceil((end + pad) * sr));
    if (s0 >= buffer.length || s1 <= s0) return null; // segmento fuera del audio (transcripción/audio desfasados)
    const srcLen = Math.max(1, s1 - s0);
    const mono = new Float32Array(srcLen);
    for (let c = 0; c < ch; c++) { const d = buffer.getChannelData(c); for (let i = 0; i < srcLen; i++) mono[i] += d[s0 + i] / ch; }
    const outSR = Math.min(targetSR, sr);
    let out;
    if (outSR === sr) out = mono;
    else {
      const ratio = outSR / sr, outLen = Math.max(1, Math.round(srcLen * ratio));
      out = new Float32Array(outLen);
      for (let i = 0; i < outLen; i++) {
        const sp = i / ratio, i0 = Math.floor(sp), i1 = Math.min(srcLen - 1, i0 + 1), f = sp - i0;
        out[i] = (mono[i0] || 0) * (1 - f) + (mono[i1] || 0) * f;
      }
    }
    const int16 = new Int16Array(out.length);
    for (let i = 0; i < out.length; i++) { const v = Math.max(-1, Math.min(1, out[i])); int16[i] = v < 0 ? v * 0x8000 : v * 0x7FFF; }
    return writeWav(int16, outSR);
  }

  // Un único AudioContext para toda la sesión (evita el límite de contextos del navegador).
  function getAudioCtx() {
    if (!_sharedCtx) { const C = window.AudioContext || window.webkitAudioContext; _sharedCtx = new C(); }
    return _sharedCtx;
  }

  // Recorta los clips de UNA marca en el browser (decode + clipToWav). Devuelve
  // fragments con el WAV (ArrayBuffer) por segmento. Lo usan tanto el download
  // HTML (base64) como el reporte hosteado (blob). Aislamiento estructural: solo
  // se generan los segmentos de ESTA marca.
  async function buildBrandClips(brand, apps) {
    const bySeg = new Map();
    apps.forEach(ap => { if (!bySeg.has(ap.si)) bySeg.set(ap.si, []); bySeg.get(ap.si).push(ap); });
    const segIdxs = [...bySeg.keys()].sort((a, b) => a - b);

    // decode una vez por audio y cachear (reusado entre marcas); archivos gigantes → solo texto
    let buffer = state.decodedBuffer, decodeFailed = false;
    if (!buffer && state.audioUrl) {
      try {
        const raw = await fetch(state.audioUrl).then(r => r.arrayBuffer());
        if (raw.byteLength > MAX_DECODE_BYTES) decodeFailed = true;
        else { buffer = await getAudioCtx().decodeAudioData(raw); state.decodedBuffer = buffer; }
      } catch (e) { decodeFailed = true; }
    }

    const fragments = segIdxs.map(si => {
      const seg = state.segments[si];
      const ranges = bySeg.get(si).map(ap => ({ start: ap.start, end: ap.end })).sort((a, b) => a.start - b.start);
      let wav = null;
      if (buffer) { try { wav = clipToWav(buffer, seg.start, seg.end, 0.3, 16000) || null; } catch (e) {} }
      return { t: fmt(seg.start), start: seg.start, end: seg.end, dur: Math.max(0, seg.end - seg.start), text: seg.text, ranges, wav };
    });
    const noAudio = decodeFailed || !fragments.some(f => f.wav);
    return { fragments, noAudio };
  }

  // Genera el reporte hosteado de una marca: recorta clips en el browser, los
  // sube al backend y muestra la URL pública (token, sin login, vence con la sesión).
  async function generateReport(brand, bi, apps, btn, resultEl) {
    if (btn && btn._busy) return;
    const orig = btn ? (btn._origHtml || (btn._origHtml = btn.innerHTML)) : null;
    const setBtn = (txt, busy) => { if (!btn) return; btn.textContent = txt; btn.style.opacity = busy ? '0.7' : '1'; btn.style.cursor = busy ? 'default' : 'pointer'; btn._busy = !!busy; };
    const restore = () => { if (!btn) return; btn.innerHTML = orig; btn.style.opacity = '1'; btn.style.cursor = 'pointer'; btn._busy = false; };

    setBtn('Guardando audio…', true);
    const ok = await ensureSession();
    if (!ok) { restore(); toast('No se pudo guardar la sesión en el servidor. Revisá la conexión.', true); return; }

    setBtn('Generando…', true);
    try {
      const { fragments, noAudio } = await buildBrandClips(brand, apps);
      const fd = new FormData();
      fd.append('brandTerm', brand.term);
      fd.append('brandColor', JSON.stringify(brand.color));
      fd.append('programName', state.fileName);
      fd.append('noAudio', noAudio ? '1' : '0');
      const mentions = fragments.map((f, i) => ({
        t: f.t, start: f.start, end: f.end, dur: f.dur, text: f.text, ranges: f.ranges, clip: f.wav ? i : null,
      }));
      fd.append('mentions', JSON.stringify(mentions));
      fragments.forEach((f, i) => { if (f.wav) fd.append('clips', new Blob([f.wav], { type: 'audio/wav' }), 'clip-' + i + '.wav'); });

      const res = await fetch(API_BASE + '/api/sessions/' + state.sessionId + '/reports', { method: 'POST', body: fd });
      if (!res.ok) throw new Error('http ' + res.status);
      const data = await res.json();
      restore();
      showReportLink(resultEl, data.url, data.expiresAt);
    } catch (e) {
      restore();
      toast('No se pudo generar el reporte de ' + brand.term + '.', true);
    }
  }

  function showReportLink(el, url, expiresAt) {
    if (!el) return;
    el.innerHTML = ''; el.style.display = 'block'; el.style.marginTop = '2px';
    const input = h('input', { value: url, readOnly: true, onClick: (e) => e.target.select(), style: {
      flex: '1', minWidth: '0', padding: '7px 9px', border: '1px solid var(--gray-300)', borderRadius: '6px',
      fontFamily: 'var(--font-sans)', fontSize: '12px', color: 'var(--gray-700)', background: 'var(--gray-50)', outline: 'none',
    } });
    const copyBtn = h('button', { class: 'copy-btn', style: {
      display: 'inline-flex', alignItems: 'center', gap: '5px', flex: 'none', padding: '7px 10px',
      border: '1px solid var(--gray-300)', borderRadius: '6px', background: '#fff', cursor: 'pointer',
      fontFamily: 'var(--font-sans)', fontSize: '12px', fontWeight: '600', color: 'var(--gray-700)',
    } }, svg(I.copy), 'Copiar');
    copyBtn.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(url); } catch (_) { input.select(); try { document.execCommand('copy'); } catch (_2) {} }
      copyBtn.lastChild.textContent = '¡Copiado!';
      setTimeout(() => { copyBtn.lastChild.textContent = 'Copiar'; }, 1600);
    });
    const note = h('div', { style: { fontSize: '11px', color: 'var(--gray-500)', marginTop: '5px', lineHeight: '1.45' } },
      'Link público (cualquiera con el link lo ve). Vence el ' + shortDateLong(expiresAt) + '. ',
      h('a', { href: url, target: '_blank', rel: 'noopener', class: 'link-sample', style: { color: 'var(--brand-600)', fontWeight: '600', textDecoration: 'none' } }, 'Abrir'),
    );
    el.append(h('div', { style: { display: 'flex', gap: '6px' } }, input, copyBtn), note);
  }

  /* ============================================================
     SAMPLE DATA (audio + transcript demo — el punto a reemplazar
     más adelante por una API de transcripción real)
  ============================================================ */
  function sampleSegments() {
    return [
      { start: 0.0, end: 3.4, text: 'Buenos días, son las nueve y diez en la primera mañana de Radio Mitre.' },
      { start: 3.4, end: 7.2, text: 'Arrancamos como todos los días con el repaso de la información más importante.' },
      { start: 7.2, end: 11.0, text: 'Pero antes, una pausa para agradecer a quienes hacen posible este programa.' },
      { start: 11.0, end: 15.4, text: 'Hoy te traigo una propuesta de Mercado Libre que no podés dejar pasar.' },
      { start: 15.4, end: 19.6, text: 'En Mercado Libre arrancó el Hot Sale con miles de productos en cuotas sin interés.' },
      { start: 19.6, end: 23.4, text: 'Entrás a la app de Mercado Libre, buscás lo que querés y lo recibís en tu casa.' },
      { start: 23.4, end: 27.0, text: 'Envío gratis en miles de productos seleccionados. Así de simple.' },
      { start: 27.0, end: 31.2, text: 'Y si pagás con tu tarjeta sumás todavía más beneficios. No te lo pierdas.' },
      { start: 31.2, end: 35.0, text: 'Seguimos. El clima para hoy en la Ciudad de Buenos Aires.' },
      { start: 35.0, end: 38.6, text: 'Una máxima de veintidós grados y cielo algo nublado por la tarde.' },
      { start: 38.6, end: 42.8, text: 'Tiempo de hablar de otra marca que nos acompaña hace años: Quilmes.' },
      { start: 42.8, end: 47.0, text: 'Quilmes presenta su nueva campaña pensada para el encuentro entre amigos.' },
      { start: 47.0, end: 51.0, text: 'Porque del otro lado siempre hay alguien esperando para brindar con Quilmes.' },
      { start: 51.0, end: 54.6, text: 'Disfrutá de un consumo responsable. Quilmes, el sabor del encuentro.' },
      { start: 54.6, end: 58.4, text: 'Pasamos a los títulos del día en materia económica.' },
      { start: 58.4, end: 62.6, text: 'El precio de los combustibles vuelve a estar en el centro de la escena.' },
      { start: 62.6, end: 66.8, text: 'YPF confirmó una actualización en sus surtidores a partir de la medianoche.' },
      { start: 66.8, end: 70.4, text: 'Desde YPF aclararon que el ajuste sigue la evolución del tipo de cambio.' },
      { start: 70.4, end: 74.2, text: 'En el plano financiero, Banco Galicia lanzó una nueva línea de créditos.' },
      { start: 74.2, end: 78.0, text: 'Banco Galicia ofrece tasas preferenciales para pequeñas empresas.' },
      { start: 78.0, end: 81.8, text: 'Y ahora sí, la tanda. Ya volvemos con la entrevista del día.' },
      { start: 81.8, end: 85.6, text: 'Farmacity te cuida todo el año con sus precios de farmacia.' },
      { start: 85.6, end: 89.4, text: 'Encontrá tu sucursal de Farmacity más cercana y aprovechá las promociones.' },
      { start: 89.4, end: 93.0, text: 'Con Movistar tenés más gigas para navegar donde estés.' },
      { start: 93.0, end: 96.6, text: 'Movistar, la red que te conecta con lo que más te importa.' },
      { start: 96.6, end: 100.2, text: 'Y para acompañar tu día, nada mejor que una Coca-Cola bien fría.' },
      { start: 100.2, end: 103.8, text: 'Coca-Cola, presente en cada momento especial.' },
      { start: 103.8, end: 107.6, text: 'Volvemos en breve con toda la actualidad de la mañana en Radio Mitre.' },
    ];
  }

  function makeSampleAudio(segments) {
    const sr = 8000;
    const total = (segments.length ? segments[segments.length - 1].end : 1) + 0.4;
    const n = Math.floor(total * sr);
    const data = new Int16Array(n);
    const scale = [220.0, 247.0, 262.0, 294.0, 330.0, 392.0, 294.0, 247.0];
    const amp = 0.05;
    segments.forEach((seg, i) => {
      const f = scale[i % scale.length] * (i % 2 === 0 ? 1 : 1.5);
      const s0 = Math.floor(seg.start * sr), s1 = Math.floor(seg.end * sr), len = s1 - s0;
      const fade = Math.floor(0.04 * sr);
      for (let k = 0; k < len; k++) {
        const tt = k / sr;
        let env = 1;
        if (k < fade) env = k / fade;
        else if (k > len - fade) env = (len - k) / fade;
        const trem = 0.72 + 0.28 * Math.sin(2 * Math.PI * 4.5 * tt);
        const v = Math.sin(2 * Math.PI * f * tt) * amp * env * trem;
        const idx = s0 + k;
        if (idx >= 0 && idx < n) data[idx] = Math.max(-1, Math.min(1, v)) * 32767;
      }
    });
    return URL.createObjectURL(new Blob([writeWav(data, sr)], { type: 'audio/wav' }));
  }

  // 16-bit mono PCM WAV from an Int16Array. Shared by the demo generator and the clip exporter.
  function writeWav(int16, sampleRate) {
    const bytes = 44 + int16.length * 2;
    const buf = new ArrayBuffer(bytes);
    const view = new DataView(buf);
    const ws = (off, str) => { for (let i = 0; i < str.length; i++) view.setUint8(off + i, str.charCodeAt(i)); };
    ws(0, 'RIFF'); view.setUint32(4, bytes - 8, true); ws(8, 'WAVE');
    ws(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
    view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
    ws(36, 'data'); view.setUint32(40, int16.length * 2, true);
    let off = 44;
    for (let i = 0; i < int16.length; i++) { view.setInt16(off, int16[i], true); off += 2; }
    return buf;
  }

  /* ---------------- go ---------------- */
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
