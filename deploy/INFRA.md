# Infraestructura — Verificador de menciones

Runbook para servir **https://comlog.cienradios.com**, **co-hosteado** en la misma
instancia Lightsail que el videodownloader (`videodownloader2`).

> El deploy es un paso aparte que dispara el equipo. Hoy la app corre y se verifica **local**
> (`cd server && npm install && npm start` → http://localhost:8090). Estos scripts dejan todo
> listo para subirlo cuando quieran.

## Resumen

```
                    Internet
                       │
     DNS: comlog.cienradios.com ──►  54.225.191.20 (IP estática, ya existente)
                       │
                       ▼
   ┌──────────────────────────────────────────────────────────┐
   │  AWS Lightsail · instancia "videodownloader2" (compartida) │
   │  Ubuntu 24.04 · small_3_0 (2GB RAM, 2 vCPU, 60GB SSD) + 2GB swap │
   │                                                            │
   │   Caddy :443 (TLS auto)                                    │
   │     ├─ videodown.cienradios.com  → 127.0.0.1:8000 (FastAPI, ya existía) │
   │     └─ comlog.cienradios.com  → 127.0.0.1:8090 (Node, NUEVO)         │
   │                                    │                       │
   │                                    ▼                       │
   │   systemd "menciones" → node server.js  (MemoryMax=512M)   │
   │     ├─ SQLite + archivos  /opt/menciones/server/data/      │
   │     └─ Basic Auth en la herramienta; /r/*, /api/reports/*, /health públicos │
   └──────────────────────────────────────────────────────────┘
```

El backend es **liviano** (~100 MB idle): el recorte de audio se hace en el browser, así que
acá solo se guardan y sirven archivos. Headroom comprobado al planificar: 1.37 GB RAM libre,
swap sin usar, 47 GB de disco libres, load 0.00.

## Inventario

| Recurso | Valor |
|---|---|
| Cuenta AWS | `578837736114` (IAM user `therzkovich`) |
| Región | `us-east-1` (`us-east-1a`) |
| Instancia | `videodownloader2` (compartida con el videodownloader) · `54.225.191.20` |
| Dominio | `comlog.cienradios.com` (Route 53, **A** → `54.225.191.20`, TTL 300) |
| App en el server | `/opt/menciones/` (código) · backend en `/opt/menciones/server/` |
| Servicio | systemd `menciones` → `node server.js` en `127.0.0.1:8090`, `MemoryMax=512M` |
| Datos (runtime) | `/opt/menciones/server/data/` → SQLite `menciones.db` + `sessions/` + `reports/` |
| Reverse proxy / TLS | Caddy → site block en `/etc/caddy/Caddyfile` (`deploy/Caddyfile.comlog`) |
| Puertos | 8090 (Node, solo localhost). Caddy ya escucha 80/443. 8000 es del videodownloader. |
| Retención | **21 días desde la carga del audio** (`RETENTION_DAYS`). Sweep al boot + cada 6 h. |
| Costo | **US$0 extra** (co-hosteado). |

## Acceso SSH

Misma instancia y misma llave que el videodownloader:

```bash
ssh -i /ruta/a/ls-key.pem ubuntu@54.225.191.20
```

(`ls-key.pem` = llave default de Lightsail de la región; está en `videoDownloader/deploy/`,
en `.gitignore`.)

## `.env` del server (`/opt/menciones/server/.env`, chmod 600 — NO va a git)

```
APP_USER=admin                 # Basic Auth de la herramienta interna (si se deja vacío → SIN auth)
APP_PASSWORD=<clave compartida del equipo comercial>
PORT=8090
RETENTION_DAYS=21              # el reloj corre desde la carga del audio
PUBLIC_BASE_URL=https://comlog.cienradios.com   # para construir las URLs de reporte
ASSEMBLYAI_API_KEY=<key>      # transcripción primaria (al cargar varios audios)
OPENAI_API_KEY=<key>          # transcripción fallback (Whisper). Con una de las dos alcanza.

# Cargar desde el aire (logger HDX vía bridge de cronograma). Sin esto, la opción queda inactiva.
LOGGER_BRIDGE_URL=https://cronograma.cienradios.com
LOGGER_BRIDGE_TOKEN=<mismo secreto que en cronograma>
LOGGER_BRIDGE_BASIC=<user:pass de la basic-auth de nginx de cronograma, si aplica>
```

> **Cargar desde el aire:** la app puede traer el aire grabado (logger HDX) de Radio Mitre por
> franja horaria. HDX vive en la red corp y solo es alcanzable por el túnel que termina en el EC2
> de **cronograma**; comercial le pega a los endpoints `/api/hdx/logger*` que cronograma expone
> (ver `cronograma/docs/HDX_REFERENCIA.md`). Requiere que en cronograma esté seteado el mismo
> `LOGGER_BRIDGE_TOKEN`. La transcripción de varios bloques de 30 min consume API por minuto.

> **Seguridad:** la herramienta interna (subir audio, ver transcripción) queda detrás de Basic
> Auth. Los **reportes a marcas** (`/r/<token>`, `/api/reports/*`) son **públicos por token**
> impredecible (sin login) — es el link que se comparte. `/health` queda abierto.

## DNS (Route 53)

`cienradios.com` ya está en Route 53 (lo usa el videodownloader). Agregar un registro **A**:

```bash
# Reemplazar <ZONE_ID> por el hosted zone de cienradios.com
aws route53 change-resource-record-sets --hosted-zone-id <ZONE_ID> --region us-east-1 \
  --change-batch '{"Changes":[{"Action":"UPSERT","ResourceRecordSet":{
    "Name":"comlog.cienradios.com","Type":"A","TTL":300,
    "ResourceRecords":[{"Value":"54.225.191.20"}]}}]}'
```

Caddy emite el certificado Let's Encrypt solo, una vez que el DNS resuelve.

## Provisión desde cero (co-host)

```bash
# 1) Copiar el código a /opt/menciones (ver "Redeploy")
# 2) Provisionar (instala Node 22, deps, .env, systemd, Caddy):
sed "s|__APP_USER__|admin|; s|__APP_PW__|CLAVE|; s|__PUBLIC_URL__|https://comlog.cienradios.com|" \
  deploy/provision-cohost.sh | ssh -i /ruta/ls-key.pem ubuntu@54.225.191.20 'bash -s'
# 3) Crear el A record en Route 53 (arriba)
# 4) Verificar: https://comlog.cienradios.com/health → {"status":"ok"}
```

## Redeploy (actualizar el código)

Desde la carpeta del proyecto, en local. **No** se tocan `server/.env` ni `server/data/`
(no van en el tar → persisten entre actualizaciones):

```bash
KEY=/ruta/ls-key.pem
tar czf - index.html app.js report.html report.js colors_and_type.css assets \
  server/server.js server/db.js server/cleanup.js server/audio.js server/transcribe.js server/hdx-bridge.js \
  server/package.json server/package-lock.json deploy \
  | ssh -i $KEY ubuntu@54.225.191.20 "mkdir -p /opt/menciones && tar xzf - -C /opt/menciones"

# Si cambiaron dependencias:
ssh -i $KEY ubuntu@54.225.191.20 "cd /opt/menciones/server && npm ci --omit=dev"

ssh -i $KEY ubuntu@54.225.191.20 "sudo systemctl restart menciones"
```

## Operación

```bash
sudo systemctl status menciones
sudo journalctl -u menciones -n 50 --no-pager
sudo systemctl restart menciones
sudo systemctl reload caddy            # tras editar el Caddyfile

# Forzar limpieza de vencidos a mano (además del sweep automático cada 6 h):
cd /opt/menciones/server && node cleanup.js

# Memoria / disco (la caja es compartida — vigilar):
free -m ; df -h / ; du -sh /opt/menciones/server/data
```

Health público (sin auth): `https://comlog.cienradios.com/health` → `{"status":"ok"}`.

## Cambiar la clave de la herramienta

```bash
ssh -i /ruta/ls-key.pem ubuntu@54.225.191.20 \
  "sed -i 's|^APP_PASSWORD=.*|APP_PASSWORD=NUEVA|' /opt/menciones/server/.env && sudo systemctl restart menciones"
```

## Notas

- **Disco:** cada sesión guarda el audio completo (privado) 21 días; los reportes guardan los
  clips de cada marca. Con 47 GB libres alcanza de sobra, pero conviene mirar
  `du -sh data` de vez en cuando. El sweep automático borra todo lo vencido (filas + carpetas).
- **OOM:** la caja se colgó una vez (cuando era `nano` de 512 MB sin swap). Hoy tiene 2 GB + 2 GB
  swap y este servicio está topeado a `MemoryMax=512M`, así que no puede ahogar al videodownloader.
- **better-sqlite3:** baja un binario prebuilt para Node 22 (sin compilar). Si `npm ci` fallara,
  `sudo apt-get install -y build-essential python3` y reintentar.
- **Backups:** snapshot puntual de la instancia (incluye ambos servicios):
  `aws lightsail create-instance-snapshot --instance-name videodownloader2 --instance-snapshot-name videodownloader2-YYYYMMDD --region us-east-1`.
