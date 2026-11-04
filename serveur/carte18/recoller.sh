#!/usr/bin/env bash
# Recolle la map actuelle (spawn, warzone, constructions) au centre de la map 1.8 générée par carte18.sh.
# Le serveur actuel continue de tourner : on enregistre sa map, on en fait une copie, et on travaille sur la copie.
#
#   curl -fsSL https://raw.githubusercontent.com/Lucasdiscordfr/onyxfight-launcher/main/serveur/carte18/recoller.sh | sudo bash
set -euo pipefail
RACINE=/opt/onyxfight
ACTUEL=$RACINE/serveur
CARTE=$RACINE/carte18
DEPOT=https://raw.githubusercontent.com/Lucasdiscordfr/onyxfight-launcher/main/serveur/carte18
[ "$(id -u)" = 0 ] || { echo "Lance ce script avec sudo."; exit 1; }
[ -f "$CARTE/plugins/OnyxCarte/TERMINE" ] || { echo "La map 1.8 n'est pas encore finie (carte18.sh)."; exit 1; }
sudo -u onyx tmux has-session -t carte18 2>/dev/null && { echo "Le serveur de génération tourne encore : attends qu'il s'arrête."; exit 1; }

NIVEAU=$(grep -E '^level-name=' "$ACTUEL/server.properties" | cut -d= -f2- || true)
NIVEAU=${NIVEAU:-world}
TRAVAIL=$RACINE/fusion
rm -rf "$TRAVAIL"
install -d -o onyx -g onyx "$TRAVAIL"

echo "=== Copie de la map actuelle (serveur en marche) ==="
sudo -u onyx tmux send-keys -t onyxfight "save-off" Enter 2>/dev/null || true
sudo -u onyx tmux send-keys -t onyxfight "save-all" Enter 2>/dev/null || true
sleep 20
cp -a "$ACTUEL/$NIVEAU" "$TRAVAIL/ancienne"
sudo -u onyx tmux send-keys -t onyxfight "save-on" Enter 2>/dev/null || true

echo "=== Copie de la map 1.8 ==="
cp -a "$CARTE/world" "$TRAVAIL/carte"

echo "=== Recollage ==="
curl -fsSL -o "$TRAVAIL/fusion.py" "$DEPOT/fusion.py"
python3 "$TRAVAIL/fusion.py" "$TRAVAIL/ancienne" "$TRAVAIL/carte" "$TRAVAIL/blocs-du-mod.txt"
cp "$TRAVAIL/blocs-du-mod.txt" "$TRAVAIL/carte/onyxfight-blocs-du-mod.txt"
chown -R onyx:onyx "$TRAVAIL"
echo
echo "Map recollée : $TRAVAIL/carte  (blocs du mod notés : $(wc -l < "$TRAVAIL/blocs-du-mod.txt"))"
echo "La map 1.8 d'origine est intacte dans $CARTE/world."
