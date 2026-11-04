// Réglages fixes du launcher OnyxFight.
const path = require('path');
const os = require('os');

const DEPOT = 'Lucasdiscordfr/onyxfight-launcher';
const BRUT = `https://raw.githubusercontent.com/${DEPOT}/main/distribution`;

function dossierDonnees() {
  if (process.platform === 'win32') return path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), '.onyxfight');
  if (process.platform === 'darwin') return path.join(os.homedir(), 'Library', 'Application Support', 'onyxfight');
  return path.join(os.homedir(), '.onyxfight');
}

module.exports = {
  DEPOT,
  // Liste des fichiers à installer (mod, Forge…) et adresse du serveur
  MANIFESTE: `${BRUT}/manifest.json`,
  // Actualités affichées dans le launcher
  ACTUALITES: `${BRUT}/actualites.json`,
  MINECRAFT: '1.7.10',
  FORGE: '10.13.4.1614',
  // Adresse par défaut (remplacée par celle du manifeste)
  SERVEUR: { hote: 'play.onyxfight.fr', port: 25565 },
  DOSSIER: dossierDonnees(),
  // Service des comptes et site (remplacé par « comptes » du manifeste)
  COMPTES: 'https://play.onyxfight.fr',
  SITE: 'https://play.onyxfight.fr',
  DISCORD: 'https://discord.gg/onyxfight',
};
