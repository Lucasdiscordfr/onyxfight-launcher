#!/usr/bin/env bash
# Retour au serveur 1.7.10 (si la migration pose problème) : le service onyxfight relance l'ancien serveur, gardé intact.
#
#   curl -fsSL https://raw.githubusercontent.com/Lucasdiscordfr/onyxfight-launcher/main/serveur/migration121/retour17.sh | sudo bash
set -euo pipefail
[ "$(id -u)" = 0 ] || { echo "Lance ce script avec sudo."; exit 1; }
RACINE=/opt/onyxfight
[ -f $RACINE/onyxfight-1.7.service ] || { echo "Service 1.7 introuvable ($RACINE/onyxfight-1.7.service)."; exit 1; }
systemctl stop onyxfight || true
cp $RACINE/onyxfight-1.7.service /etc/systemd/system/onyxfight.service
systemctl daemon-reload
systemctl start onyxfight
echo "Serveur 1.7.10 relancé."
