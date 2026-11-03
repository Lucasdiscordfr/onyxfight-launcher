#!/usr/bin/env bash
# Installation du serveur OnyxFight sur une machine Ubuntu neuve, version LTS (24.04 ou 26.04) (OVH RISE-M).
#   curl -fsSL https://raw.githubusercontent.com/Lucasdiscordfr/onyxfight-launcher/main/serveur/installer.sh | sudo bash
# Ce qu'il fait :
#   - Java 8 (Temurin), pare-feu (SSH + Minecraft), mises à jour de sécurité automatiques ;
#   - Crucible 1.7.10 (Forge + Bukkit) dans /opt/onyxfight/serveur, avec le mod OnyxFight ;
#   - service « onyxfight » (démarre avec la machine, redémarre s'il plante), console dans tmux ;
#   - sauvegarde des mondes chaque nuit (7 jours gardés), redémarrage chaque nuit à 5 h avec annonce ;
#   - un compte « deploy » pour que GitHub envoie tout seul les nouvelles versions du mod et du plugin.
# On peut le relancer sans risque : il ne supprime ni les mondes ni les réglages.
set -euo pipefail

RACINE=/opt/onyxfight
SERVEUR=$RACINE/serveur
CRUCIBLE_URL=https://github.com/CrucibleMC/Crucible/releases/download/v5.4/Crucible-1.7.10-5.4.jar
MANIFESTE=https://raw.githubusercontent.com/Lucasdiscordfr/onyxfight-launcher/main/distribution/manifest.json
MEMOIRE=${MEMOIRE:-24G}

etape() { printf '\n\033[1;35m== %s\033[0m\n' "$*"; }

[ "$(id -u)" = 0 ] || { echo "Lance ce script avec sudo."; exit 1; }

etape "Mises à jour et outils"
export DEBIAN_FRONTEND=noninteractive
apt-get -o DPkg::Lock::Timeout=900 update -q
apt-get -o DPkg::Lock::Timeout=900 upgrade -yq
apt-get -o DPkg::Lock::Timeout=900 install -yq curl wget gnupg tmux unzip jq ufw unattended-upgrades fail2ban apt-transport-https

timedatectl set-timezone Europe/Paris || true

etape "Java 8 (Temurin)"
if ! [ -x /usr/lib/jvm/temurin-8-jdk-amd64/bin/java ]; then
  install -d -m 0755 /etc/apt/keyrings
  wget -qO- https://packages.adoptium.net/artifactory/api/gpg/key/public | gpg --dearmor -o /etc/apt/keyrings/adoptium.gpg
  NOM=$(. /etc/os-release; echo "$VERSION_CODENAME")
  # Version d'Ubuntu trop récente pour le dépôt Adoptium : on prend celui de la 24.04 (mêmes paquets Java)
  curl -fsI "https://packages.adoptium.net/artifactory/deb/dists/$NOM/Release" >/dev/null 2>&1 || NOM=noble
  echo "deb [signed-by=/etc/apt/keyrings/adoptium.gpg] https://packages.adoptium.net/artifactory/deb $NOM main" \
    > /etc/apt/sources.list.d/adoptium.list
  apt-get -o DPkg::Lock::Timeout=900 update -q
  apt-get -o DPkg::Lock::Timeout=900 install -yq temurin-8-jdk
fi
JAVA=/usr/lib/jvm/temurin-8-jdk-amd64/bin/java
"$JAVA" -version 2>&1 | head -1

etape "Comptes et dossiers"
id onyx >/dev/null 2>&1 || useradd --system --create-home --home-dir $RACINE --shell /bin/bash onyx
id deploy >/dev/null 2>&1 || useradd --create-home --shell /bin/bash deploy
install -d -o onyx -g onyx $SERVEUR $SERVEUR/mods $SERVEUR/plugins $RACINE/sauvegardes $RACINE/arrivees
# GitHub (compte deploy) dépose les nouvelles versions dans « arrivees » ; elles sont posées au redémarrage
chmod 2775 $RACINE/arrivees   # groupe onyx : deploy y dépose, onyx les pose

etape "Crucible 1.7.10"
cd $SERVEUR
[ -f crucible.jar ] || sudo -u onyx wget -q -O crucible.jar "$CRUCIBLE_URL"
echo "eula=true" | sudo -u onyx tee eula.txt >/dev/null
if [ ! -f server.properties ]; then
  sudo -u onyx tee server.properties >/dev/null <<'EOF'
motd=§5§lOnyxFight §7- §fPvP Faction moddé
online-mode=true
max-players=400
view-distance=8
spawn-protection=0
difficulty=2
allow-flight=true
enable-command-block=false
snooper-enabled=false
server-port=25565
EOF
fi

etape "Mod OnyxFight (version publiée pour le launcher)"
URL_MOD=$(curl -fsSL "$MANIFESTE" | jq -r '.fichiers[] | select(.chemin=="mods/onyxfight.jar") | .url')
sudo -u onyx wget -q -O mods/onyxfight.jar "$URL_MOD"
ls -la mods

etape "Scripts du serveur"
cat > $RACINE/demarrer.sh <<EOF
#!/usr/bin/env bash
# Pose les nouvelles versions arrivées (mod, plugin), puis lance le serveur
cd $SERVEUR
for f in $RACINE/arrivees/*.jar; do
  [ -e "\$f" ] || continue
  case "\$(basename "\$f")" in
    onyxfight-mod*.jar) mv -f "\$f" mods/onyxfight.jar ;;
    OnyxFight-plugin*.jar|onyxfight-plugin*.jar) rm -f plugins/OnyxFight*.jar; mv -f "\$f" plugins/ ;;
  esac
done
exec $JAVA -Xms$MEMOIRE -Xmx$MEMOIRE -XX:+UseG1GC -XX:+ParallelRefProcEnabled -XX:MaxGCPauseMillis=200 \\
  -XX:+UnlockExperimentalVMOptions -XX:+DisableExplicitGC -XX:G1NewSizePercent=30 -XX:G1MaxNewSizePercent=40 \\
  -XX:G1HeapRegionSize=8M -XX:G1ReservePercent=20 -XX:InitiatingHeapOccupancyPercent=15 \\
  -Dfile.encoding=UTF-8 -jar crucible.jar nogui
EOF

cat > /usr/local/bin/onyx <<EOF
#!/usr/bin/env bash
# onyx console | commande "<cmd>" | maj | redemarrer | arreter | demarrer | etat | sauvegarde
S=onyxfight
cmd() { sudo -u onyx tmux send-keys -t \$S "\$1" Enter; }
case "\${1:-etat}" in
  console) echo "Ctrl+B puis D pour sortir de la console sans arrêter le serveur."; sleep 1; sudo -u onyx tmux attach -t \$S ;;
  commande) cmd "\$2" ;;
  annoncer) cmd "say \$2" ;;
  demarrer) systemctl start onyxfight ;;
  arreter) systemctl stop onyxfight ;;
  redemarrer)
    for m in 5 1; do cmd "say §c§lRedémarrage du serveur dans \$m minute(s) !"; [ \$m = 5 ] && sleep 240 || sleep 55; done
    cmd "say §c§lRedémarrage…"; sleep 5; systemctl restart onyxfight ;;
  etat) systemctl status onyxfight --no-pager | head -5 ;;
  sauvegarde) $RACINE/sauvegarder.sh ;;
  maj)
    # Met le mod à la même version que celle du launcher, puis redémarre
    URL=\$(curl -fsSL $MANIFESTE | jq -r '.fichiers[] | select(.chemin=="mods/onyxfight.jar") | .url')
    sudo -u onyx wget -q -O $SERVEUR/mods/onyxfight.jar "\$URL" && echo "Mod mis à jour : \$URL"
    systemctl restart onyxfight ;;
  *) echo "onyx console | commande \"<cmd>\" | annoncer \"<texte>\" | redemarrer | arreter | demarrer | etat | sauvegarde | maj" ;;
esac
EOF
chmod +x /usr/local/bin/onyx

cat > $RACINE/sauvegarder.sh <<EOF
#!/usr/bin/env bash
# Sauvegarde des mondes et des données des plugins (7 jours gardés)
set -e
D=$RACINE/sauvegardes/\$(date +%Y-%m-%d_%Hh%M).tar.gz
sudo -u onyx tmux send-keys -t onyxfight "save-off" Enter 2>/dev/null || true
sudo -u onyx tmux send-keys -t onyxfight "save-all" Enter 2>/dev/null || true
sleep 10
tar -czf "\$D" -C $SERVEUR --exclude='*.jar' --exclude='libraries' --exclude='logs' --exclude='crash-reports' . || true
sudo -u onyx tmux send-keys -t onyxfight "save-on" Enter 2>/dev/null || true
find $RACINE/sauvegardes -name '*.tar.gz' -mtime +7 -delete
echo "Sauvegarde : \$D (\$(du -h "\$D" | cut -f1))"
EOF
chmod +x $RACINE/demarrer.sh $RACINE/sauvegarder.sh
chown onyx:onyx $RACINE/demarrer.sh

etape "Service onyxfight"
cat > /etc/systemd/system/onyxfight.service <<EOF
[Unit]
Description=Serveur Minecraft OnyxFight (Crucible 1.7.10)
After=network-online.target
Wants=network-online.target

[Service]
Type=forking
User=onyx
WorkingDirectory=$SERVEUR
ExecStart=/usr/bin/tmux new-session -d -s onyxfight $RACINE/demarrer.sh
ExecStop=/usr/bin/tmux send-keys -t onyxfight "stop" Enter
ExecStop=/bin/bash -c 'for i in \$\$(seq 1 60); do tmux has-session -t onyxfight 2>/dev/null || exit 0; sleep 1; done'
Restart=on-failure
RestartSec=15
TimeoutStopSec=90

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable onyxfight >/dev/null

etape "Tâches de la nuit (sauvegarde 4 h 30, redémarrage 5 h)"
cat > /etc/cron.d/onyxfight <<EOF
30 4 * * * root $RACINE/sauvegarder.sh >> $RACINE/sauvegardes/journal.txt 2>&1
55 4 * * * root /usr/local/bin/onyx redemarrer >/dev/null 2>&1
EOF

etape "Pare-feu"
ufw allow OpenSSH >/dev/null
ufw allow 25565/tcp >/dev/null
ufw --force enable >/dev/null
ufw status | head -6

etape "Compte deploy (GitHub envoie les nouvelles versions)"
install -d -m 700 -o deploy -g deploy /home/deploy/.ssh
if [ ! -f /home/deploy/.ssh/github ]; then
  sudo -u deploy ssh-keygen -q -t ed25519 -N '' -C github-onyxfight -f /home/deploy/.ssh/github
  echo "restrict $(cat /home/deploy/.ssh/github.pub)" > /home/deploy/.ssh/authorized_keys
  chown deploy:deploy /home/deploy/.ssh/authorized_keys && chmod 600 /home/deploy/.ssh/authorized_keys
fi
# Ce compte ne peut que déposer des fichiers dans « arrivees » (sftp), rien d'autre
cat > /etc/ssh/sshd_config.d/onyxfight-deploy.conf <<EOF
Match User deploy
    ForceCommand internal-sftp -d $RACINE/arrivees
    AllowTcpForwarding no
    X11Forwarding no
    PermitTTY no
EOF
systemctl reload ssh 2>/dev/null || systemctl reload sshd 2>/dev/null || true
usermod -aG onyx deploy

etape "Premier démarrage (Crucible télécharge ses bibliothèques : 1 à 3 minutes)"
systemctl restart onyxfight
for _ in $(seq 1 90); do
  grep -q "Done (" $SERVEUR/logs/latest.log 2>/dev/null && break
  sleep 3
done
if grep -q "Done (" $SERVEUR/logs/latest.log 2>/dev/null; then
  echo "✅ Serveur démarré !"
else
  echo "⚠️  Le serveur n'a pas encore fini de démarrer : vérifie avec « onyx console »."
fi

IP=$(curl -fsS4 https://api.ipify.org || hostname -I | awk '{print $1}')
cat <<EOF

================================================================
 OnyxFight est installé sur $IP (port 25565)
================================================================
 Commandes : onyx console | onyx redemarrer | onyx arreter | onyx etat | onyx sauvegarde

 Pour que GitHub envoie tout seul les nouvelles versions, copie TOUT le bloc
 ci-dessous (de -----BEGIN à END-----) dans le secret DEPLOY_KEY du dépôt onyxfight :
EOF
cat /home/deploy/.ssh/github
echo "================================================================"
