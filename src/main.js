// Processus principal du launcher OnyxFight : fenêtre, compte, réglages, lancement du jeu, mises à jour.
const { app, BrowserWindow, ipcMain, shell, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const cfg = require('./config');
const Compte = require('./compte');
const { jouer121 } = require('./jeu121');
const { lireJson } = require('./telechargement');
const discord = require('./discord');

let fenetre = null;
let enJeu = false;
const compte = new Compte(cfg.DOSSIER);
const fichierReglages = path.join(cfg.DOSSIER, 'launcher.json');

function reglages() {
  try {
    return Object.assign({ ram: 4, garderOuvert: false, connexionDirecte: false, dossier: cfg.DOSSIER },
      JSON.parse(fs.readFileSync(fichierReglages, 'utf8')));
  } catch (e) {
    return { ram: 4, garderOuvert: false, connexionDirecte: false, dossier: cfg.DOSSIER };
  }
}

function sauverReglages(r) {
  fs.mkdirSync(cfg.DOSSIER, { recursive: true });
  fs.writeFileSync(fichierReglages, JSON.stringify(r, null, 2));
}

function envoyer(canal, donnees) {
  if (fenetre && !fenetre.isDestroyed()) fenetre.webContents.send(canal, donnees);
}

function creerFenetre() {
  fenetre = new BrowserWindow({
    width: 1100,
    height: 640,
    minWidth: 960,
    minHeight: 580,
    frame: false,
    backgroundColor: '#0b0910',
    icon: path.join(__dirname, '..', 'assets', 'icone.png'),
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  fenetre.loadFile(path.join(__dirname, 'ui', 'index.html'));
  fenetre.once('ready-to-show', () => fenetre.show());
  // Les liens s'ouvrent dans le navigateur, jamais dans le launcher
  fenetre.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

/** Texte d'erreur lisible (msmc renvoie des objets avec un code « ts », pas des Error). */
function texteErreur(e) {
  if (!e) return 'Erreur inconnue.';
  const code = e.ts || (e.opt && e.opt.ts) || '';
  if (/^error\.auth|^error\.state|^error\.gui/.test(String(code))) {
    if (/minecraft\.login|429|rate/i.test(String(code) + JSON.stringify(e.response || e.opt || ''))) {
      return 'Microsoft refuse pour l\'instant (trop de connexions) : réessaie dans quelques minutes.';
    }
    return 'Connexion Microsoft expirée ou refusée (' + code + ') : clique sur « Changer de compte » et reconnecte-toi.';
  }
  if (e.message) return e.message;
  try {
    return JSON.stringify(e).slice(0, 300);
  } catch (x) {
    return String(e);
  }
}

// ---------- Fenêtre ----------
ipcMain.on('fenetre', (e, quoi) => {
  if (!fenetre) return;
  if (quoi === 'reduire') fenetre.minimize();
  if (quoi === 'fermer') fenetre.close();
});
ipcMain.on('ouvrir', (e, url) => {
  if (/^https:\/\//.test(url)) shell.openExternal(url);
});

// ---------- Infos ----------
ipcMain.handle('infos', async () => ({
  version: app.getVersion(),
  reglages: reglages(),
  site: cfg.SITE,
  discord: cfg.DISCORD,
  memoireMax: Math.max(2, Math.floor(require('os').totalmem() / 1024 ** 3) - 1),
}));

ipcMain.handle('actualites', async () => {
  try {
    return await lireJson(cfg.ACTUALITES);
  } catch (e) {
    return [];
  }
});

ipcMain.handle('statut', async () => {
  try {
    const m = await lireJson(cfg.MANIFESTE);
    // Le serveur 1.21.1 est désormais le serveur OnyxFight (l'ancien 1.7.10 n'est plus proposé)
    const test = !!m.v121;
    const s = test ? m.v121.serveur : m.serveur || cfg.SERVEUR;
    const util = require('minecraft-server-util');
    const r = await util.status(s.hote, s.port || 25565, { timeout: 4000, enableSRV: !test });
    return { enLigne: true, joueurs: r.players.online, max: r.players.max, adresse: s.hote, test: !!test };
  } catch (e) {
    return { enLigne: false, test: true };
  }
});

// ---------- Compte ----------
/** Adresse du service des comptes et du site, d'après le manifeste. */
async function reglerComptes() {
  try {
    const m = await lireJson(cfg.MANIFESTE);
    Compte.regler(m.comptes);
    return m;
  } catch (e) {
    return null;
  }
}
ipcMain.handle('compte:reprendre', async () => {
  await reglerComptes();
  return compte.reprendre();
});
ipcMain.handle('compte:connecter', async (e, pseudo, motdepasse) => {
  try {
    const profil = await compte.connecter(pseudo, motdepasse);
    if (!enJeu) discord.launcher(profil && profil.pseudo);
    return { profil };
  } catch (x) {
    return { erreur: texteErreur(x) };
  }
});
/** Skin importé sur le site (PNG en base64), pour afficher la tête dans le launcher ; null si aucun. */
ipcMain.handle('compte:skin', async (e, pseudo) => {
  try {
    if (!/^[A-Za-z0-9_]{3,16}$/.test(String(pseudo))) return null;
    const m = await reglerComptes();
    const base = ((m && m.comptes) || cfg.COMPTES).replace(/\/+$/, '');
    const a = await (await fetch(`${base}/api/apparence/${pseudo}`, { signal: AbortSignal.timeout(6000) })).json();
    if (!a.skin || !/^\//.test(a.skin.url)) return null;
    const r = await fetch(base + a.skin.url, { signal: AbortSignal.timeout(6000) });
    if (!r.ok) return null;
    const b = Buffer.from(await r.arrayBuffer());
    return b.length <= 65536 ? b.toString('base64') : null;
  } catch (x) {
    return null;
  }
});
ipcMain.handle('compte:inscription', async () => {
  const m = await reglerComptes();
  shell.openExternal(((m && m.comptes) || cfg.COMPTES).replace(/\/+$/, '') + '/inscription');
});
ipcMain.handle('compte:deconnecter', async () => compte.deconnecter());

/** Mode test (comptes hors ligne) : ouvert seulement si le manifeste le dit (« modeTest »: true). */
async function modeTestOuvert() {
  try {
    return (await lireJson(cfg.MANIFESTE)).modeTest === true;
  } catch (e) {
    return false;
  }
}
ipcMain.handle('compte:modeTest', async () => modeTestOuvert());
ipcMain.handle('compte:test', async (e, pseudo) => {
  if (!(await modeTestOuvert())) return { erreur: 'Le mode test n\'est pas ouvert en ce moment.' };
  try {
    return { profil: compte.connecterTest(pseudo) };
  } catch (x) {
    return { erreur: texteErreur(x) };
  }
});

// ---------- Réglages ----------
ipcMain.handle('reglages:sauver', async (e, r) => {
  const actuel = reglages();
  const nouveau = Object.assign(actuel, {
    ram: Math.max(1, Math.min(32, parseInt(r.ram, 10) || 4)),
    garderOuvert: !!r.garderOuvert,
    connexionDirecte: !!r.connexionDirecte,
    version121: !!r.version121,
  });
  sauverReglages(nouveau);
  return nouveau;
});
ipcMain.handle('reglages:dossier', async () => {
  const r = reglages();
  shell.openPath(r.dossier);
});

// ---------- Jouer ----------
ipcMain.handle('jouer', async () => {
  if (enJeu) return { erreur: 'Le jeu est déjà lancé.' };
  enJeu = true;
  const r = Object.assign(reglages(), { versionLauncher: app.getVersion() });
  const journal = path.join(r.dossier, 'launcher-dernier-lancement.log');
  fs.mkdirSync(r.dossier, { recursive: true });
  const flux = fs.createWriteStream(journal);
  flux.write(`OnyxFight Launcher ${app.getVersion()}\n`);
  try {
    if (compte.test && !(await modeTestOuvert())) throw new Error('Le mode test est fermé : connecte-toi avec ton compte OnyxFight.');
    const manifeste = await lireJson(cfg.MANIFESTE);
    Compte.regler(manifeste.comptes);
    if (manifeste.comptes) r.comptes = manifeste.comptes;
    const autorisation = await compte.pourJouer();
    const v121 = manifeste.v121;
    if (!v121) throw new Error("Le serveur OnyxFight n'est pas disponible pour le moment.");
    await jouer121(r, autorisation, v121, {
      etat: (texte, part) => envoyer('etat', { texte, part }),
      journal: (l) => flux.write(l.endsWith('\n') ? l : l + '\n'),
      lance: () => {
        envoyer('etat', { texte: 'Bon jeu sur OnyxFight !', part: 1, lance: true });
        discord.enJeu(compte.profil() && compte.profil().pseudo);
        if (!r.garderOuvert && fenetre) fenetre.hide();
      },
      ferme: (code) => {
        enJeu = false;
        discord.launcher(compte.profil() && compte.profil().pseudo);
        flux.end();
        if (fenetre) {
          fenetre.show();
          envoyer('etat', { texte: code === 0 ? '' : 'Le jeu s\'est fermé (code ' + code + '). Journal : ' + journal, part: 0, fini: true });
        }
      },
    });
    return { ok: true };
  } catch (e) {
    enJeu = false;
    try {
      flux.write('ERREUR : ' + JSON.stringify(e, Object.getOwnPropertyNames(e || {})) + '\n');
    } catch (x) {
      // rien
    }
    flux.end();
    return { erreur: texteErreur(e) };
  }
});

// ---------- Statut Discord ----------
async function lancerDiscord() {
  try {
    const m = await lireJson(cfg.MANIFESTE);
    discord.demarrer(m.discordApplication, { site: m.site || cfg.SITE, discord: m.discord || cfg.DISCORD, comptes: m.comptes || cfg.COMPTES });
    discord.launcher(compte.profil() && compte.profil().pseudo);
  } catch (e) {
    // pas de connexion : pas de statut
  }
}

// ---------- Mises à jour du launcher ----------
function verifierMisesAJour() {
  if (!app.isPackaged) return;
  const { autoUpdater } = require('electron-updater');
  autoUpdater.autoDownload = true;
  autoUpdater.on('update-available', (i) => envoyer('maj', { texte: `Mise à jour ${i.version} du launcher en cours de téléchargement…` }));
  autoUpdater.on('update-downloaded', (i) => {
    envoyer('maj', { texte: `Mise à jour ${i.version} prête : redémarrage…` });
    if (!enJeu) setTimeout(() => autoUpdater.quitAndInstall(false, true), 2500);
  });
  autoUpdater.on('error', (e) => console.error('Mise à jour', e));
  autoUpdater.checkForUpdates().catch(() => {});
}

// Une seule fenêtre du launcher à la fois
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (fenetre) {
      if (fenetre.isMinimized()) fenetre.restore();
      fenetre.show();
      fenetre.focus();
    }
  });
  app.whenReady().then(() => {
    app.setAppUserModelId('fr.onyxfight.launcher');
    creerFenetre();
    verifierMisesAJour();
    lancerDiscord();
  });
  app.on('window-all-closed', () => {
    if (!enJeu) {
      discord.arreter();
      app.quit();
    }
  });
}

process.on('uncaughtException', (e) => {
  console.error(e);
  if (fenetre) dialog.showErrorBox('OnyxFight Launcher', String((e && e.message) || e));
});
