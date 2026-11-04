#!/usr/bin/env bash
# Génère la map OnyxFight en terrain 1.8 (serveur Paper 1.8.8 temporaire, à côté du serveur actuel, qui continue de tourner).
# La graine est celle de la map actuelle : le terrain se raccorde autour du spawn.
#
#   curl -fsSL https://raw.githubusercontent.com/Lucasdiscordfr/onyxfight-launcher/main/serveur/carte18/carte18.sh | sudo bash -s -- 8500
#
# 8500 = rayon en blocs autour de 0 0 : 17 000 x 17 000 générés (la bordure du monde sera à 15 000 x 15 000, avec du terrain
# au-delà). Relancer la même commande reprend la génération ; un autre rayon la reprend du début (chunks déjà faits gardés).
# Suivre : sudo -u onyx tmux attach -t carte18   (Ctrl+B puis D pour sortir sans arrêter)
set -euo pipefail

RAYON=${1:-8500}
RACINE=/opt/onyxfight
DOSSIER=$RACINE/carte18
ACTUEL=$RACINE/serveur
JAVA=/usr/lib/jvm/temurin-8-jdk-amd64/bin/java
DEPOT=https://raw.githubusercontent.com/Lucasdiscordfr/onyxfight-launcher/main/serveur/carte18

etape() { echo; echo "=== $1 ==="; }

[ "$(id -u)" = 0 ] || { echo "Lance ce script avec sudo."; exit 1; }
[ -x "$JAVA" ] || { echo "Java 8 introuvable ($JAVA)."; exit 1; }

etape "Place sur le disque"
LIBRE=$(df -BG --output=avail "$RACINE" | tail -1 | tr -dc '0-9')
echo "Libre : ${LIBRE} Go"
if [ "$LIBRE" -lt 40 ]; then
  echo "Il faut au moins 30 Go libres pour une map de cette taille. Arrêt."
  exit 1
fi

install -d -o onyx -g onyx "$DOSSIER" "$DOSSIER/plugins" "$DOSSIER/plugins/OnyxCarte"
cd "$DOSSIER"

etape "Graine de la map actuelle"
NIVEAU=$(grep -E '^level-name=' "$ACTUEL/server.properties" | cut -d= -f2- || true)
NIVEAU=${NIVEAU:-world}
GRAINE=$(python3 - "$ACTUEL/$NIVEAU/level.dat" <<'PY'
import gzip, struct, sys
d = gzip.open(sys.argv[1]).read()
i = 0
def lire(n):
    global i
    v = d[i:i + n]; i += n; return v
def nom():
    (l,) = struct.unpack('>H', lire(2)); return lire(l).decode('utf-8', 'replace')
TAILLES = {1: 1, 2: 2, 3: 4, 4: 8, 5: 4, 6: 8}
def valeur(t, chemin):
    if t in TAILLES:
        v = lire(TAILLES[t])
        if t == 4 and chemin.endswith('/RandomSeed'):
            print(struct.unpack('>q', v)[0]); sys.exit(0)
    elif t == 7:
        (n,) = struct.unpack('>i', lire(4)); lire(n)
    elif t == 8:
        nom()
    elif t == 9:
        st = lire(1)[0]; (n,) = struct.unpack('>i', lire(4))
        for _ in range(n): valeur(st, chemin)
    elif t == 10:
        while True:
            st = lire(1)[0]
            if st == 0: break
            valeur(st, chemin + '/' + nom())
    elif t == 11:
        (n,) = struct.unpack('>i', lire(4)); lire(4 * n)
    elif t == 12:
        (n,) = struct.unpack('>i', lire(4)); lire(8 * n)
t = lire(1)[0]; nom(); valeur(t, '')
sys.exit(1)
PY
)
echo "Graine : $GRAINE"

etape "Serveur Paper 1.8.8 (temporaire)"
if [ ! -f paper.jar ]; then
  URL=""
  B=$(curl -fsSL https://api.papermc.io/v2/projects/paper/versions/1.8.8/builds 2>/dev/null | jq -r '.builds[-1].build' 2>/dev/null || true)
  if [ -n "$B" ] && [ "$B" != null ]; then
    URL="https://api.papermc.io/v2/projects/paper/versions/1.8.8/builds/$B/downloads/paper-1.8.8-$B.jar"
  else
    URL=$(curl -fsSL https://fill.papermc.io/v3/projects/paper/versions/1.8.8/builds/latest | jq -r '.downloads."server:default".url')
  fi
  echo "Téléchargement : $URL"
  curl -fsSL -o paper.jar "$URL"
fi
# Arrêt propre d'une génération en cours (elle reprendra)
if sudo -u onyx tmux has-session -t carte18 2>/dev/null; then
  echo "Arrêt de la génération en cours…"
  sudo -u onyx tmux send-keys -t carte18 "stop" Enter
  for i in $(seq 1 120); do
    pgrep -u onyx -f "carte18.*paper.jar|paper.jar nogui" >/dev/null || break
    sleep 1
  done
  sudo -u onyx tmux kill-session -t carte18 2>/dev/null || true
fi
curl -fsSL -o plugins/onyx-carte.jar "$DEPOT/onyx-carte.jar"
ANCIEN=$(cat plugins/OnyxCarte/rayon.txt 2>/dev/null || echo "")
if [ "$ANCIEN" != "$RAYON" ]; then
  rm -f plugins/OnyxCarte/avancee.txt plugins/OnyxCarte/TERMINE
fi
echo "$RAYON" > plugins/OnyxCarte/rayon.txt
[ -f plugins/OnyxCarte/centre.txt ] || echo "0 0" > plugins/OnyxCarte/centre.txt
echo "eula=true" > eula.txt
cat > server.properties <<EOF
level-name=world
level-seed=$GRAINE
level-type=DEFAULT
generate-structures=true
server-ip=127.0.0.1
server-port=25599
online-mode=false
max-players=1
view-distance=4
spawn-protection=0
motd=OnyxFight - generation de la map 1.8
EOF
chown -R onyx:onyx "$DOSSIER"

etape "Génération"
if [ -f plugins/OnyxCarte/TERMINE ]; then
  echo "La map est déjà terminée : $DOSSIER/world"
  exit 0
fi
sudo -u onyx tmux new-session -d -s carte18 "cd $DOSSIER && $JAVA -Xms4G -Xmx6G -XX:+UseG1GC -jar paper.jar nogui; echo; echo 'Serveur arrêté. Entrée pour fermer.'; read"
echo "C'est parti : $((((RAYON * 2 / 16) + 1) ** 2)) chunks environ."
echo "Suivre : sudo -u onyx tmux attach -t carte18   (Ctrl+B puis D pour sortir sans arrêter)"
echo "Avancée : cat $DOSSIER/logs/latest.log | grep OnyxCarte | tail -1"
echo "Le serveur s'arrête tout seul à la fin ; la map sera dans $DOSSIER/world"
