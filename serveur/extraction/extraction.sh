#!/usr/bin/env bash
# Serveur de TEST du mode Extraction (Arclight = NeoForge 1.21.1 + plugins Bukkit, mod OnyxFight + armes TaCZ), sur le VPS.
#
#   curl -fsSL https://raw.githubusercontent.com/Lucasdiscordfr/onyxfight-launcher/main/serveur/extraction/extraction.sh | sudo bash
#
# Relancer la commande met les mods à jour et redémarre le serveur (le monde est gardé).
# Monde neuf : ... | sudo bash -s -- neuf
# Vider l'espace du vaisseau (avant de poser une autre base) : ... | sudo bash -s -- vaisseau-neuf
# Console : sudo -u onyx tmux -L extraction attach -t extraction   (Ctrl+B puis D pour sortir)
# Ne touche à rien d'autre sur la machine (ni aux services crepuscule-*, ni à /srv).
set -euo pipefail
RACINE=/opt/onyxfight
DOSSIER=$RACINE/extraction
NEOFORGE=21.1.192
PORT=25570
ARCLIGHT=https://github.com/IzzelAliz/Arclight/releases/download/FeudalKings%2F1.0.1/arclight-neoforge-1.21.1-1.0.1-8ec9529.jar
MOD=https://github.com/Lucasdiscordfr/onyxfight-launcher/releases/download/mod121/onyxfight-1.21.1.jar
JDK=/usr/lib/jvm/java-21-openjdk-amd64
[ "$(id -u)" = 0 ] || { echo "Lance ce script avec sudo."; exit 1; }

echo "=== Paquets (Java 21, tmux) ==="
if [ ! -x "$JDK/bin/java" ] || ! command -v tmux >/dev/null 2>&1; then
  apt-get -o DPkg::Lock::Timeout=900 update -q
  apt-get -o DPkg::Lock::Timeout=900 install -yq openjdk-21-jdk-headless tmux
fi
"$JDK/bin/java" -version 2>&1 | head -1

echo "=== Utilisateur onyx ==="
id onyx >/dev/null 2>&1 || useradd -r -m -d "$RACINE" -s /bin/bash onyx

echo "=== Arrêt du serveur Extraction (s'il tourne) ==="
if sudo -u onyx tmux -L extraction has-session -t extraction 2>/dev/null; then
  sudo -u onyx tmux -L extraction send-keys -t extraction "stop" Enter
  for i in $(seq 1 90); do pgrep -u onyx java >/dev/null || break; sleep 1; done
  sudo -u onyx tmux -L extraction kill-session -t extraction 2>/dev/null || true
fi
# Plus aucun Java du serveur avant de toucher aux fichiers (sinon il réenregistre le monde par-dessus en s'arrêtant)
if pgrep -u onyx java >/dev/null; then
  pkill -TERM -u onyx java || true
  for i in $(seq 1 60); do pgrep -u onyx java >/dev/null || break; sleep 1; done
  pkill -KILL -u onyx java 2>/dev/null || true
fi

install -d -o onyx -g onyx "$RACINE" "$DOSSIER" "$DOSSIER/mods" "$DOSSIER/plugins"
cd "$DOSSIER"

echo "=== Arclight (NeoForge $NEOFORGE + plugins) ==="
[ -f arclight.jar ] || curl -fsSL -o arclight.jar "$ARCLIGHT"
echo "-Xms2G -Xmx6G -XX:+UseG1GC -XX:MaxGCPauseMillis=100" > user_jvm_args.txt
echo "eula=true" > eula.txt

echo "=== Mods ==="
curl -fsSL -o mods/onyxfight-1.21.1.jar "$MOD"
telecharger() { [ -f "mods/$1" ] || curl -fsSL -o "mods/$1" "$2"; }
# Mêmes mods que le serveur principal 1.21.1 (le client du launcher les a déjà)
telecharger coroutil-neoforge-1.21.0-1.3.8.jar https://cdn.modrinth.com/data/rLLJ1OZM/versions/H2YXCYUY/coroutil-neoforge-1.21.0-1.3.8.jar
telecharger watut-neoforge-1.21.0-1.2.3.jar https://mediafilez.forgecdn.net/files/6315/277/watut-neoforge-1.21.0-1.2.3.jar
telecharger "cpa-5.9.10-neoforge+1.21.1.jar" "https://cdn.modrinth.com/data/EhthJpjM/versions/YvEolJOg/cpa-5.9.10-neoforge%2B1.21.1.jar"
telecharger "PlayerAnimationLibNeoforge-1.1.6+mc.1.21.1.jar" "https://cdn.modrinth.com/data/ha1mEyJS/versions/yjxtkvnD/PlayerAnimationLibNeoforge-1.1.6%2Bmc.1.21.1.jar"
telecharger cloth-config-15.0.140-neoforge.jar https://cdn.modrinth.com/data/9s6osm5g/versions/izKINKFg/cloth-config-15.0.140-neoforge.jar
telecharger voicechat-neoforge-1.21.1-2.6.24.jar https://cdn.modrinth.com/data/9eGKb6K1/versions/qqNx1Yjm/voicechat-neoforge-1.21.1-2.6.24.jar
telecharger too_many_bows-neoforge-1.21-1.2.0.jar https://cdn.modrinth.com/data/FOiJ92uI/versions/pSPpjheZ/too_many_bows-neoforge-1.21-1.2.0.jar
telecharger architectury-13.0.8-neoforge.jar https://cdn.modrinth.com/data/lhGA9TYQ/versions/ZxYGwlk0/architectury-13.0.8-neoforge.jar
# Armes : TaCZ, portage NeoForge 1.21.1 (GPL-3.0), téléchargé depuis Modrinth
telecharger tacz-neoforge-1.21.1-1.1.8-hotfix-r7.jar https://cdn.modrinth.com/data/OypNE65K/versions/62q6mB5Q/tacz-neoforge-1.21.1-1.1.8-hotfix-r7.jar
telecharger framework-neoforge-1.21.1-0.13.11.jar https://mediafilez.forgecdn.net/files/7530/361/framework-neoforge-1.21.1-0.13.11.jar
telecharger refurbished_furniture-neoforge-1.21.1-1.0.22.jar https://mediafilez.forgecdn.net/files/7473/565/refurbished_furniture-neoforge-1.21.1-1.0.22.jar
telecharger militaristic_armor-1.0.0-neoforge-1.21.1.jar https://cdn.modrinth.com/data/xqyS1U92/versions/aWRFRfRU/militaristic_armor-1.0.0-neoforge-1.21.1.jar
ls -la mods

echo "=== Monde ==="
if [ "${1:-}" = "neuf" ]; then rm -rf world; echo "Monde remis à zéro."; fi
if [ "${1:-}" = "vaisseau-neuf" ]; then rm -rf world/dimensions/onyxfight/vaisseau world/onyxfight/vaisseau; echo "Espace du vaisseau vidé (la base sera reposée avec /carte coller)."; fi

# Serveur de test fermé : liste blanche active (ajouter quelqu'un : whitelist add Pseudo dans la console)
cat > server.properties <<EOF
level-name=world
server-port=$PORT
online-mode=false
white-list=true
enforce-whitelist=true
allow-nether=false
spawn-protection=0
max-players=24
view-distance=10
simulation-distance=8
motd=OnyxFight - Extraction (test)
EOF
# Comptes OnyxFight : pseudo + mot de passe du site, vérifiés par le service des comptes du serveur principal
# (il autorise ce VPS par son adresse IP : variable ONYX_CONFIANCE de comptes/installer.sh)
mkdir -p config
printf 'actif=true\napi=https://play.onyxfight.fr\ndelai_secondes=20\n' > config/onyxfight-comptes.properties
chown -R onyx:onyx "$RACINE"
if command -v ufw >/dev/null 2>&1 && ufw status | grep -q "Status: active"; then ufw allow $PORT/tcp >/dev/null || true; fi

echo "=== Démarrage ==="
sudo -u onyx tmux -L extraction new-session -d -s extraction "cd $DOSSIER && JAVA_HOME=$JDK PATH=$JDK/bin:\$PATH java @user_jvm_args.txt -jar arclight.jar nogui; echo; echo 'Serveur Extraction arrêté. Entrée pour fermer.'; read"
echo "Serveur Extraction lancé sur le port $PORT (liste blanche active)."
echo "Premier démarrage : 2 à 4 minutes (installation de NeoForge)."
echo "Console : sudo -u onyx tmux -L extraction attach -t extraction   (Ctrl+B puis D pour sortir)"
