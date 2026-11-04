// Java 8 (Minecraft 1.7.10 + Forge) ou 21 (Minecraft 1.21.1 + NeoForge) : téléchargé une fois depuis Adoptium (Temurin), rangé dans le
// dossier du launcher. Le joueur n'a rien à installer.
const fs = require('fs');
const path = require('path');
const { telecharger } = require('./telechargement');

function systeme() {
  const os = process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'mac' : 'linux';
  const arch = process.arch === 'arm64' ? 'aarch64' : process.arch === 'ia32' ? 'x32' : 'x64';
  return { os, arch };
}

function chercherJava(dossier) {
  const nom = process.platform === 'win32' ? 'javaw.exe' : 'java';
  if (!fs.existsSync(dossier)) return null;
  const pile = [dossier];
  while (pile.length) {
    const d = pile.pop();
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) pile.push(p);
      else if (e.name === nom && path.basename(d) === 'bin') return p;
    }
  }
  return null;
}

/** Chemin de java (javaw sous Windows), installé si besoin. etat(texte, part 0..1). version : 8 (1.7.10) ou 21 (1.21.1). */
async function assurerJava(racine, etat, version = 8) {
  const dossier = path.join(racine, 'java' + version);
  const deja = chercherJava(dossier);
  if (deja) return deja;
  const { os, arch } = systeme();
  // Sur Mac Apple Silicon il n'y a pas de Java 8 natif : la version Intel passe par Rosetta
  const a = version === 8 && os === 'mac' && arch === 'aarch64' ? 'x64' : arch;
  const url = `https://api.adoptium.net/v3/binary/latest/${version}/ga/${os}/${a}/jre/hotspot/normal/eclipse`;
  const archive = path.join(racine, os === 'windows' ? `java${version}.zip` : `java${version}.tar.gz`);
  etat(`Téléchargement de Java ${version}…`, 0);
  await telecharger(url, archive, (r, t) => etat(`Téléchargement de Java ${version}…`, t ? r / t : 0));
  etat(`Installation de Java ${version}…`, 1);
  fs.mkdirSync(dossier, { recursive: true });
  if (os === 'windows') {
    const extraire = require('extract-zip');
    await extraire(archive, { dir: dossier });
  } else {
    await new Promise((ok, ko) => {
      require('child_process').execFile('tar', ['-xzf', archive, '-C', dossier], (e) => (e ? ko(e) : ok()));
    });
  }
  fs.rmSync(archive, { force: true });
  const java = chercherJava(dossier);
  if (!java) throw new Error(`Java ${version} n'a pas pu être installé.`);
  if (process.platform !== 'win32') fs.chmodSync(java, 0o755);
  return java;
}

module.exports = { assurerJava };
