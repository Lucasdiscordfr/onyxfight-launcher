#!/usr/bin/env bash
# Ajoute (ou remplace) une planète du mode Extraction à partir d'un monde Minecraft en .zip (dossier « region » à l'intérieur).
# La planète doit exister dans le mod (data/onyxfight/dimension/<nom>.json). Les anciens mondes (1.19…) sont mis à jour par le jeu.
#
#   curl -fsSL https://raw.githubusercontent.com/Lucasdiscordfr/onyxfight-launcher/main/serveur/extraction/planete.sh | sudo bash -s -- faer /home/ubuntu/faer.zip
set -euo pipefail
NOM=${1:?nom de la planète}
ZIP=${2:?chemin du .zip}
DOSSIER=/opt/onyxfight/extraction
CIBLE=$DOSSIER/world/dimensions/onyxfight/$NOM
[ "$(id -u)" = 0 ] || { echo "Lance ce script avec sudo."; exit 1; }
[ -f "$ZIP" ] || { echo "Fichier introuvable : $ZIP"; exit 1; }
command -v unzip >/dev/null || apt-get -o DPkg::Lock::Timeout=900 install -yq unzip

echo "=== Arrêt du serveur Extraction ==="
if sudo -u onyx tmux -L extraction has-session -t extraction 2>/dev/null; then
  sudo -u onyx tmux -L extraction send-keys -t extraction "stop" Enter
fi
# Seulement le Java du serveur Extraction (lancé depuis $DOSSIER), jamais les autres serveurs de la machine
java_extraction() { for p in $(pgrep -u onyx java 2>/dev/null); do [ "$(readlink -f /proc/$p/cwd 2>/dev/null)" = "$DOSSIER" ] && echo "$p"; done; true; }
for i in $(seq 1 90); do [ -n "$(java_extraction)" ] || break; sleep 1; done
P=$(java_extraction); [ -z "$P" ] || kill -KILL $P 2>/dev/null || true
sudo -u onyx tmux -L extraction kill-session -t extraction 2>/dev/null || true

echo "=== Monde « $NOM » ==="
TMP=$(mktemp -d)
unzip -q "$ZIP" -d "$TMP"
# Le monde principal : le dossier « region » placé à côté du level.dat (pas celui du Nether ou de l'End)
LEVEL=$(find "$TMP" -name level.dat | head -1)
if [ -n "$LEVEL" ] && [ -d "$(dirname "$LEVEL")/region" ]; then REG="$(dirname "$LEVEL")/region"; else REG=$(find "$TMP" -type d -name region | head -1); fi
[ -n "$REG" ] || { echo "Pas de dossier « region » dans le zip."; rm -rf "$TMP"; exit 1; }
SRC=$(dirname "$REG")

# Monde plus récent que le serveur (1.21.2 et +) : on le ramène en 1.21.1 (blocs inconnus remplacés par les plus proches)
VERSION=0
if [ -f "$SRC/level.dat" ]; then
  command -v pip3 >/dev/null || apt-get -o DPkg::Lock::Timeout=900 install -yq python3-pip >/dev/null
  python3 -c "import nbtlib" 2>/dev/null || pip3 install -q --break-system-packages nbtlib
  VERSION=$(python3 -c "import nbtlib,sys; print(int(nbtlib.load(sys.argv[1])['Data'].get('DataVersion', 0)))" "$SRC/level.dat" 2>/dev/null || echo 0)
fi
if [ "$VERSION" -gt 3955 ]; then
  echo "=== Monde en version $VERSION : conversion en 1.21.1 ==="
  curl -fsSL "https://raw.githubusercontent.com/Lucasdiscordfr/onyxfight-launcher/main/serveur/extraction/descendre.py?t=$(date +%s)" -o "$TMP/descendre.py"
  ( cd "$SRC" && python3 "$TMP/descendre.py" $(for d in region entities poi; do [ -d "$d" ] && echo "$d"; done) )
fi
rm -rf "$CIBLE"
mkdir -p "$CIBLE"
for d in region entities poi; do [ -d "$SRC/$d" ] && cp -a "$SRC/$d" "$CIBLE/"; done
rm -rf "$TMP"
chown -R onyx:onyx "$DOSSIER/world"
du -sh "$CIBLE"

echo "=== Redémarrage ==="
curl -fsSL "https://raw.githubusercontent.com/Lucasdiscordfr/onyxfight-launcher/main/serveur/extraction/extraction.sh?t=$(date +%s)" | bash
echo "Planète prête : /execute in onyxfight:$NOM run tp @s <x> <y> <z>"
