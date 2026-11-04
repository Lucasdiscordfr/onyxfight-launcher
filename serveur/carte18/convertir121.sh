#!/usr/bin/env bash
# Convertit la map recollée (recoller.sh) en 1.21.1 : hauteur 0 à 255 comme en 1.8 (rien en négatif), aucun nouveau terrain
# (hors de la map : vide), bordure de 15 000 x 15 000 autour de 0 0, point d'apparition au spawn.
# Travaille sur une copie ; le serveur actuel n'est pas touché.
#
#   curl -fsSL https://raw.githubusercontent.com/Lucasdiscordfr/onyxfight-launcher/main/serveur/carte18/convertir121.sh | sudo bash
set -euo pipefail
RACINE=/opt/onyxfight
SOURCE=$RACINE/fusion/carte
DOSSIER=$RACINE/conversion121
DEPOT=https://raw.githubusercontent.com/Lucasdiscordfr/onyxfight-launcher/main/serveur/carte18
TAILLE=${TAILLE:-15000}
SPAWN=${SPAWN:-"-46 80 -419"}
[ "$(id -u)" = 0 ] || { echo "Lance ce script avec sudo."; exit 1; }
[ -d "$SOURCE/region" ] || { echo "Map recollée introuvable ($SOURCE) : lance d'abord recoller.sh."; exit 1; }

echo "=== Java 21 ==="
if [ ! -x /usr/lib/jvm/temurin-21-jdk-amd64/bin/java ]; then
  apt-get -o DPkg::Lock::Timeout=900 update -q
  apt-get -o DPkg::Lock::Timeout=900 install -yq temurin-21-jdk
fi
JAVA=/usr/lib/jvm/temurin-21-jdk-amd64/bin/java

echo "=== Serveur Minecraft 1.21.1 (pour la conversion seulement) ==="
rm -rf "$DOSSIER"
install -d -o onyx -g onyx "$DOSSIER"
cd "$DOSSIER"
URL=$(python3 - <<'PY'
import json, urllib.request
m = json.load(urllib.request.urlopen('https://piston-meta.mojang.com/mc/game/version_manifest_v2.json'))
v = next(x for x in m['versions'] if x['id'] == '1.21.1')
print(json.load(urllib.request.urlopen(v['url']))['downloads']['server']['url'])
PY
)
curl -fsSL -o server.jar "$URL"
echo "eula=true" > eula.txt
cat > server.properties <<EOF
level-name=world
server-ip=127.0.0.1
server-port=25598
online-mode=false
allow-nether=false
spawn-protection=0
max-players=1
view-distance=4
motd=OnyxFight - conversion 1.21.1
EOF

echo "=== Copie de la map et réglages 1.8 ==="
cp -a "$SOURCE" world
curl -fsSL -o fusion.py "$DEPOT/fusion.py"
# Hors de la map : vide (le terrain 1.21 ne sera jamais généré)
python3 - world/level.dat <<'PY'
import gzip, io, sys
sys.path.insert(0, '.')
import fusion as F
p = sys.argv[1]
nom, (t, r) = F.lire_nbt(io.BytesIO(gzip.decompress(open(p, 'rb').read())))
d = r['Data'][1]
d['generatorName'] = (F.TEXTE, 'flat')
d['generatorOptions'] = (F.TEXTE, '3;minecraft:air;1;')
d['generatorVersion'] = (F.ENTIER, 0)
open(p, 'wb').write(gzip.compress(F.nbt_octets(nom, (t, r))))
print('Générateur : vide hors de la map')
PY
# Hauteur du monde : 0 à 255, comme en 1.8
mkdir -p world/datapacks/onyxfight-hauteur/data/minecraft/dimension_type
cat > world/datapacks/onyxfight-hauteur/pack.mcmeta <<'EOF'
{"pack": {"pack_format": 48, "description": "OnyxFight : monde de 0 à 255 comme en 1.8"}}
EOF
cat > world/datapacks/onyxfight-hauteur/data/minecraft/dimension_type/overworld.json <<'EOF'
{
  "ambient_light": 0.0, "bed_works": true, "coordinate_scale": 1.0, "effects": "minecraft:overworld",
  "has_ceiling": false, "has_raids": true, "has_skylight": true, "infiniburn": "#minecraft:infiniburn_overworld",
  "min_y": 0, "height": 256, "logical_height": 256,
  "monster_spawn_block_light_limit": 0,
  "monster_spawn_light_level": {"type": "minecraft:uniform", "min_inclusive": 0, "max_inclusive": 7},
  "natural": true, "piglin_safe": false, "respawn_anchor_works": false, "ultrawarm": false
}
EOF
chown -R onyx:onyx "$DOSSIER"

echo "=== Conversion (tous les chunks d'un coup : peut prendre une ou deux heures) ==="
cat > convertir.sh <<EOF
#!/usr/bin/env bash
cd $DOSSIER
(
  until grep -q 'Done (' logs/latest.log 2>/dev/null; do sleep 10; done
  echo "worldborder center 0 0"; echo "worldborder set $TAILLE"
  echo "setworldspawn $SPAWN"; echo "gamerule spawnRadius 0"
  sleep 5; echo "stop"
) | $JAVA -Xms4G -Xmx6G -jar server.jar --forceUpgrade --nogui
python3 - <<'PY'
import io, sys, zlib
sys.path.insert(0, '$DOSSIER')
import fusion as F
c, _ = F.lire_region('$DOSSIER/world/region/r.-1.-1.mca')
ys, fond = set(), 0
for d in list(c.values())[:200]:
    n, (t, r) = F.lire_nbt(io.BytesIO(zlib.decompress(d)))
    for s in r.get('sections', (F.LISTE, (F.COMPOSE, [])))[1][1]:
        ys.add(s['Y'][1])
        if s['Y'][1] == 0 and any(b['Name'][1] == 'minecraft:bedrock' for b in s.get('block_states', (F.COMPOSE, {}))[1].get('palette', (F.LISTE, (F.COMPOSE, [])))[1][1]):
            fond += 1
print('Vérification : sections de', min(ys) * 16, 'à', max(ys) * 16 + 15, '- chunks avec la bedrock en bas :', fond, '/', min(200, len(c)))
print('OK : rien sous 0' if min(ys) >= 0 else 'ATTENTION : il y a des blocs sous 0')
PY
touch $DOSSIER/TERMINE
echo; echo "Conversion terminée. Entrée pour fermer."; read
EOF
chmod +x convertir.sh
chown onyx:onyx convertir.sh
sudo -u onyx tmux kill-session -t conversion 2>/dev/null || true
sudo -u onyx tmux new-session -d -s conversion "$DOSSIER/convertir.sh"
echo "C'est parti. Suivre : sudo -u onyx tmux attach -t conversion   (Ctrl+B puis D pour sortir)"
echo "À la fin, la map 1.21.1 sera dans $DOSSIER/world"
