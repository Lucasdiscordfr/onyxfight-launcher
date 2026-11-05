#!/usr/bin/env bash
# Serveur de TEST 1.21.1 (Arclight = NeoForge + plugins Bukkit, mod et plugin OnyxFight 1.21.1) sur la map convertie, à côté du serveur actuel (port 25566).
#
#   curl -fsSL https://raw.githubusercontent.com/Lucasdiscordfr/onyxfight-launcher/main/serveur/test121/test121.sh | sudo bash
#
# Relancer la commande met le mod et le plugin à jour et redémarre le serveur de test (la map de test est gardée).
# Remettre la map de test à zéro (depuis la conversion) : ... | sudo bash -s -- neuf
# Mode crack (comptes hors ligne du launcher, pour un 2e compte de test) : ... | sudo bash -s -- crack
#   (pas de whitelist ; attention, en mode crack n importe qui peut prendre un pseudo, op compris)
# Retour aux comptes Microsoft : ... | sudo bash -s -- enligne
# Comptes OnyxFight (pseudo + mot de passe du site, vérifiés par le serveur) : ... | sudo bash -s -- comptes
#   (il faut le service des comptes : comptes/installer.sh)
# Console : sudo -u onyx tmux -L test121 attach -t test121   (Ctrl+B puis D pour sortir)
set -euo pipefail
RACINE=/opt/onyxfight
DOSSIER=$RACINE/test121
CONVERSION=$RACINE/conversion121/world
NEOFORGE=21.1.192
PORT=25566
ARCLIGHT=https://github.com/IzzelAliz/Arclight/releases/download/FeudalKings%2F1.0.1/arclight-neoforge-1.21.1-1.0.1-8ec9529.jar
PLUGIN=$RACINE/arrivees/test121-plugin.jar
MOD=https://github.com/Lucasdiscordfr/onyxfight-launcher/releases/download/mod121/onyxfight-1.21.1.jar
JAVA=/usr/lib/jvm/temurin-21-jdk-amd64/bin/java
[ "$(id -u)" = 0 ] || { echo "Lance ce script avec sudo."; exit 1; }

echo "=== Java 21 ==="
if [ ! -x "$JAVA" ]; then
  apt-get -o DPkg::Lock::Timeout=900 update -q
  apt-get -o DPkg::Lock::Timeout=900 install -yq temurin-21-jdk
fi

echo "=== Arrêt du serveur de test (s'il tourne) ==="
if sudo -u onyx tmux -L test121 has-session -t test121 2>/dev/null; then
  sudo -u onyx tmux -L test121 send-keys -t test121 "stop" Enter
  for i in $(seq 1 90); do pgrep -u onyx -f "^java .*(arclight|neoforge-$NEOFORGE)" >/dev/null || break; sleep 1; done
  sudo -u onyx tmux -L test121 kill-session -t test121 2>/dev/null || true
fi

install -d -o onyx -g onyx "$DOSSIER" "$DOSSIER/mods" "$DOSSIER/plugins"
cd "$DOSSIER"

echo "=== Arclight (NeoForge $NEOFORGE + plugins) ==="
curl -fsSL -o arclight.jar "$ARCLIGHT"
rm -f run.sh run.bat
echo "-Xms4G -Xmx8G -XX:+UseG1GC" > user_jvm_args.txt
echo "eula=true" > eula.txt

echo "=== Mod OnyxFight 1.21.1 ==="
curl -fsSL -o mods/onyxfight-1.21.1.jar "$MOD"

echo "=== Mods tiers (téléchargés depuis leurs sites officiels) ==="
# What Are They Up To + CoroUtil (Corosus, avec son accord)
[ -f mods/coroutil-neoforge-1.21.0-1.3.8.jar ] || curl -fsSL -o mods/coroutil-neoforge-1.21.0-1.3.8.jar \
  https://cdn.modrinth.com/data/rLLJ1OZM/versions/H2YXCYUY/coroutil-neoforge-1.21.0-1.3.8.jar
[ -f mods/watut-neoforge-1.21.0-1.2.3.jar ] || curl -fsSL -o mods/watut-neoforge-1.21.0-1.2.3.jar \
  https://mediafilez.forgecdn.net/files/6315/277/watut-neoforge-1.21.0-1.2.3.jar
# Custom Player Animations (RazorPlay01) + Player Animation Library + Cloth Config
[ -f "mods/cpa-5.9.10-neoforge+1.21.1.jar" ] || curl -fsSL -o "mods/cpa-5.9.10-neoforge+1.21.1.jar" \
  "https://cdn.modrinth.com/data/EhthJpjM/versions/YvEolJOg/cpa-5.9.10-neoforge%2B1.21.1.jar"
[ -f "mods/PlayerAnimationLibNeoforge-1.1.6+mc.1.21.1.jar" ] || curl -fsSL -o "mods/PlayerAnimationLibNeoforge-1.1.6+mc.1.21.1.jar" \
  "https://cdn.modrinth.com/data/ha1mEyJS/versions/yjxtkvnD/PlayerAnimationLibNeoforge-1.1.6%2Bmc.1.21.1.jar"
[ -f mods/cloth-config-15.0.140-neoforge.jar ] || curl -fsSL -o mods/cloth-config-15.0.140-neoforge.jar \
  https://cdn.modrinth.com/data/9s6osm5g/versions/izKINKFg/cloth-config-15.0.140-neoforge.jar
# Simple Voice Chat (henkelmax) : chat vocal (port UDP 24454 à ouvrir)
[ -f mods/voicechat-neoforge-1.21.1-2.6.24.jar ] || curl -fsSL -o mods/voicechat-neoforge-1.21.1-2.6.24.jar \
  https://cdn.modrinth.com/data/9eGKb6K1/versions/qqNx1Yjm/voicechat-neoforge-1.21.1-2.6.24.jar
# Easy NPC retiré (remplacé par les PNJ d'OnyxFight : /pnj)
rm -f mods/easy_npc*.jar
# Too Many Bows (arcs, recettes avec les minerais d'OnyxFight) + Architectury API
[ -f mods/too_many_bows-neoforge-1.21-1.2.0.jar ] || curl -fsSL -o mods/too_many_bows-neoforge-1.21-1.2.0.jar \
  https://cdn.modrinth.com/data/FOiJ92uI/versions/pSPpjheZ/too_many_bows-neoforge-1.21-1.2.0.jar
[ -f mods/architectury-13.0.8-neoforge.jar ] || curl -fsSL -o mods/architectury-13.0.8-neoforge.jar \
  https://cdn.modrinth.com/data/lhGA9TYQ/versions/ZxYGwlk0/architectury-13.0.8-neoforge.jar
# Ouvre les ports du chat vocal et des votes (Votifier intégré) si le pare-feu ufw est actif
if command -v ufw >/dev/null 2>&1 && ufw status | grep -q "Status: active"; then ufw allow 24454/udp >/dev/null || true; ufw allow 8192/tcp >/dev/null || true; fi
ls -la mods

echo "=== Plugin OnyxFight 1.21.1 ==="
if [ -f "$PLUGIN" ]; then
  cp "$PLUGIN" plugins/OnyxFight.jar
  ls -la plugins/OnyxFight.jar
else
  echo "Plugin pas encore arrivé ($PLUGIN) : le serveur démarre sans."
fi

echo "=== Map de test ==="
if [ "${1:-}" = "neuf" ] || [ ! -d world ]; then
  [ -d "$CONVERSION/region" ] || { echo "Map convertie introuvable ($CONVERSION) : lance convertir121.sh."; exit 1; }
  rm -rf world
  cp -a "$CONVERSION" world
  echo "Map copiée depuis la conversion."
fi
EN_LIGNE=true
[ -f server.properties ] && grep -q "^online-mode=false" server.properties && EN_LIGNE=false
COMPTES=
for a in "$@"; do
  [ "$a" = "crack" ] && EN_LIGNE=false
  [ "$a" = "enligne" ] && EN_LIGNE=true && COMPTES=false
  [ "$a" = "comptes" ] && EN_LIGNE=false && COMPTES=true
done
rm -f world/serverconfig/onyxfight-comptes.toml world/serverconfig/onyxfight-comptes.new.tmp.toml   # ancienne version (plantait)
if [ -n "$COMPTES" ]; then
  mkdir -p config
  printf 'actif=%s\napi=http://127.0.0.1:8090\ndelai_secondes=20\n' "$COMPTES" > config/onyxfight-comptes.properties
fi
[ -f config/onyxfight-comptes.properties ] && grep -q "actif=true" config/onyxfight-comptes.properties \
  && echo "Comptes OnyxFight vérifiés (pseudo + mot de passe du site)" || echo "Comptes OnyxFight : vérification désactivée"

echo "Comptes : $([ "$EN_LIGNE" = true ] && echo 'Microsoft (online-mode=true)' || echo 'CRACK / hors ligne (online-mode=false)')"
cat > server.properties <<EOF
level-name=world
server-port=$PORT
online-mode=$EN_LIGNE
white-list=false
enforce-whitelist=false
allow-nether=false
spawn-protection=0
max-players=20
view-distance=10
simulation-distance=8
motd=OnyxFight - serveur de test 1.21.1
EOF
chown -R onyx:onyx "$DOSSIER"
ufw allow $PORT/tcp >/dev/null 2>&1 || true

echo "=== Démarrage ==="
sudo -u onyx tmux -L test121 new-session -d -s test121 "cd $DOSSIER && JAVA_HOME=/usr/lib/jvm/temurin-21-jdk-amd64 PATH=/usr/lib/jvm/temurin-21-jdk-amd64/bin:\$PATH java @user_jvm_args.txt -jar arclight.jar nogui; echo; echo 'Serveur de test arrêté. Entrée pour fermer.'; read"
echo "Serveur de test lancé sur le port $PORT (sans whitelist)."
echo "Donner l'équipe : sudo -u onyx tmux -L test121 send-keys -t test121 'op Pseudo' Enter"
echo "Console : sudo -u onyx tmux -L test121 attach -t test121   (Ctrl+B puis D pour sortir)"
