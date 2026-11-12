#!/usr/bin/env bash
# Déménagement du serveur Extraction : ancien VPS (54.38.26.11) → serveur dédié. À lancer SUR LE DÉDIÉ, étape par étape :
#
#   ... | sudo bash -s -- verifier    rien n'est modifié : place, mémoire, ports, accès au VPS, tailles
#   ... | sudo bash -s -- copier      1re copie pendant que le serveur tourne encore sur le VPS (en arrière-plan)
#   ... | sudo bash -s -- basculer    arrête l'Extraction sur le VPS, recopie ce qui a changé, met l'ancien dossier de côté
#   (puis extraction.sh sur le dédié pour le démarrer)
#   ... | sudo bash -s -- archiver    archive /srv/minecraft et /opt/onyxfight du VPS dans le Backup Storage (en arrière-plan)
#   ... | sudo bash -s -- suivre      où en est la copie ou l'archive
#
# Utilise la clé temporaire /root/.ssh/crepuscule_migration (dédié → ubuntu@VPS, sudo). Ne supprime rien sur le VPS,
# ne touche ni à Crépuscule ni aux autres serveurs Minecraft du dédié, ni à /srv/minecraft/.jobs.
set -euo pipefail
VPS=ubuntu@54.38.26.11
CLE=/root/.ssh/crepuscule_migration
DOSSIER=/opt/onyxfight/extraction
ARCHIVES=/mnt/backup-storage/onyxfight/ancien-vps
URL=https://raw.githubusercontent.com/Lucasdiscordfr/onyxfight-launcher/main/serveur/extraction/demenager.sh
COPIE=/usr/local/lib/onyxfight-demenager.sh
[ "$(id -u)" = 0 ] || { echo "Lance ce script avec sudo."; exit 1; }
[ -f "$CLE" ] || { echo "Clé $CLE introuvable."; exit 1; }
SSH="ssh -i $CLE -o BatchMode=yes -o StrictHostKeyChecking=accept-new -o ConnectTimeout=15 -o ServerAliveInterval=30"
vps() { $SSH "$VPS" "$@"; }
synchro() { nice rsync -aHx --numeric-ids --delete --info=stats1 -e "$SSH" --rsync-path="sudo rsync" "$VPS:/opt/onyxfight/extraction/" "$DOSSIER/"; }

# Les étapes longues tournent en arrière-plan (elles continuent si la connexion SSH se coupe)
en_fond() {
  curl -fsSL "$URL" -o "$COPIE"
  systemctl reset-failed "onyxfight-demenager-$1" 2>/dev/null || true
  systemd-run --quiet --collect --unit "onyxfight-demenager-$1" /bin/bash "$COPIE" "$1" fond
  echo "Lancé en arrière-plan. Pour suivre : ... | sudo bash -s -- suivre"
}

case "${1:-}" in
verifier)
  echo "=== Dédié ==="
  echo "Mémoire :"; free -h | sed -n 1,2p
  echo "Processeurs : $(nproc)"
  df -h /opt | tail -1 | awk '{print "Place libre sur /opt : " $4}'
  mountpoint -q /mnt/backup-storage && df -h /mnt/backup-storage | tail -1 | awk '{print "Backup Storage : " $4 " libres"}' || echo "! /mnt/backup-storage n'est pas monté"
  id onyx >/dev/null 2>&1 && echo "Utilisateur onyx : présent" || echo "Utilisateur onyx : absent (extraction.sh le créera)"
  [ -e "$DOSSIER" ] && echo "! $DOSSIER existe déjà ($(du -sh "$DOSSIER" | cut -f1))" || echo "$DOSSIER : libre"
  echo "Ports pris (25570/tcp, 24455/udp) :"; ss -lntup 2>/dev/null | grep -E ':(25570|24455)\b' || echo "  aucun, c'est bon"
  command -v rsync >/dev/null && echo "rsync : présent" || echo "rsync : absent (sera installé)"
  echo "Service des comptes en local : $(curl -s -o /dev/null -w '%{http_code}' --max-time 3 http://127.0.0.1:8090/ || echo injoignable)"
  echo "=== VPS ==="
  vps 'hostname; command -v rsync >/dev/null && echo rsync : présent || echo rsync : ABSENT
       sudo du -sh /opt/onyxfight/extraction /opt/onyxfight /srv/minecraft 2>/dev/null
       echo Java en cours :; ps -o user=,pid=,etime=,args= -C java | cut -c1-140 || true
       echo Tâches planifiées :; sudo ls /etc/cron.d; sudo crontab -l -u onyx 2>/dev/null || echo aucune pour onyx'
  ;;
copier)
  if [ "${2:-}" != fond ]; then en_fond copier; exit 0; fi
  command -v rsync >/dev/null || apt-get -o DPkg::Lock::Timeout=900 install -yq rsync
  install -d -o onyx -g onyx /opt/onyxfight "$DOSSIER" 2>/dev/null || install -d "$DOSSIER"
  echo "Copie à chaud depuis le VPS (le serveur y tourne encore)…"
  synchro
  echo "COPIE TERMINÉE ($(du -sh "$DOSSIER" | cut -f1)). Étape suivante : basculer."
  ;;
basculer)
  [ -d "$DOSSIER/world" ] || { echo "Fais d'abord l'étape copier."; exit 1; }
  echo "=== Arrêt de l'Extraction sur le VPS ==="
  vps 'if sudo -u onyx tmux -L extraction has-session -t extraction 2>/dev/null; then
         sudo -u onyx tmux -L extraction send-keys -t extraction stop Enter
         for i in $(seq 1 120); do pgrep -u onyx java >/dev/null || break; sleep 1; done
         sudo -u onyx tmux -L extraction kill-session -t extraction 2>/dev/null || true
       fi
       pgrep -u onyx java >/dev/null && { echo Java encore actif sur le VPS : arrêt annulé; exit 1; } || echo Arrêté.'
  echo "=== Dernière copie (seulement ce qui a changé) ==="
  synchro
  chown -R onyx:onyx "$DOSSIER"
  echo "=== Ancien dossier mis de côté sur le VPS (rien n'est supprimé) ==="
  vps 'sudo mv /opt/onyxfight/extraction /opt/onyxfight/extraction.demenage && echo /opt/onyxfight/extraction.demenage'
  echo "Bascule faite. Démarre maintenant le serveur sur le dédié avec extraction.sh."
  ;;
archiver)
  if [ "${2:-}" != fond ]; then en_fond archiver; exit 0; fi
  mountpoint -q /mnt/backup-storage || { echo "/mnt/backup-storage n'est pas monté."; exit 1; }
  install -d -m 700 "$ARCHIVES"
  D=$(date +%Y-%m-%d)
  for src in /srv/minecraft /opt/onyxfight; do
    nom=$(echo "$src" | tr / - | sed 's/^-//')
    f="$ARCHIVES/$nom-$D.tar.gz"
    echo "Archive de $src → $f"
    vps "sudo nice tar -C $(dirname $src) -czf - $(basename $src)" > "$f.part"
    mv "$f.part" "$f"
    echo "  $(du -h "$f" | cut -f1), vérification…"
    tar -tzf "$f" >/dev/null && echo "  archive lisible" || echo "  ! archive illisible"
  done
  ls -lh "$ARCHIVES"
  echo "ARCHIVES TERMINÉES."
  ;;
suivre)
  for e in copier archiver; do
    echo "=== $e ($(systemctl is-active onyxfight-demenager-$e 2>/dev/null || true)) ==="
    journalctl -u "onyxfight-demenager-$e" --no-pager -n 8 -o cat 2>/dev/null || true
  done
  ;;
*) echo "Étape : verifier | copier | basculer | archiver | suivre"; exit 1 ;;
esac
