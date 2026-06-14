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
    // upload staging
    pendingAudioUrl: '', pendingAudioName: '', pendingSegments: null, pendingJsonName: '',
    uploadError: false, uploadErrorMsg: '',
  };

  // runtime refs (rebuilt on every renderApp)
  const refs = {};
  // audio + file inputs persist across renders so playback never breaks
  let audio, audioInput, jsonInput;
  let segGate = null;        // auto-pause boundary (seconds) for "play segment"
  let styledActive = -1;     // segment index currently styled as active
  let lastScrolled = -1;
  let scrubbing = false;
  let raf = 0, lastTick = 0, flashTimer = 0;
  const root = document.getElementById('app');

  /* ============================================================
     INIT
  ============================================================ */
  function init() {
    if (ACCENT === 'mitre') for (const k in ACCENT_VARS) root.style.setProperty(k, `var(${ACCENT_VARS[k]})`);

    audio = h('audio', { preload: 'auto', style: { display: 'none' } });
    audio.addEventListener('loadedmetadata', () => {
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
      paintStatus(); paintProgress(audio.currentTime);
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
    styledActive = -1; lastScrolled = -1;
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

    return h('div', { style: {
      flex: '1', minHeight: '0', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'var(--gray-50)', padding: '40px', overflow: 'auto',
    } }, card);
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
      h('div', { class: 'jump-btn', onClick: jumpToCurrent, style: {
        display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '6px 11px', border: '1px solid var(--gray-200)',
        borderRadius: '6px', fontSize: '12px', fontWeight: '600', color: 'var(--gray-600)', cursor: 'pointer',
      } }, svg(I.down), 'Ir a lo que suena'),
    );

    const scroll = h('div', { style: {
      flex: '1', minHeight: '0', overflowY: 'auto', padding: '10px 14px 24px', position: 'relative',
    } });
    refs.scroll = scroll;
    refs.segEls = [];

    const mc = computeMatches();
    state.segments.forEach((seg, i) => {
      const fill = h('div', { style: {
        position: 'absolute', left: '0', top: '0', bottom: '0', width: '0%', background: 'var(--brand-50)',
        transition: 'width .12s linear', pointerEvents: 'none', zIndex: '0',
      } });
      const text = h('div', { style: {
        position: 'relative', zIndex: '1', flex: '1', minWidth: '0', fontSize: '15.5px', lineHeight: '1.62',
        color: 'var(--gray-700)', textWrap: 'pretty',
      } });
      buildParts(seg.text, mc.segHL[i]).forEach(p => text.appendChild(p));

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
      refs.segEls.push({ row, fill });
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

    const headerKids = [
      h('div', { style: { fontSize: '15px', fontWeight: '700', color: 'var(--gray-800)' } }, 'Marcas a verificar'),
      h('div', { style: { fontSize: '12px', color: 'var(--gray-500)', marginTop: '2px' } }, 'Buscá una o más marcas para ver y escuchar dónde se nombran.'),
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

    return h('div', { style: { flex: 'none', width: '392px', display: 'flex', flexDirection: 'column', background: 'var(--gray-50)' } }, header, list);
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

    const exitBtn = h('div', { class: 'exit-seg', onClick: clearSegment, style: {
      display: 'none', alignItems: 'center', gap: '7px', padding: '8px 12px', border: '1px solid var(--gray-300)',
      borderRadius: '6px', fontSize: '12.5px', fontWeight: '600', color: 'var(--gray-600)', cursor: 'pointer', flex: 'none',
    } }, svg(I.xThin), 'Salir del segmento');
    refs.exitBtn = exitBtn;

    return h('div', { style: {
      flex: 'none', height: '86px', background: '#fff', borderTop: '1px solid var(--gray-200)', display: 'flex',
      alignItems: 'center', gap: '20px', padding: '0 24px', boxShadow: '0 -2px 8px rgba(0,0,0,.04)', zIndex: '6',
    } }, playBtn, middle, exitBtn);
  }

  /* ============================================================
     PAINT (cheap live updates, no re-render)
  ============================================================ */
  function paintAll() {
    if (state.view !== 'main') return;
    const t = audio ? audio.currentTime : state.currentTime;
    paintStatus(); paintProgress(t); paintActive(t, false);
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
    renderApp();
    if (refs.brandInput) refs.brandInput.focus();
  }
  function removeBrand(idx) {
    state.brands = state.brands.filter((_, i) => i !== idx);
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
        const segs = data.map(s => ({ start: Number(s.start), end: Number(s.end), text: String(s.text == null ? '' : s.text).trim() }))
          .filter(s => isFinite(s.start) && isFinite(s.end) && s.text);
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
      segmentStart: null, segmentEnd: null, flashSeg: -1, activeAppKey: null,
      pendingAudioUrl: '', pendingAudioName: '', pendingSegments: null, pendingJsonName: '', uploadError: false,
    });
    renderApp();
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
      segmentStart: null, segmentEnd: null, flashSeg: -1, activeAppKey: null,
      pendingAudioUrl: '', pendingAudioName: '', pendingSegments: null, pendingJsonName: '', uploadError: false,
    });
    renderApp();
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
    const bytes = 44 + data.length * 2;
    const buf = new ArrayBuffer(bytes);
    const view = new DataView(buf);
    const ws = (off, str) => { for (let i = 0; i < str.length; i++) view.setUint8(off + i, str.charCodeAt(i)); };
    ws(0, 'RIFF'); view.setUint32(4, bytes - 8, true); ws(8, 'WAVE');
    ws(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
    view.setUint32(24, sr, true); view.setUint32(28, sr * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
    ws(36, 'data'); view.setUint32(40, data.length * 2, true);
    let off = 44;
    for (let i = 0; i < data.length; i++) { view.setInt16(off, data[i], true); off += 2; }
    return URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }));
  }

  /* ---------------- go ---------------- */
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
