// Statut Discord (Rich Presence) : « Dans le launcher », puis « En jeu sur OnyxFight » pendant la partie.
// Il faut l'identifiant d'une application Discord (discord.com/developers) : champ « discordApplication » du manifeste,
// avec une image « logo » dans Rich Presence → Art Assets. Sans identifiant, rien ne s'affiche (aucune erreur).
let client = null;
let pret = false;
let debut = Date.now();
let dernier = null;
let infos = { site: '', discord: '' };

function boutons() {
  const b = [];
  if (infos.site && /^https:\/\//.test(infos.site)) b.push({ label: 'Site OnyxFight', url: infos.site });
  if (infos.discord && /^https:\/\//.test(infos.discord)) b.push({ label: 'Discord', url: infos.discord });
  return b.length ? b : undefined;
}

function appliquer() {
  if (!pret || !client || !client.user || !dernier) return;
  client.user.setActivity({
    details: dernier.details,
    state: dernier.etat,
    startTimestamp: debut,
    largeImageKey: 'logo',
    largeImageText: 'OnyxFight · PvP Faction moddé',
    buttons: boutons(),
    instance: false,
  }).catch(() => {});
}

/** Démarre la connexion à Discord (si l'application Discord est ouverte). */
function demarrer(idApplication, liens) {
  if (!idApplication || client) return;
  infos = liens || infos;
  try {
    const { Client } = require('@xhayper/discord-rpc');
    client = new Client({ clientId: String(idApplication), transport: { type: 'ipc' } });
    client.on('ready', () => {
      pret = true;
      appliquer();
    });
    client.on('disconnected', () => {
      pret = false;
    });
    client.login().catch(() => {
      client = null; // Discord fermé : on réessaiera au prochain changement
    });
  } catch (e) {
    client = null;
  }
}

/** Change le statut affiché. */
function statut(details, etat, depuisMaintenant) {
  if (depuisMaintenant) debut = Date.now();
  dernier = { details, etat };
  appliquer();
}

function arreter() {
  if (client) client.destroy().catch(() => {});
  client = null;
  pret = false;
}

module.exports = { demarrer, statut, arreter };
