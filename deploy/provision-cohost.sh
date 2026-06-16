#!/usr/bin/env bash
# ============================================================
# Provisión de "Verificador de menciones" CO-HOSTEADO en videodownloader2.
# Corre EN el server, una vez copiado el código a /opt/menciones (ver INFRA.md → Deploy).
#
# Los placeholders __APP_USER__ / __APP_PW__ / __PUBLIC_URL__ se sustituyen con sed
# antes de mandarlo por SSH (igual patrón que provision.sh del videodownloader):
#   sed "s|__APP_USER__|admin|; s|__APP_PW__|claveSegura|; s|__PUBLIC_URL__|https://comlog.cienradios.com|" \
#     deploy/provision-cohost.sh | ssh -i deploy/ls-key.pem ubuntu@54.225.191.20 'bash -s'
#   (PUBLIC_URL = https://comlog.cienradios.com)
# ============================================================
set -euo pipefail

APP_DIR=/opt/menciones
SRV_DIR=$APP_DIR/server
DOMAIN=comlog.cienradios.com
PORT=8090

echo "==> Node 22 LTS (si falta)"
if ! command -v node >/dev/null 2>&1 || [ "$(node -v | sed 's/v//' | cut -d. -f1)" -lt 20 ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi
node -v

echo "==> Dependencias del backend"
sudo chown -R ubuntu:ubuntu "$APP_DIR"
cd "$SRV_DIR"
# better-sqlite3 baja un prebuilt para Node 22 (sin compilar). Si fallara, descomentar:
# sudo apt-get install -y build-essential python3
npm ci --omit=dev

echo "==> .env (si no existe)"
if [ ! -f "$SRV_DIR/.env" ]; then
  cat > "$SRV_DIR/.env" <<EOF
APP_USER=__APP_USER__
APP_PASSWORD=__APP_PW__
PORT=$PORT
RETENTION_DAYS=21
PUBLIC_BASE_URL=__PUBLIC_URL__
EOF
  chmod 600 "$SRV_DIR/.env"
  echo "   .env creado (chmod 600)."
else
  echo "   .env ya existía, no se toca."
fi

echo "==> systemd"
sudo cp "$APP_DIR/deploy/menciones.service" /etc/systemd/system/menciones.service
sudo systemctl daemon-reload
sudo systemctl enable --now menciones
sudo systemctl restart menciones

echo "==> Caddy (agrega el site block si no está)"
if ! sudo grep -q "$DOMAIN" /etc/caddy/Caddyfile; then
  echo "" | sudo tee -a /etc/caddy/Caddyfile >/dev/null
  sudo tee -a /etc/caddy/Caddyfile < "$APP_DIR/deploy/Caddyfile.comlog" >/dev/null
  sudo systemctl reload caddy
  echo "   site block agregado + caddy recargado."
else
  echo "   el site block de $DOMAIN ya estaba."
fi

echo ""
echo "Listo. Verificá:"
echo "   curl -s http://127.0.0.1:$PORT/health"
echo "   curl -s https://$DOMAIN/health      (necesita el A record en Route 53)"
