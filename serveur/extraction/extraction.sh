#!/usr/bin/env bash
# Serveur de TEST du mode Extraction (NeoForge 1.21.1 récent, sans Arclight : aucun plugin Bukkit ici).
# Il tourne sur le serveur dédié, À CÔTÉ des autres serveurs Minecraft : ce script n'arrête que le Java lancé depuis
# /opt/onyxfight/extraction (jamais les autres serveurs de l'utilisateur onyx).
#
#   curl -fsSL https://raw.githubusercontent.com/Lucasdiscordfr/onyxfight-launcher/main/serveur/extraction/extraction.sh | sudo bash
#
# Relancer la commande met les mods à jour et redémarre le serveur (le monde est gardé).
# Monde neuf : ... | sudo bash -s -- neuf
# Vider l'espace du vaisseau (avant de poser une autre base) : ... | sudo bash -s -- vaisseau-neuf
# Console : sudo -u onyx tmux -L extraction attach -t extraction   (Ctrl+B puis D pour sortir)
# Ne touche à rien d'autre sur la machine (ni aux services crepuscule-*, ni à /srv, ni aux autres serveurs Minecraft).
set -euo pipefail
RACINE=/opt/onyxfight
DOSSIER=$RACINE/extraction
NEOFORGE=21.1.265
PORT=25570
# Chat vocal : 24454 est déjà pris par le serveur principal sur le dédié
VOIX=24455
MOD=https://github.com/Lucasdiscordfr/onyxfight-launcher/releases/download/mod121/onyxfight-1.21.1.jar
JDK=/usr/lib/jvm/java-21-openjdk-amd64
[ "$(id -u)" = 0 ] || { echo "Lance ce script avec sudo."; exit 1; }
# Java du serveur Extraction uniquement : ceux dont le dossier de travail est $DOSSIER
java_extraction() { for p in $(pgrep -u onyx java 2>/dev/null); do [ "$(readlink -f /proc/$p/cwd 2>/dev/null)" = "$DOSSIER" ] && echo "$p"; done; true; }

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
  for i in $(seq 1 90); do [ -n "$(java_extraction)" ] || break; sleep 1; done
  sudo -u onyx tmux -L extraction kill-session -t extraction 2>/dev/null || true
fi
# Plus aucun Java du serveur avant de toucher aux fichiers (sinon il réenregistre le monde par-dessus en s'arrêtant)
if [ -n "$(java_extraction)" ]; then
  kill -TERM $(java_extraction) 2>/dev/null || true
  for i in $(seq 1 60); do [ -n "$(java_extraction)" ] || break; sleep 1; done
  P=$(java_extraction); [ -z "$P" ] || kill -KILL $P 2>/dev/null || true
fi

install -d -o onyx -g onyx "$RACINE" "$DOSSIER" "$DOSSIER/mods" "$DOSSIER/plugins"
cd "$DOSSIER"

echo "=== NeoForge $NEOFORGE ==="
# Installé une fois par version (l'installateur prépare les bibliothèques et les arguments de lancement)
if [ ! -f "libraries/net/neoforged/neoforge/$NEOFORGE/unix_args.txt" ]; then
  curl -fsSL --retry 4 -o neoforge-installer.jar "https://maven.neoforged.net/releases/net/neoforged/neoforge/$NEOFORGE/neoforge-$NEOFORGE-installer.jar"
  sudo -u onyx "$JDK/bin/java" -jar neoforge-installer.jar --installServer >/dev/null 2>&1 || { echo "  ! installation de NeoForge impossible"; exit 1; }
  rm -f neoforge-installer.jar neoforge-installer.jar.log run.bat
fi
# Ancien serveur Arclight : on le met de côté (et ses dossiers Bukkit ne servent plus)
[ -f arclight.jar ] && mv -f arclight.jar arclight.jar.ancien
echo "-Xms2G -Xmx6G -XX:+UseG1GC -XX:MaxGCPauseMillis=100" > user_jvm_args.txt
echo "eula=true" > eula.txt

echo "=== Mods ==="
# Téléchargements avec délai maximum et nouvelles tentatives ; un fichier n'est gardé qu'une fois complet
recuperer() {
  echo "  - $2"
  curl -fsSL --retry 4 --retry-delay 3 --retry-all-errors --connect-timeout 15 --max-time 600 -o "$1.part" "$3" && mv -f "$1.part" "$1" \
    || { rm -f "$1.part"; echo "  ! échec : $2 (relance le script)"; exit 1; }
}
# Le mod : lien direct, sinon via l'API GitHub (le lien direct renvoie parfois 404 juste après une nouvelle version)
echo "  - onyxfight-1.21.1.jar"
if ! curl -fsSL --retry 2 --retry-delay 3 --connect-timeout 15 --max-time 300 -o mods/onyxfight-1.21.1.jar.part "$MOD"; then
  ID=$(curl -fsSL --connect-timeout 15 https://api.github.com/repos/Lucasdiscordfr/onyxfight-launcher/releases/tags/mod121 \
    | python3 -c 'import sys,json; a=json.load(sys.stdin)["assets"]; e=[x for x in a if x["name"]=="onyxfight-1.21.1.jar"] or sorted([x for x in a if x["name"].startswith("onyxfight-1.21.1-")], key=lambda x: x["created_at"])[-1:]; print(e[0]["id"] if e else "")')
  curl -fsSL --retry 4 --retry-delay 3 --retry-all-errors --connect-timeout 15 --max-time 300 -H "Accept: application/octet-stream" \
    -o mods/onyxfight-1.21.1.jar.part "https://api.github.com/repos/Lucasdiscordfr/onyxfight-launcher/releases/assets/$ID" \
    || { rm -f mods/onyxfight-1.21.1.jar.part; echo "  ! échec : onyxfight-1.21.1.jar (relance le script)"; exit 1; }
fi
mv -f mods/onyxfight-1.21.1.jar.part mods/onyxfight-1.21.1.jar
telecharger() { [ -f "mods/$1" ] || recuperer "mods/$1" "$1" "$2"; }
# Mêmes mods que le serveur principal 1.21.1 (le client du launcher les a déjà)
telecharger coroutil-neoforge-1.21.0-1.3.8.jar https://cdn.modrinth.com/data/rLLJ1OZM/versions/H2YXCYUY/coroutil-neoforge-1.21.0-1.3.8.jar
telecharger watut-neoforge-1.21.0-1.2.3.jar https://mediafilez.forgecdn.net/files/6315/277/watut-neoforge-1.21.0-1.2.3.jar
# Custom Player Animations remplacé par Smooth Player Animations (côté joueur uniquement) sur ce mode
rm -f mods/cpa-*.jar
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
telecharger geckolib-neoforge-1.21.1-4.9.3.jar https://cdn.modrinth.com/data/8BmcQJ2H/versions/Grwn5rUB/geckolib-neoforge-1.21.1-4.9.3.jar
telecharger player-animation-lib-forge-2.0.4+1.21.1.jar https://cdn.modrinth.com/data/gedNE4y2/versions/HJZB6bmA/player-animation-lib-forge-2.0.4%2B1.21.1.jar
telecharger zrikons_military_armor-1.0.2-neoforge-1.21.1.jar https://cdn.modrinth.com/data/TbpolJwJ/versions/pGTyY70z/zrikons_military_armor-1.0.2-neoforge-1.21.1.jar
telecharger military_armor-neoforge-1.21.1-2.0.1.jar https://cdn.modrinth.com/data/3jCkacxI/versions/EcAyp7yP/military_armor-neoforge-1.21.1-2.0.1.jar
telecharger curios-neoforge-9.5.1+1.21.1.jar https://cdn.modrinth.com/data/vvuO3ImH/versions/yohfFbgD/curios-neoforge-9.5.1%2B1.21.1.jar
telecharger ncx_tacadd-1.4.0-neoforge-1.21.1.jar https://cdn.modrinth.com/data/wxXj6ZMS/versions/sejcFOAi/ncx_tacadd-1.4.0-neoforge-1.21.1.jar
telecharger LesRaisins-Tactical-Equipements-1.21.1-0.4.3.jar https://cdn.modrinth.com/data/zSKr1DYY/versions/fcwJFQFG/LesRaisins-Tactical-Equipements-1.21.1-0.4.3.jar
# Kotlin for Forge (thedarkcolour) : demandé par Superb Warfare 0.8.9
telecharger kotlinforforge-5.12.0-all.jar https://cdn.modrinth.com/data/ordsPcFz/versions/uhJhCT7X/kotlinforforge-5.12.0-all.jar
rm -f mods/superbwarfare-1.21.1-0.8.8-*.jar
telecharger superbwarfare-0.8.9-final-mc1.21.1-9b5284f4.jar https://cdn.modrinth.com/data/Cd3DYqzn/versions/Qdwf6rIX/superbwarfare-0.8.9-final-mc1.21.1-9b5284f4.jar
# Côté serveur uniquement (les joueurs n'en ont pas besoin)
telecharger worldedit-mod-7.3.8.jar https://cdn.modrinth.com/data/1u6JkXh5/versions/WTAFvuRx/worldedit-mod-7.3.8.jar
# Débloqués par le passage à NeoForge récent
telecharger spore_1.21.1_2.2.0j_neo.jar https://cdn.modrinth.com/data/X661i40C/versions/DwE3w8IX/spore_1.21.1_2.2.0j_neo.jar
telecharger fracturepoint-1.21.1-3.0.0-PT1-fix.jar https://cdn.modrinth.com/data/N4vy2cag/versions/7pJnGOUF/fracturepoint-1.21.1-3.0.0-PT1-fix.jar
telecharger ParCool-1.21.1-4.0.2.0.jar https://cdn.modrinth.com/data/Fsvx2bdR/versions/kMBO0X7s/ParCool-1.21.1-4.0.2.0.jar
ls -la mods

echo "=== Réglages des mods (les cartes restent intactes) ==="
# Les tirs ne cassent plus les vitres et n'allument plus de feu ; les explosions ne détruisent plus les bâtiments ;
# les infectés de Spore ne cassent pas de blocs. (Les fichiers sont créés au premier démarrage du serveur.)
regle() { [ -f "$1" ] && sed -i -E "s/^([[:space:]]*\"?$2\"?[[:space:]]*=[[:space:]]*).*/\1$3/" "$1" || true; }
regle config/tacz-common.toml DestroyGlass false
regle config/tacz-common.toml IgniteBlock false
regle config/tacz-common.toml ExplosiveAmmoDestroysBlock false
regle config/superbwarfare-server.toml explosion_destroy false
regle config/superbwarfare-server.toml extra_explosion_effect false
regle config/superbwarfare-server.toml allow_projectile_destroy_blocks false
regle config/spore-startup.toml "Should explosion break blocks \\?" false
regle config/spore-startup.toml "Should some infected have higher thinking such as opening doors or trying to break certain blocks\\?" false
grep -h -E "DestroyGlass|explosion_destroy" config/tacz-common.toml config/superbwarfare-server.toml 2>/dev/null || true

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
# Comptes OnyxFight : pseudo + mot de passe du site, vérifiés par le service des comptes. Sur la même machine que lui,
# on l'appelle en local (127.0.0.1:8090) ; ailleurs, par le site (il faut alors autoriser l'IP : ONYX_CONFIANCE).
mkdir -p config
if curl -s -o /dev/null --max-time 3 http://127.0.0.1:8090/; then API=http://127.0.0.1:8090; else API=https://play.onyxfight.fr; fi
printf 'actif=true\napi=%s\ndelai_secondes=20\n' "$API" > config/onyxfight-comptes.properties
echo "Comptes vérifiés par : $API"
# Chat vocal sur son propre port UDP
mkdir -p config/voicechat
F=config/voicechat/voicechat-server.properties
if [ -f "$F" ] && grep -q '^port=' "$F"; then sed -i -E "s/^port=.*/port=$VOIX/" "$F"; else echo "port=$VOIX" >> "$F"; fi
echo "Chat vocal : port UDP $VOIX"
chown -R onyx:onyx "$RACINE"
if command -v ufw >/dev/null 2>&1 && ufw status | grep -q "Status: active"; then ufw allow $PORT/tcp >/dev/null || true; ufw allow $VOIX/udp >/dev/null || true; fi

echo "=== Démarrage ==="
# « lumiere » : met à jour toutes les cartes et recalcule l'éclairage (zones sombres sur les vieilles cartes) avant de démarrer
OPTIONS=""
if [ "${1:-}" = "lumiere" ]; then OPTIONS="--forceUpgrade --eraseCache"; echo "Mise à jour complète des cartes et de l'éclairage : le démarrage prendra plusieurs minutes."; fi
sudo -u onyx tmux -L extraction new-session -d -s extraction "cd $DOSSIER && JAVA_HOME=$JDK PATH=$JDK/bin:\$PATH java @user_jvm_args.txt @libraries/net/neoforged/neoforge/$NEOFORGE/unix_args.txt nogui $OPTIONS; echo; echo 'Serveur Extraction arrêté. Entrée pour fermer.'; read"
echo "Serveur Extraction lancé sur le port $PORT (liste blanche active)."
echo "Premier démarrage : 2 à 4 minutes (installation de NeoForge)."
echo "Console : sudo -u onyx tmux -L extraction attach -t extraction   (Ctrl+B puis D pour sortir)"
