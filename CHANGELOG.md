# Changelog

## En curso

- **Recortar audio por selección:** botón **"Recortar audio"** arriba de la transcripción. Activás el
  modo, tocás la **línea de inicio** y la **línea final** (el tramo entre medio se resalta), y podés
  **Escuchar** ese tramo (con auto-pausa al final) o **Descargar MP3** fiel (estéreo, calidad original).
  El recorte lo hace el **backend con ffmpeg** (`GET /api/sessions/:id/clip`, seek rápido → sirve para
  programas largos); el archivo sale como `<programa>_<inicio>-<fin>.mp3`.
- **Reporte:** cada mención con audio ahora tiene un **botón para descargar su clip** (.wav,
  nombre `<marca> <horario>.wav`). Usa el endpoint de clips existente; oculto en la impresión/PDF.

## En curso — Cargar desde el aire (logger HDX)

- Nueva solapa **"Desde el aire"** en la pantalla de carga: elegís **radio** (Radio Mitre o La 100),
  **fecha** y **franja horaria**, y la app trae de HDX los **bloques del logger** (aire grabado,
  ~30 min c/u) que cubren esa franja, los une y los transcribe — reusando el flujo existente.
  La radio se distingue por categoría en HDX (`LG MITRE AC`, `LG La 100 AC`); sumar otra es una
  línea en el config `LOGGERS` de cronograma.
- Se bajan **bloques completos** (puede haber audio antes/después de la franja); **tope 6 h** por carga.
  La **hora de inicio** se setea al arranque real del primer bloque, así el horario de cada mención sale correcto.
- **Puente a HDX:** HDX vive en la red corp y solo es alcanzable por el túnel del EC2 de **cronograma**.
  Se agregaron endpoints `/api/hdx/logger*` en cronograma (token propio) y comercial los consume por
  HTTPS (`server/hdx-bridge.js`). Config: `LOGGER_BRIDGE_URL` / `LOGGER_BRIDGE_TOKEN` en `server/.env`.
- **Descargas resilientes:** si el túnel cronograma↔HDX corta un bloque a mitad (`socket hang up` /
  ECONNRESET / timeout / 5xx), se **reintenta ese bloque con backoff** (hasta 3 intentos) en vez de
  tirar abajo toda la franja por un corte transitorio. Los errores reales (4xx, bloque inexistente)
  no se reintentan.
- **Logging de diagnóstico** en la descarga: cada fallo identifica el **hop** que cortó
  (`connect` / `timeout` / `upstream HTTP xxx` / `stream`) + status, headers y body de cronograma +
  bytes recibidos y tiempo — así se distingue si falló la conexión a cronograma o el túnel
  cronograma↔HDX (el `socket hang up` típico llega como `[upstream 502]`, conexión sana). También
  detecta descargas **incompletas** (content-length no cuadra) y las reintenta.

## v1.0 — 2026-06-16

Primer release completo: de prototipo 100% client-side a aplicación con backend, persistencia,
transcripción automática y reportes compartibles, **deployada en AWS** (https://comlog.cienradios.com).

### Funcionalidades
- **Verificación de menciones** (base): transcripción con timestamps, búsqueda de marcas
  (case/acento-insensitive, como palabra), resaltado por color, contador + lista de apariciones,
  mini-player con velocidad (0,5×–2×) y karaoke palabra por palabra.
- **Carga de varios audios**: multi-archivo con reordenar arrastrando (alfabético por defecto);
  el backend los **concatena (ffmpeg)** en un solo programa continuo.
- **Transcripción automática**: AssemblyAI (primario) → OpenAI Whisper (fallback), en español,
  asíncrona con pantalla de progreso. Ya no se sube JSON.
- **Persistencia 21 días** desde la carga: lista **"Mis audios" / "Tus transcripciones"** para
  reabrir, **títulos editables**, **restaura el último audio al refrescar**, y **descartar audio**.
- **Reportes compartibles** por link (token público, sin login), standalone, con **solo los clips de
  la marca** (recortados server-side con ffmpeg, sirve para programas de horas). Las menciones de
  segmentos contiguos se **unen en un clip** (ventana 5 s).
- **Hora de inicio** por audio: calcula el **horario real (HH:MM:SS)** de cada mención en la
  transcripción, la lista de marcas, el CSV y el reporte.
- **Export CSV** de todas las menciones (con columna de hora real).

### Infraestructura (AWS)
- AWS Lightsail `videodownloader2` (co-hosteado), **Node + Express + SQLite**, systemd `menciones`
  detrás de **Caddy**; público en **https://comlog.cienradios.com** vía Route 53.
- **Basic Auth** en la herramienta interna; **reportes públicos por token**.
- Transcripción: `ASSEMBLYAI_API_KEY` + `OPENAI_API_KEY` en `server/.env`.
- Datos (SQLite + audios + clips) en `server/data/`, retención 21 días con limpieza automática.

### Docs
- Uso: [`README.md`](README.md) · Infra y operación (deploy, SSH, DNS, redeploy): [`deploy/INFRA.md`](deploy/INFRA.md)
