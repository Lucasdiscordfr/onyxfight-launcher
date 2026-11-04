#!/usr/bin/env bash
# MIGRATION DU VRAI SERVEUR EN 1.21.1 (Arclight = NeoForge + plugins), sur le port 25565.
# Le serveur 1.7.10 est arrêté et GARDÉ tel quel (dossier serveur/) : retour possible avec retour17.sh.
#
#   curl -fsSL https://raw.githubusercontent.com/Lucasdiscordfr/onyxfight-launcher/main/serveur/migration121/migrer.sh | sudo bash -s -- oui
#
# Étapes : sauvegarde ; arrêt du 1.7 ; recollage de la map actuelle dans la map 1.8 (recoller.sh) ; conversion en 1.21.1
# (convertir121.sh) ; nouveau serveur dans serveur121/ avec la map, les mods, le plugin et SES DONNÉES (factions, argent,
# grades…) ; table des numéros 1.7 pour les objets de l'hôtel des ventes ; le service « onyxfight » lance maintenant le
# 1.21.1 (mêmes commandes onyx). Après le démarrage : se connecter en OP et taper /restaurer (blocs du mod de la map).
set -euo pipefail
[ "${1:-}" = "oui" ] || { echo "Ajoute « oui » pour confirmer : ... | sudo bash -s -- oui"; exit 1; }
[ "$(id -u)" = 0 ] || { echo "Lance ce script avec sudo."; exit 1; }
RACINE=/opt/onyxfight
ANCIEN=$RACINE/serveur
NOUVEAU=$RACINE/serveur121
DEPOT=https://raw.githubusercontent.com/Lucasdiscordfr/onyxfight-launcher/main/serveur
JAVA=/usr/lib/jvm/temurin-21-jdk-amd64/bin/java
ARCLIGHT=https://github.com/IzzelAliz/Arclight/releases/download/FeudalKings%2F1.0.1/arclight-neoforge-1.21.1-1.0.1-8ec9529.jar
[ -f "$RACINE/carte18/plugins/OnyxCarte/TERMINE" ] || { echo "La map 1.8 (carte18.sh) n'est pas prête."; exit 1; }

echo "=== 1. Sauvegarde du serveur 1.7 ==="
[ -x $RACINE/sauvegarder.sh ] && $RACINE/sauvegarder.sh || echo "(pas de script de sauvegarde)"

echo "=== 2. Arrêt du serveur 1.7 (il est gardé dans $ANCIEN) ==="
/usr/local/bin/onyx annoncer "§d§lOnyxFight passe en 1.21.1 ! §fFermeture dans 30 s, relancez le launcher ensuite." 2>/dev/null || true
sleep 30
systemctl stop onyxfight || true
[ -f /etc/systemd/system/onyxfight.service ] && cp -n /etc/systemd/system/onyxfight.service $RACINE/onyxfight-1.7.service

echo "=== 3. Recollage de la map actuelle dans la map 1.8 ==="
curl -fsSL "$DEPOT/carte18/recoller.sh" | bash

echo "=== 4. Conversion en 1.21.1 ==="
curl -fsSL "$DEPOT/carte18/convertir121.sh" | bash

echo "=== 5. Nouveau serveur 1.21.1 ($NOUVEAU) ==="
[ -d "$NOUVEAU" ] && mv "$NOUVEAU" "$NOUVEAU.ancien.$(date +%s)"
install -d -o onyx -g onyx "$NOUVEAU" "$NOUVEAU/mods" "$NOUVEAU/plugins"
cd "$NOUVEAU"
curl -fsSL -o arclight.jar "$ARCLIGHT"
echo "eula=true" > eula.txt
echo "-Xms6G -Xmx10G -XX:+UseG1GC -XX:+ParallelRefProcEnabled -XX:MaxGCPauseMillis=200 -Dfile.encoding=UTF-8" > user_jvm_args.txt
cp -a $RACINE/conversion121/world world
# Réglages du serveur 1.7 gardés (sauf ce qui change en 1.21.1)
cp "$ANCIEN/server.properties" server.properties
sed -i -e 's/^level-name=.*/level-name=world/' -e 's/^server-port=.*/server-port=25565/' -e '/^snooper-enabled/d' server.properties
for f in ops.json whitelist.json banned-players.json banned-ips.json; do [ -f "$ANCIEN/$f" ] && cp "$ANCIEN/$f" . || true; done
# Données du plugin (factions, argent, grades, homes, hôtel des ventes…)
if [ -d "$ANCIEN/plugins/OnyxFight" ]; then
  cp -a "$ANCIEN/plugins/OnyxFight" plugins/OnyxFight
  # Noms d'objets 1.7 qui ont changé de sens en 1.21 (le reste est converti par le plugin)
  C=plugins/OnyxFight/config.yml
  if [ -f "$C" ]; then
    sed -i -E -e 's/(^|[ "])BRICK([ "@]|$)/\1BRICKS\2/g' -e 's/(^|[ "])GRASS([ "@]|$)/\1GRASS_BLOCK\2/g' \
      -e 's/(^|[ "])MELON([ "@]|$)/\1MELON_SLICE\2/g' -e 's/mob: PIG_ZOMBIE/mob: ZOMBIFIED_PIGLIN/g' -e 's/mob: MUSHROOM_COW/mob: MOOSHROOM/g' "$C"
  fi
fi
# Table des numéros d'objets de la map 1.7 (objets gardés par le plugin 1.7)
curl -fsSL -o /tmp/ids17.py "$DEPOT/carte18/ids17.py"
curl -fsSL -o /tmp/fusion.py "$DEPOT/carte18/fusion.py"
python3 /tmp/ids17.py $RACINE/fusion/ancienne plugins/OnyxFight/ids-1.7.txt || echo "⚠ table des numéros 1.7 non écrite"
AUTRES=$(ls "$ANCIEN/plugins" 2>/dev/null | grep -iv "^onyxfight" | tr '\n' ' ' || true)

echo "=== 6. Service onyxfight → 1.21.1 ==="
cat > $RACINE/demarrer121.sh <<EOF
#!/usr/bin/env bash
# Met à jour le mod, les mods tiers et le plugin, puis lance le serveur 1.21.1 (Arclight)
cd $NOUVEAU
curl -fsSL -o mods/onyxfight-1.21.1.jar https://github.com/Lucasdiscordfr/onyxfight-launcher/releases/download/mod121/onyxfight-1.21.1.jar || true
[ -f mods/coroutil-neoforge-1.21.0-1.3.8.jar ] || curl -fsSL -o mods/coroutil-neoforge-1.21.0-1.3.8.jar https://cdn.modrinth.com/data/rLLJ1OZM/versions/H2YXCYUY/coroutil-neoforge-1.21.0-1.3.8.jar || true
[ -f mods/watut-neoforge-1.21.0-1.2.3.jar ] || curl -fsSL -o mods/watut-neoforge-1.21.0-1.2.3.jar https://mediafilez.forgecdn.net/files/6315/277/watut-neoforge-1.21.0-1.2.3.jar || true
[ -f "mods/cpa-5.9.10-neoforge+1.21.1.jar" ] || curl -fsSL -o "mods/cpa-5.9.10-neoforge+1.21.1.jar" "https://cdn.modrinth.com/data/EhthJpjM/versions/YvEolJOg/cpa-5.9.10-neoforge%2B1.21.1.jar" || true
[ -f "mods/PlayerAnimationLibNeoforge-1.1.6+mc.1.21.1.jar" ] || curl -fsSL -o "mods/PlayerAnimationLibNeoforge-1.1.6+mc.1.21.1.jar" "https://cdn.modrinth.com/data/ha1mEyJS/versions/yjxtkvnD/PlayerAnimationLibNeoforge-1.1.6%2Bmc.1.21.1.jar" || true
[ -f mods/cloth-config-15.0.140-neoforge.jar ] || curl -fsSL -o mods/cloth-config-15.0.140-neoforge.jar https://cdn.modrinth.com/data/9s6osm5g/versions/izKINKFg/cloth-config-15.0.140-neoforge.jar || true
[ -f $RACINE/arrivees/test121-plugin.jar ] && cp -f $RACINE/arrivees/test121-plugin.jar plugins/OnyxFight.jar
exec $JAVA @user_jvm_args.txt -jar arclight.jar nogui
EOF
chmod +x $RACINE/demarrer121.sh
cat > /etc/systemd/system/onyxfight.service <<EOF
[Unit]
Description=Serveur Minecraft OnyxFight (Arclight 1.21.1)
After=network-online.target
Wants=network-online.target

[Service]
Type=forking
User=onyx
WorkingDirectory=$NOUVEAU
ExecStart=/usr/bin/tmux new-session -d -s onyxfight $RACINE/demarrer121.sh
ExecStop=/usr/bin/tmux send-keys -t onyxfight "stop" Enter
ExecStop=/bin/bash -c 'for i in \$\$(seq 1 90); do tmux has-session -t onyxfight 2>/dev/null || exit 0; sleep 1; done'
Restart=on-failure
RestartSec=15
TimeoutStopSec=120

[Install]
WantedBy=multi-user.target
EOF
chown -R onyx:onyx "$NOUVEAU" $RACINE/demarrer121.sh
systemctl daemon-reload
systemctl start onyxfight

echo
echo "✔ Serveur 1.21.1 lancé sur le port 25565 (console : onyx console)."
echo "  1. Connecte-toi en OP et tape /restaurer (blocs du mod de la map)."
echo "  2. Le serveur 1.7 est gardé dans $ANCIEN ; retour : .../migration121/retour17.sh"
[ -n "$AUTRES" ] && echo "  ⚠ Autres plugins du 1.7 non copiés (à vérifier pour la 1.21.1) : $AUTRES"
