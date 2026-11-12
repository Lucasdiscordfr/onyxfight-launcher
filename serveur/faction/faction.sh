#!/usr/bin/env bash
# Serveur FACTION 1.21.1 sur NeoForge récent (sans Arclight ni plugin Bukkit) : le jeu Faction est maintenant le mod serveur
# privé « onyxfight-faction » (ancien plugin réécrit). Mêmes mods que le serveur Extraction : un seul jeu pour les deux.
# Il reprend le serveur de test 1.21.1 (dossier test121, port 25566) : la map et les données du plugin sont gardées.
#
#   curl -fsSL https://raw.githubusercontent.com/Lucasdiscordfr/onyxfight-launcher/main/serveur/faction/faction.sh | sudo bash
#
# Relancer la commande met les mods à jour et redémarre le serveur.
# Retour à Arclight + plugin (si besoin) : relancer serveur/test121/test121.sh.
# Console : sudo -u onyx tmux -L test121 attach -t test121   (Ctrl+B puis D pour sortir)
set -euo pipefail
RACINE=/opt/onyxfight
DOSSIER=$RACINE/test121
NEOFORGE=21.1.265
PORT=25566
MOD=https://github.com/Lucasdiscordfr/onyxfight-launcher/releases/download/mod121/onyxfight-1.21.1.jar
FACTION=$RACINE/arrivees/faction-serveur.jar
JDK=/usr/lib/jvm/temurin-21-jdk-amd64
[ -x "$JDK/bin/java" ] || JDK=/usr/lib/jvm/java-21-openjdk-amd64
[ "$(id -u)" = 0 ] || { echo "Lance ce script avec sudo."; exit 1; }
[ -d "$DOSSIER/world" ] || { echo "Serveur de test 1.21.1 introuvable ($DOSSIER/world) : lance d'abord test121.sh."; exit 1; }
[ -f "$FACTION" ] || { echo "Mod serveur Faction pas encore arrivé ($FACTION) : attends la fin de sa compilation sur GitHub."; exit 1; }

echo "=== Java 21 ==="
"$JDK/bin/java" -version 2>&1 | head -1

echo "=== Arrêt du serveur Faction de test (s'il tourne) ==="
if sudo -u onyx tmux -L test121 has-session -t test121 2>/dev/null; then
  sudo -u onyx tmux -L test121 send-keys -t test121 "stop" Enter
  for i in $(seq 1 120); do A=""; for p in $(pgrep -u onyx java 2>/dev/null); do [ "$(readlink -f /proc/$p/cwd 2>/dev/null)" = "$DOSSIER" ] && A=1; done; [ -n "$A" ] || break; sleep 1; done
  sudo -u onyx tmux -L test121 kill-session -t test121 2>/dev/null || true
fi

cd "$DOSSIER"
echo "=== Sauvegarde (map + données du plugin) ==="
SAUV=$RACINE/sauvegardes/test121-avant-neoforge-$(date +%Y%m%d-%H%M%S).tar.gz
install -d -o onyx -g onyx $RACINE/sauvegardes
if [ ! -f "$DOSSIER/.neoforge" ]; then
  tar -czf "$SAUV" world plugins server.properties 2>/dev/null && echo "  → $SAUV" || echo "  ! sauvegarde incomplète"
fi

echo "=== NeoForge $NEOFORGE ==="
if [ ! -f "libraries/net/neoforged/neoforge/$NEOFORGE/unix_args.txt" ]; then
  curl -fsSL --retry 4 -o neoforge-installer.jar "https://maven.neoforged.net/releases/net/neoforged/neoforge/$NEOFORGE/neoforge-$NEOFORGE-installer.jar"
  sudo -u onyx "$JDK/bin/java" -jar neoforge-installer.jar --installServer >/dev/null 2>&1 || { echo "  ! installation de NeoForge impossible"; exit 1; }
  rm -f neoforge-installer.jar neoforge-installer.jar.log run.bat run.sh
fi
[ -f arclight.jar ] && mv -f arclight.jar arclight.jar.ancien
echo "-Xms4G -Xmx8G -XX:+UseG1GC -XX:MaxGCPauseMillis=100" > user_jvm_args.txt
echo "eula=true" > eula.txt
touch .neoforge

echo "=== Données du jeu Faction (reprises de l'ancien plugin) ==="
# Le mod serveur lit les mêmes fichiers YAML, dans onyxfight/faction (copie une seule fois : l'original reste dans plugins/)
if [ ! -d onyxfight/faction ]; then
  install -d -o onyx -g onyx onyxfight/faction
  if [ -d plugins/OnyxFight ]; then
    cp -a plugins/OnyxFight/. onyxfight/faction/
    rm -f onyxfight/faction/*.jar
    echo "  Données copiées : $(ls onyxfight/faction | wc -l) fichiers"
  else
    echo "  Pas de données de plugin : le jeu Faction démarre à neuf."
  fi
fi

# L'émeraude est devenue l'axinite (mod OnyxFight) : noms dans la config du jeu Faction
if [ -f onyxfight/faction/config.yml ]; then
  sed -i -E -e 's/onyxfight:([a-z_]+)_emeraude/onyxfight:\1_axinite/g' -e 's/en émeraude/en axinite/g' -e 's/"EMERALD 0 40 Émeraude"/"onyxfight:axinite 0 40 Axinite"/' onyxfight/faction/config.yml
fi

echo "=== Mods ==="
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
# Le mod serveur Faction (privé, envoyé par GitHub au serveur)
cp -f "$FACTION" mods/onyxfight-faction.jar
# Rien de Bukkit ici
rm -f mods/easy_npc*.jar
ls -la mods

# On garde server.properties du serveur de test (port, comptes…), on vérifie juste le port
grep -q "^server-port=" server.properties && sed -i "s/^server-port=.*/server-port=$PORT/" server.properties || echo "server-port=$PORT" >> server.properties
chown -R onyx:onyx "$DOSSIER"
ufw allow $PORT/tcp >/dev/null 2>&1 || true

echo "=== Démarrage ==="
sudo -u onyx tmux -L test121 new-session -d -s test121 "cd $DOSSIER && JAVA_HOME=$JDK PATH=$JDK/bin:\$PATH java @user_jvm_args.txt @libraries/net/neoforged/neoforge/$NEOFORGE/unix_args.txt nogui; echo; echo 'Serveur Faction arrêté. Entrée pour fermer.'; read"
echo "Serveur Faction (NeoForge $NEOFORGE) lancé sur le port $PORT."
echo "Premier démarrage : 2 à 4 minutes (installation de NeoForge)."
echo "Console : sudo -u onyx tmux -L test121 attach -t test121   (Ctrl+B puis D pour sortir)"
