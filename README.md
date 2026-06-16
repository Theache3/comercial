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

Cada tarjeta de marca tiene **dos** formas de compartir, ambas con **aislamiento estructural**: la
marca solo ve y escucha **sus propios fragmentos** (cada mención recortada a su clip), nunca la
transcripción completa ni otras marcas.

### 1) Generar link de reporte (recomendado)

Botón **"Generar link de reporte"**. Recorta los clips de la marca (en el browser), los sube al
backend y devuelve una **URL para compartir** (`https://comlog.cienradios.com/r/<token>`). La
marca abre el link en cualquier navegador o celular y ve una **página standalone** (sin ningún link
interno a la herramienta) con sus menciones: horario (mm:ss), el texto con su marca resaltada, un
botón para reproducir cada clip y "Reproducir todo". Es **público por token impredecible** (sin
login) y **vence a los 21 días de cargado el audio**.

### 2) Descargar HTML (offline)

Botón **"Descargar HTML (offline)"**. Genera y descarga un **archivo `.html` autocontenido para esa
marca**, que el equipo le manda por email al anunciante.

- La marca solo **ve y escucha sus propios fragmentos** — cada mención queda recortada a su
  propio clip de audio embebido en el archivo. No incluye la transcripción completa ni otras
  marcas (el aislamiento es **estructural**: el archivo se arma solo con los datos de esa marca).
- Se abre con doble click en cualquier navegador, **sin instalar nada y sin internet**: muestra
  la marca, el programa, la fecha, el total de menciones y minutos al aire, y la lista de
  fragmentos con su horario (mm:ss), el texto con la marca resaltada y un botón para reproducir
  cada uno (más "Reproducir todo").
- Sirve también como **constancia**: desde el navegador, *Imprimir → Guardar como PDF* genera
  un documento prolijo (el PDF pierde el audio, lo cual es esperable para un archivo de respaldo).
- Si el navegador no puede procesar el audio (codec raro), el archivo igual se genera con los
  **textos y horarios** y un aviso de "audio no disponible".

**Tamaño / envío:** el peso depende de los **segundos de mención**, no de la duración del
programa. Una marca típica (~6 fragmentos) pesa ~2 MB; una muy nombrada puede acercarse al
límite de email (25 MB) — si pasa de ~20 MB, la app avisa antes de descargar. Si el correo
corporativo bloquea adjuntos `.html`, comprimilo en `.zip` antes de enviarlo.

## Otras acciones

- **Exportar CSV** (arriba del panel de marcas): baja todas las menciones de todas las marcas a
  un CSV (programa, marca, horario mm:ss, inicio/fin en segundos, duración y texto), con BOM para
  que Excel respete los acentos.
- **Palabra por palabra** (arriba de la transcripción): resaltado karaoke palabra por palabra
  mientras suena. Usa los timestamps de palabra del JSON si vienen (Whisper `words`), y si no,
  los aproxima. Se puede apagar; se desactiva solo en transcripciones muy largas (+600 segmentos).

## Cargar tu propio audio

Botón **"Cargar nuevo audio"** → arrastrá/seleccioná:

- **Audio**: `mp3`, `wav`, `m4a`.
- **Transcripción (JSON)**: un array de segmentos con tiempos en **segundos** (estilo Whisper
  `verbose_json`). También acepta `{ "segments": [...] }`.

```json
[
  { "start": 0.0,  "end": 3.4,  "text": "Buenos días, son las nueve y diez…" },
  { "start": 3.4,  "end": 7.2,  "text": "Arrancamos con el repaso de la información…" }
]
```

## Persistencia (audios recientes)

Cada audio que cargás se **guarda automáticamente** en el backend y queda disponible **21 días**.
En la pantalla de **"Cargar nuevo audio"** aparece la lista **"Audios recientes"**: hacés click y
reabrís la sesión (transcripción, marcas y audio) sin volver a subir nada. A los 21 días de
cargado, el audio y todos sus reportes se borran solos (el reloj corre **desde la carga**).

## Notas técnicas

- **Frontend client-side + backend liviano.** El audio se carga con `URL.createObjectURL` para
  trabajar al instante; en paralelo, la sesión (audio + transcripción + marcas) se **guarda en el
  backend** (Node + Express + SQLite) con **retención de 21 días desde la carga**. El recorte de
  audio para los reportes se hace **en el browser**, así el backend queda liviano (~100 MB) y entra
  co-hosteado en la instancia Lightsail existente. Ver `server/` y `deploy/INFRA.md`.
- El audio del ejemplo es un **tono sintético** generado en el navegador y sincronizado a los
  timestamps (placeholder audible). En uso real cargás tu `mp3`.
- **Punto a reemplazar más adelante:** hoy la transcripción se carga como JSON. Ese es el lugar
  donde más adelante se enganchará una **llamada real a una API de transcripción**
  (ver `acceptJson` / `confirmUpload` en `app.js`).
- Maneja audios largos (cientos de segmentos) con `content-visibility` y updates dirigidos
  (sin re-render por frame), para que no se trabe.
- **Recorte de audio** (para "Enviar a la marca"): se decodifica el audio con `AudioContext`,
  se recorta cada mención (con ~0,3 s de margen), se baja a mono 16 kHz y se reencoda WAV; los
  clips se embeben en base64. Nunca se embebe el audio entero (sería imposible de mandar por
  email). El `writeWav` es compartido con el generador del audio de ejemplo.

## Estructura

```
index.html           — shell + estilos globales y estados hover/focus
app.js               — toda la app (estado, render, matching, player, persistencia, reportes)
report.html/report.js— visor standalone del reporte de una marca (lo que abre el anunciante)
colors_and_type.css  — tokens del Radio Mitre Design System (Chakra teal, Roboto, etc.)
assets/radiomitre.svg— isologo
server/              — backend Node + Express + SQLite (sesiones 21 días + reportes por token)
deploy/              — provisión co-host en videodownloader2 (systemd + Caddy) + INFRA.md
design_handoff/      — bundle original de Claude Design (fuente del diseño; no es parte de la app)
```

Estética basada en el **Radio Mitre Design System** (herramientas internas): superficies
blancas, acento teal (`--brand-500` #319795), tipografía Roboto, radios de 6px y sombras suaves.
El acento se puede cambiar a rojo Mitre con `const ACCENT = 'mitre'` arriba de `app.js`.
