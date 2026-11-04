#!/usr/bin/env bash
# Site et comptes OnyxFight sur le VPS : service des comptes (Node, en local sur 127.0.0.1:8090) + Caddy (HTTPS automatique).
#
#   curl -fsSL https://raw.githubusercontent.com/Lucasdiscordfr/onyxfight-launcher/main/comptes/installer.sh | sudo bash
#   Avec d'autres adresses (quand onyxfight.fr pointera vers le VPS) :
#   ... | sudo bash -s -- play.onyxfight.fr onyxfight.fr www.onyxfight.fr
#
# Relancer la commande met le site et le service à jour (les comptes sont gardés dans /opt/onyxfight/comptes/donnees).
set -euo pipefail
[ "$(id -u)" = 0 ] || { echo "Lance ce script avec sudo."; exit 1; }
ADRESSES="${*:-play.onyxfight.fr}"
DOSSIER=/opt/onyxfight/comptes
DEPOT=https://raw.githubusercontent.com/Lucasdiscordfr/onyxfight-launcher/main/comptes
FICHIERS="serveur.js site/index.html site/inscription.html site/compte.html site/404.html site/style.css site/commun.js site/logo.png site/fond.jpg site/personnage.png site/icone.png"

echo "=== Node.js ==="
if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 18 ]; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi
node --version

echo "=== Caddy (HTTPS) ==="
if ! command -v caddy >/dev/null; then
  apt-get install -y debian-keyring debian-archive-keyring apt-transport-https curl gnupg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update
  apt-get install -y caddy
fi
for port in 80 443; do
  if ss -ltnp "sport = :$port" | grep -v caddy | grep -q LISTEN; then
    echo "ATTENTION : un autre programme utilise déjà le port $port :"; ss -ltnp "sport = :$port"
  fi
done

echo "=== Fichiers du site et du service ==="
id comptes >/dev/null 2>&1 || useradd --system --home "$DOSSIER" --shell /usr/sbin/nologin comptes
install -d -o comptes -g comptes -m 755 "$DOSSIER" "$DOSSIER/site"
install -d -o comptes -g comptes -m 700 "$DOSSIER/donnees"
for f in $FICHIERS; do
  curl -fsSL -o "$DOSSIER/$f.nouveau" "$DEPOT/$f?$(date +%s)"
  mv "$DOSSIER/$f.nouveau" "$DOSSIER/$f"
done
chown -R comptes:comptes "$DOSSIER"

cat > /etc/systemd/system/onyxfight-comptes.service <<EOF
[Unit]
Description=Comptes et site OnyxFight
After=network.target

[Service]
User=comptes
Environment=ONYX_PORT=8090
Environment=ONYX_DONNEES=$DOSSIER/donnees
Environment=ONYX_SITE=$DOSSIER/site
ExecStart=$(command -v node) $DOSSIER/serveur.js
Restart=always
RestartSec=3
NoNewPrivileges=true
ProtectSystem=strict
ReadWritePaths=$DOSSIER/donnees
ProtectHome=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable onyxfight-comptes >/dev/null
systemctl restart onyxfight-comptes

echo "=== Caddy : $ADRESSES ==="
cat > /etc/caddy/Caddyfile <<EOF
$(echo $ADRESSES | sed 's/ /, /g') {
	encode gzip
	reverse_proxy 127.0.0.1:8090
}
EOF
systemctl enable caddy >/dev/null
systemctl reload caddy 2>/dev/null || systemctl restart caddy
ufw allow 80/tcp >/dev/null 2>&1 || true
ufw allow 443/tcp >/dev/null 2>&1 || true

sleep 2
systemctl --no-pager --lines=3 status onyxfight-comptes | head -5
curl -fsS -o /dev/null -w "Service local : %{http_code}\n" http://127.0.0.1:8090/ || echo "Le service ne répond pas : journalctl -u onyxfight-comptes -n 50"
echo "Site : https://$(echo $ADRESSES | cut -d' ' -f1) (le certificat HTTPS peut prendre une minute la première fois)"
