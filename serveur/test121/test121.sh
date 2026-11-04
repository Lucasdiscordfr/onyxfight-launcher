#!/usr/bin/env bash
# Serveur de TEST 1.21.1 (NeoForge + mod OnyxFight 1.21.1) sur la map convertie, à côté du serveur actuel (port 25566).
#
#   curl -fsSL https://raw.githubusercontent.com/Lucasdiscordfr/onyxfight-launcher/main/serveur/test121/test121.sh | sudo bash
#
# Relancer la commande met le mod à jour et redémarre le serveur de test (la map de test est gardée).
# Remettre la map de test à zéro (depuis la conversion) : ... | sudo bash -s -- neuf
# Console : sudo -u onyx tmux attach -t test121   (Ctrl+B puis D pour sortir)
set -euo pipefail
RACINE=/opt/onyxfight
DOSSIER=$RACINE/test121
CONVERSION=$RACINE/conversion121/world
NEOFORGE=21.1.192
PORT=25566
MOD=https://github.com/Lucasdiscordfr/onyxfight-launcher/releases/download/mod121/onyxfight-1.21.1.jar
JAVA=/usr/lib/jvm/temurin-21-jdk-amd64/bin/java
[ "$(id -u)" = 0 ] || { echo "Lance ce script avec sudo."; exit 1; }

echo "=== Java 21 ==="
if [ ! -x "$JAVA" ]; then
  apt-get -o DPkg::Lock::Timeout=900 update -q
  apt-get -o DPkg::Lock::Timeout=900 install -yq temurin-21-jdk
fi

echo "=== Arrêt du serveur de test (s'il tourne) ==="
if sudo -u onyx tmux has-session -t test121 2>/dev/null; then
  sudo -u onyx tmux send-keys -t test121 "stop" Enter
  for i in $(seq 1 90); do pgrep -u onyx -f "test121|neoforge-$NEOFORGE" >/dev/null || break; sleep 1; done
  sudo -u onyx tmux kill-session -t test121 2>/dev/null || true
fi

install -d -o onyx -g onyx "$DOSSIER" "$DOSSIER/mods"
cd "$DOSSIER"

echo "=== NeoForge $NEOFORGE ==="
if [ ! -f run.sh ]; then
  curl -fsSL -o installeur.jar "https://maven.neoforged.net/releases/net/neoforged/neoforge/$NEOFORGE/neoforge-$NEOFORGE-installer.jar"
  "$JAVA" -jar installeur.jar --installServer >/dev/null
  rm -f installeur.jar installeur.jar.log
fi
echo "-Xms4G -Xmx8G -XX:+UseG1GC" > user_jvm_args.txt
echo "eula=true" > eula.txt

echo "=== Mod OnyxFight 1.21.1 ==="
curl -fsSL -o mods/onyxfight-1.21.1.jar "$MOD"
ls -la mods

echo "=== Map de test ==="
if [ "${1:-}" = "neuf" ] || [ ! -d world ]; then
  [ -d "$CONVERSION/region" ] || { echo "Map convertie introuvable ($CONVERSION) : lance convertir121.sh."; exit 1; }
  rm -rf world
  cp -a "$CONVERSION" world
  echo "Map copiée depuis la conversion."
fi
cat > server.properties <<EOF
level-name=world
server-port=$PORT
online-mode=true
white-list=true
enforce-whitelist=true
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
sudo -u onyx tmux new-session -d -s test121 "cd $DOSSIER && JAVA_HOME=/usr/lib/jvm/temurin-21-jdk-amd64 PATH=/usr/lib/jvm/temurin-21-jdk-amd64/bin:\$PATH ./run.sh nogui; echo; echo 'Serveur de test arrêté. Entrée pour fermer.'; read"
echo "Serveur de test lancé sur le port $PORT (whitelist active)."
echo "Ajouter un joueur : sudo -u onyx tmux send-keys -t test121 'whitelist add Pseudo' Enter"
echo "Donner l'équipe : sudo -u onyx tmux send-keys -t test121 'op Pseudo' Enter"
echo "Console : sudo -u onyx tmux attach -t test121   (Ctrl+B puis D pour sortir)"
