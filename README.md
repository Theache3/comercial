# Verificador de menciones — Radio Mitre

Herramienta interna del equipo comercial para **verificar menciones de marca al aire**.
Cargás un audio (una tanda, un programa, un PNT grabado) junto con su transcripción con
timestamps, y la app te deja **buscar marcas, contar cuántas veces se nombran y escuchar
exactamente dónde**.

## Cómo se usa

1. **Local:** `cd server && npm install && npm start`, y abrí **http://localhost:8090**
   (Chrome/Edge/Firefox). Arranca con un **ejemplo precargado** (programa de mañana con tanda +
   PNT, ~1:48) para que veas el flujo andando. *(El backend habilita guardar audios 21 días y
   generar links de reporte; sin él, la app igual sirve para reproducir y verificar.)*
2. **Transcripción** (columna izquierda): cada segmento es clickeable; salta y reproduce
   desde ese momento. El segmento que suena se resalta tipo karaoke y la vista se autoscrollea.
3. **Marcas a verificar** (columna derecha): escribí una marca y presioná Enter o "Agregar".
   Cada marca queda como chip (removible) con su color, un contador de menciones y la lista de
   apariciones (timestamp + contexto). Click en una aparición = reproduce **solo ese segmento**
   y lo resalta en la transcripción.
4. **Mini player** (abajo): play/pausa, barra scrubbeable, tiempo actual / total y **velocidad
   de reproducción** (0,5× a 2×, botón a la derecha). Al reproducir una mención, pausa
   automáticamente al terminar el segmento ("Salir del segmento" vuelve al modo normal).

La búsqueda es **case-insensitive**, **ignora acentos** y matchea la marca **como palabra**
(no como subcadena), con un color distinto por marca.

## Compartir a cada marca sus menciones

Cada tarjeta de marca tiene el botón **"Generar link de reporte"**, con **aislamiento estructural**:
la marca solo ve y escucha **sus propios fragmentos** (cada mención recortada a su clip), nunca la
transcripción completa ni otras marcas.

Recorta los clips de la marca (en el browser), los sube al backend y devuelve una **URL para
compartir** (`https://comlog.cienradios.com/r/<token>`). La marca abre el link en cualquier
navegador o celular y ve una **página standalone** (sin ningún link interno a la herramienta) con
sus menciones: horario (mm:ss), el texto con su marca resaltada, un botón para reproducir cada clip
y "Reproducir todo". Es **público por token impredecible** (sin login) y **vence a los 21 días de
cargado el audio**. Si el navegador no puede procesar el audio (codec raro), el reporte igual queda
con los **textos y horarios** y un aviso de "audio no disponible".

## Otras acciones

- **Recortar audio** (arriba de la transcripción): activás el modo, tocás la **línea de inicio** y la
  **línea final**; el tramo entre medio se resalta. Después podés **Escuchar** ese tramo (se pausa solo
  al terminar) o **Descargar MP3** (fiel: estéreo y calidad del original). El recorte lo hace el backend
  con ffmpeg, así que funciona también con programas largos; el archivo sale como `<programa>_<inicio>-<fin>.mp3`.
- **Exportar CSV** (arriba del panel de marcas): baja todas las menciones de todas las marcas a
  un CSV (programa, marca, horario mm:ss, inicio/fin en segundos, duración y texto), con BOM para
  que Excel respete los acentos.
- **Palabra por palabra** (arriba de la transcripción): resaltado karaoke palabra por palabra
  mientras suena. Usa los timestamps de palabra del JSON si vienen (Whisper `words`), y si no,
  los aproxima. Se puede apagar; se desactiva solo en transcripciones muy largas (+600 segmentos).
- **Descartar audio** (arriba a la derecha): borra del servidor el audio cargado **junto con los
  reportes** ya generados para sus marcas (esos links dejan de funcionar) y vuelve a la pantalla de
  carga. Pide confirmación; no se puede deshacer.

## Cargar audios (varios, transcripción automática)

Botón **"Cargar nuevo audio"** → arrastrá/seleccioná **uno o más** audios (`mp3`, `wav`, `m4a`, …).
Aparecen en una lista **ordenada alfabéticamente** por nombre; podés **reordenarlos arrastrando**
(se unen en ese orden). Después, **"Transcribir y cargar"**:

- El backend **concatena** los audios en un solo programa continuo y **los transcribe
  automáticamente** (AssemblyAI; si falla, OpenAI Whisper — en español). Ya **no se sube JSON**.
- Mientras transcribe ves una pantalla de progreso ("Transcribiendo el programa…"; puede tardar
  unos minutos según la duración). Al terminar abre la vista de trabajo con la transcripción
  continua, lista para verificar marcas. Si falla, te avisa con un botón para reintentar.

> Requiere una API key en el `.env` del backend (`ASSEMBLYAI_API_KEY` y/o `OPENAI_API_KEY`).
> La transcripción tiene **costo por minuto** de audio.

## Cargar desde el aire (logger de HDX)

En la pantalla de carga, solapa **"Desde el aire"**: elegís **radio** (**Radio Mitre** o **La 100**),
**fecha** y **franja horaria** (desde/hasta). La app busca en HDX los **bloques del aire grabado**
(el logger guarda el aire en bloques de ~30 min) que **cubren** esa franja, los **baja, une y
transcribe** automáticamente — el mismo flujo que la carga manual. Botón **"Buscar bloques"** muestra
un preview (cuántos bloques y cuánto audio) antes de confirmar.

- Se traen **bloques completos**, así que puede haber algo de audio **antes y después** de tu franja.
- **Tope de 6 horas** por carga (la transcripción tiene costo por minuto).
- La **hora de inicio** queda fijada al arranque real del primer bloque, así el horario (HH:MM:SS) de
  cada mención corresponde al aire real.

> **Requiere puente a HDX.** HDX está en la red corporativa y solo es alcanzable a través del túnel
> que termina en el servidor de **cronograma**. Comercial consume los endpoints `/api/hdx/logger*`
> que expone cronograma; se configura con `LOGGER_BRIDGE_URL` y `LOGGER_BRIDGE_TOKEN` en el `.env`
> del backend (ver `deploy/INFRA.md`). Sin esa config, la solapa avisa que no está disponible.

## Persistencia (audios recientes)

Cada audio que cargás se **guarda automáticamente** en el backend y queda disponible **21 días**.
En la pantalla de **"Cargar nuevo audio"** aparece la lista **"Audios recientes"**: hacés click y
reabrís la sesión (transcripción, marcas y audio) sin volver a subir nada. A los 21 días de
cargado, el audio y todos sus reportes se borran solos (el reloj corre **desde la carga**).

## Notas técnicas

- **Frontend client-side + backend.** El recorte de clips para los reportes se hace **en el browser**.
  El backend (Node + Express + SQLite) guarda las sesiones con **retención de 21 días desde la carga**,
  y al cargar audios los **concatena (ffmpeg) y transcribe** (AssemblyAI→Whisper) en un **job de a uno**
  para no saturar la caja compartida. Ver `server/` y `deploy/INFRA.md`.
- El audio del ejemplo es un **tono sintético** generado en el navegador y sincronizado a los
  timestamps (placeholder audible, no se transcribe ni se sube). En uso real cargás tus audios.
- **Transcripción automática:** al cargar audios, el backend los concatena y transcribe con
  AssemblyAI (primario) u OpenAI Whisper (fallback, con chunking para >25MB). Ver
  `server/transcribe.js` y `server/audio.js`. El reloj de 21 días corre desde la carga.
- Maneja audios largos (cientos de segmentos) con `content-visibility` y updates dirigidos
  (sin re-render por frame), para que no se trabe.
- **Recorte de audio** (para los reportes): lo hace el **backend con ffmpeg** (`server/audio.js` →
  `clip()`), cortando cada mención del audio de la sesión (con ~0,3 s de margen, mono 16 kHz). El
  front solo manda los timestamps → funciona con programas largos (horas) sin decodificar en el browser.

## Estructura

```
index.html           — shell + estilos globales y estados hover/focus
app.js               — toda la app (estado, render, matching, player, persistencia, reportes)
report.html/report.js— visor standalone del reporte de una marca (lo que abre el anunciante)
colors_and_type.css  — tokens del Radio Mitre Design System (Chakra teal, Roboto, etc.)
assets/radiomitre.svg— isologo
server/              — backend Node + Express + SQLite. Concat (audio.js/ffmpeg) + transcripción
                       (transcribe.js: AssemblyAI→Whisper). Sesiones 21 días + reportes por token.
deploy/              — provisión co-host en videodownloader2 (systemd + Caddy) + INFRA.md
design_handoff/      — bundle original de Claude Design (fuente del diseño; no es parte de la app)
```

Estética basada en el **Radio Mitre Design System** (herramientas internas): superficies
blancas, acento teal (`--brand-500` #319795), tipografía Roboto, radios de 6px y sombras suaves.
El acento se puede cambiar a rojo Mitre con `const ACCENT = 'mitre'` arriba de `app.js`.
