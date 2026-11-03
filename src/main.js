// Processus principal du launcher OnyxFight : fenêtre, compte, réglages, lancement du jeu, mises à jour.
const { app, BrowserWindow, ipcMain, shell, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const cfg = require('./config');
const Compte = require('./compte');
const { jouer } = require('./jeu');
const { lireJson } = require('./telechargement');

let fenetre = null;
let enJeu = false;
const compte = new Compte(cfg.DOSSIER);
const fichierReglages = path.join(cfg.DOSSIER, 'launcher.json');

function reglages() {
  try {
    return Object.assign({ ram: 4, garderOuvert: false, connexionDirecte: true, dossier: cfg.DOSSIER },
      JSON.parse(fs.readFileSync(fichierReglages, 'utf8')));
  } catch (e) {
    return { ram: 4, garderOuvert: false, connexionDirecte: true, dossier: cfg.DOSSIER };
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
    const s = m.serveur || cfg.SERVEUR;
    const util = require('minecraft-server-util');
    const r = await util.status(s.hote, s.port || 25565, { timeout: 4000, enableSRV: true });
    return { enLigne: true, joueurs: r.players.online, max: r.players.max, adresse: s.hote };
  } catch (e) {
    return { enLigne: false };
  }
});

// ---------- Compte ----------
ipcMain.handle('compte:reprendre', async () => compte.reprendre());
ipcMain.handle('compte:connecter', async () => {
  try {
    return { profil: await compte.connecter() };
  } catch (e) {
    const msg = String(e && (e.message || e.ts || e) || '');
    if (/cancel|closed|error\.gui\.closed/i.test(msg)) return { annule: true };
    return { erreur: msg.includes('Minecraft') ? msg : 'Connexion impossible : ' + msg };
  }
});
ipcMain.handle('compte:deconnecter', async () => compte.deconnecter());

// ---------- Réglages ----------
ipcMain.handle('reglages:sauver', async (e, r) => {
  const actuel = reglages();
  const nouveau = Object.assign(actuel, {
    ram: Math.max(1, Math.min(32, parseInt(r.ram, 10) || 4)),
    garderOuvert: !!r.garderOuvert,
    connexionDirecte: r.connexionDirecte !== false,
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
  const r = reglages();
  const journal = path.join(r.dossier, 'launcher-dernier-lancement.log');
  fs.mkdirSync(r.dossier, { recursive: true });
  const flux = fs.createWriteStream(journal);
  flux.write(`OnyxFight Launcher ${app.getVersion()}\n`);
  try {
    const autorisation = await compte.pourJouer();
    await jouer(r, autorisation, {
      etat: (texte, part) => envoyer('etat', { texte, part }),
      journal: (l) => flux.write(l.endsWith('\n') ? l : l + '\n'),
      lance: () => {
        envoyer('etat', { texte: 'Bon jeu sur OnyxFight !', part: 1, lance: true });
        if (!r.garderOuvert && fenetre) fenetre.hide();
      },
      ferme: (code) => {
        enJeu = false;
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
    flux.end();
    return { erreur: String((e && e.message) || e) };
  }
});

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
  });
  app.on('window-all-closed', () => {
    if (!enJeu) app.quit();
  });
}

process.on('uncaughtException', (e) => {
  console.error(e);
  if (fenetre) dialog.showErrorBox('OnyxFight Launcher', String((e && e.message) || e));
});
