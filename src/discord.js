// Statut Discord (Rich Presence) : dans le launcher, puis en jeu avec le nombre de joueurs connectés.
// Il faut l'identifiant d'une application Discord (discord.com/developers) : champ « discordApplication » du manifeste.
// Les images viennent du site (adresses https, rien à téléverser sur Discord). Sans identifiant, rien ne s'affiche.
const https = require('https');

let client = null;
let pret = false;
let debut = Date.now();
let dernier = null;
let infos = { site: '', discord: '', comptes: '' };
let joueurs = null;
let minuterie = null;

function boutons() {
  const b = [];
  if (infos.site && /^https:\/\//.test(infos.site)) b.push({ label: '🌐 Rejoindre OnyxFight', url: infos.site });
  if (infos.discord && /^https:\/\//.test(infos.discord)) b.push({ label: '💬 Discord', url: infos.discord });
  return b.length ? b : undefined;
}

function image(nom) {
  const base = (infos.comptes || infos.site || '').replace(/\/+$/, '');
  return /^https:\/\//.test(base) ? base + '/' + nom : 'logo';
}

function appliquer() {
  if (!pret || !client || !client.user || !dernier) return;
  const a = {
    details: dernier.details,
    state: dernier.etat,
    startTimestamp: debut,
    largeImageKey: image('icone.png'),
    largeImageText: 'OnyxFight · PvP Faction moddé 1.21.1',
    buttons: boutons(),
    instance: false,
  };
  if (dernier.enJeu && joueurs) {
    a.smallImageKey = image('logo.png');
    a.smallImageText = joueurs.joueurs + ' joueur' + (joueurs.joueurs > 1 ? 's' : '') + ' en ligne';
    if (joueurs.max > 0) {
      a.partySize = Math.max(1, joueurs.joueurs);
      a.partyMax = Math.max(joueurs.max, a.partySize);
    }
  }
  client.user.setActivity(a).catch(() => {});
}

/** Nombre de joueurs connectés (API du site), toutes les minutes pendant la partie. */
function lireJoueurs() {
  const base = (infos.comptes || '').replace(/\/+$/, '');
  if (!/^https:\/\//.test(base)) return;
  https.get(base + '/api/statut', { timeout: 8000 }, (res) => {
    let t = '';
    res.on('data', (d) => { t += d; });
    res.on('end', () => {
      try {
        const j = JSON.parse(t);
        joueurs = j.enLigne ? { joueurs: Number(j.joueurs) || 0, max: Number(j.max) || 0 } : null;
        appliquer();
      } catch (e) {
        // rien
      }
    });
  }).on('error', () => {});
}

/** Démarre la connexion à Discord (si l'application Discord est ouverte). */
function demarrer(idApplication, liens) {
  if (!idApplication || client) return;
  infos = Object.assign(infos, liens || {});
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

/** Dans le launcher. */
function launcher(pseudo) {
  debut = Date.now();
  dernier = { details: 'Dans le launcher', etat: pseudo ? 'Connecté : ' + pseudo : 'Prépare sa partie', enJeu: false };
  if (minuterie) clearInterval(minuterie);
  minuterie = null;
  appliquer();
}

/** En jeu. */
function enJeu(pseudo) {
  debut = Date.now();
  dernier = { details: '⚔ En combat sur OnyxFight', etat: pseudo ? 'Joue en tant que ' + pseudo : 'PvP Faction moddé', enJeu: true };
  lireJoueurs();
  if (minuterie) clearInterval(minuterie);
  minuterie = setInterval(lireJoueurs, 60000);
  appliquer();
}

/** Ancien appel (gardé). */
function statut(details, etat, depuisMaintenant) {
  if (depuisMaintenant) debut = Date.now();
  dernier = { details, etat, enJeu: false };
  appliquer();
}

function arreter() {
  if (minuterie) clearInterval(minuterie);
  minuterie = null;
  if (client) client.destroy().catch(() => {});
  client = null;
  pret = false;
}

module.exports = { demarrer, statut, launcher, enJeu, arreter };
