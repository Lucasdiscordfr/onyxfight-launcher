// Minecraft 1.21.1 + NeoForge + mod OnyxFight 1.21.1 (serveur de test) : installation et lancement, sans rien à faire
// pour le joueur. Dossier de jeu à part (« 1.21.1 » dans le dossier du launcher) : rien n'est mélangé avec la 1.7.10.
const fs = require('fs');
const path = require('path');
const { spawn, execFile } = require('child_process');
const { lire, lireJson, telecharger, sha1, bon } = require('./telechargement');
const { assurerJava } = require('./java');
const cfg = require('./config');

const MC = '1.21.1';
const SYS = process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'osx' : 'linux';
const SEP = process.platform === 'win32' ? ';' : ':';

function lireFichier(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

/** Une règle de version (os, fonctions) s'applique-t-elle ici ? */
function permis(regles) {
  if (!regles || !regles.length) return true;
  let ok = false;
  for (const r of regles) {
    let correspond = true;
    if (r.os) {
      if (r.os.name && r.os.name !== SYS) correspond = false;
      if (r.os.arch && r.os.arch === 'x86' && process.arch !== 'ia32') correspond = false;
    }
    if (r.features) correspond = false; // démo, résolution, quickPlay : non
    if (correspond) ok = r.action === 'allow';
  }
  return ok;
}

/** Chemin Maven d'une bibliothèque (groupe:nom:version[:classifieur][@ext]). */
function cheminMaven(nom) {
  let ext = 'jar';
  if (nom.includes('@')) [nom, ext] = nom.split('@');
  const [g, a, v, c] = nom.split(':');
  return path.join(...g.split('.'), a, v, `${a}-${v}${c ? '-' + c : ''}.${ext}`);
}

/** Télécharge plusieurs fichiers en parallèle. liste : [{url, dest, sha1}] */
async function plusieurs(liste, etat, texte) {
  let fait = 0;
  const file = liste.slice();
  async function ouvrier() {
    while (file.length) {
      const f = file.shift();
      if (!(await bon(f.dest, { sha1: f.sha1 }))) {
        await telecharger(f.url, f.dest, null);
        if (f.sha1 && (await sha1(f.dest)) !== f.sha1) throw new Error('Fichier abîmé : ' + path.basename(f.dest) + '. Réessaie.');
      }
      fait++;
      if (fait % 20 === 0 || fait === liste.length) etat(texte, fait / liste.length);
    }
  }
  await Promise.all(Array.from({ length: 16 }, ouvrier));
}

/** Mods et fichiers de la 1.21.1 (manifeste : « v121 »: {"fichiers": [...]}) ; les mods en trop sont retirés. */
async function synchroniser(racine, v121, etat) {
  const voulus = new Set();
  for (const f of v121.fichiers || []) {
    const dest = path.join(racine, ...f.chemin.split('/'));
    voulus.add(path.normalize(dest));
    if (await bon(dest, f)) continue;
    await telecharger(f.url, dest, (r, t) => etat('Téléchargement : ' + path.basename(f.chemin), t ? r / t : 0));
    if (!(await bon(dest, f))) throw new Error('Fichier abîmé : ' + path.basename(f.chemin) + '. Réessaie.');
  }
  const mods = path.join(racine, 'mods');
  if (fs.existsSync(mods)) {
    for (const e of fs.readdirSync(mods)) {
      const p = path.normalize(path.join(mods, e));
      if (e.endsWith('.jar') && !voulus.has(p)) fs.rmSync(p, { force: true });
    }
  }
}

/** Minecraft 1.21.1 de base : sa description, son .jar. */
async function vanilla(racine, etat) {
  const dir = path.join(racine, 'versions', MC);
  const json = path.join(dir, MC + '.json');
  if (!fs.existsSync(json)) {
    etat('Préparation de Minecraft 1.21.1…', 0);
    const m = JSON.parse(await lire('https://piston-meta.mojang.com/mc/game/version_manifest_v2.json'));
    const v = m.versions.find((x) => x.id === MC);
    await telecharger(v.url, json, null);
  }
  const d = lireFichier(json);
  const jar = path.join(dir, MC + '.jar');
  if (!(await bon(jar, { sha1: d.downloads.client.sha1 }))) {
    await telecharger(d.downloads.client.url, jar, (r, t) => etat('Téléchargement de Minecraft 1.21.1…', t ? r / t : 0));
  }
  return d;
}

/** NeoForge (installeur officiel, sans fenêtre). */
async function neoforge(racine, java, version, etat) {
  const id = 'neoforge-' + version;
  const json = path.join(racine, 'versions', id, id + '.json');
  if (fs.existsSync(json)) return lireFichier(json);
  const inst = path.join(racine, 'neoforge-installer.jar');
  await telecharger(`https://maven.neoforged.net/releases/net/neoforged/neoforge/${version}/neoforge-${version}-installer.jar`, inst,
    (r, t) => etat('Téléchargement de NeoForge…', t ? r / t : 0));
  const profils = path.join(racine, 'launcher_profiles.json');
  if (!fs.existsSync(profils)) fs.writeFileSync(profils, JSON.stringify({ profiles: {} }));
  etat('Installation de NeoForge (une minute ou deux)…', 1);
  await new Promise((ok, ko) => {
    execFile(java.replace(/javaw(\.exe)?$/, 'java$1'), ['-jar', inst, '--installClient', racine], { cwd: racine, maxBuffer: 64 * 1024 * 1024 },
      (e, so, se) => (e ? ko(new Error("NeoForge n'a pas pu s'installer : " + (se || so || e.message).toString().slice(-400))) : ok()));
  });
  fs.rmSync(inst, { force: true });
  if (!fs.existsSync(json)) throw new Error("NeoForge n'a pas pu s'installer.");
  return lireFichier(json);
}

async function bibliotheques(racine, versions, etat) {
  const liste = [], chemins = [];
  const vus = new Set();
  for (const v of versions) {
    for (const lib of v.libraries || []) {
      if (!permis(lib.rules)) continue;
      const art = lib.downloads && lib.downloads.artifact;
      const rel = art && art.path ? art.path : cheminMaven(lib.name);
      const dest = path.join(racine, 'libraries', rel);
      const cle = lib.name.split(':').slice(0, 2).join(':') + ':' + (lib.name.split(':')[3] || '');
      if (vus.has(cle)) continue; // NeoForge passe en premier : sa version gagne
      vus.add(cle);
      chemins.push(dest);
      if (art && art.url) liste.push({ url: art.url, dest, sha1: art.sha1 });
      else if (!fs.existsSync(dest) && lib.url) liste.push({ url: lib.url.replace(/\/?$/, '/') + cheminMaven(lib.name).split(path.sep).join('/'), dest });
    }
  }
  await plusieurs(liste, etat, 'Installation de Minecraft (bibliothèques)…');
  return chemins;
}

async function ressources(racine, d, etat) {
  const index = path.join(racine, 'assets', 'indexes', d.assetIndex.id + '.json');
  if (!(await bon(index, { sha1: d.assetIndex.sha1 }))) await telecharger(d.assetIndex.url, index, null);
  const objets = lireFichier(index).objects;
  const liste = Object.values(objets).map((o) => ({
    url: `https://resources.download.minecraft.net/${o.hash.slice(0, 2)}/${o.hash}`,
    dest: path.join(racine, 'assets', 'objects', o.hash.slice(0, 2), o.hash),
    sha1: o.hash,
  })).filter((f) => !fs.existsSync(f.dest));
  if (liste.length) await plusieurs(liste, etat, 'Installation de Minecraft (ressources)…');
}

function arguments_(liste, vars) {
  const sortie = [];
  for (const a of liste || []) {
    if (typeof a === 'string') sortie.push(a);
    else if (permis(a.rules)) sortie.push(...(Array.isArray(a.value) ? a.value : [a.value]));
  }
  return sortie.map((s) => s.replace(/\$\{([a-z_]+)\}/g, (m, k) => (k in vars ? vars[k] : m)));
}

/** Lance le jeu 1.21.1. evenements : etat(texte, part), journal(ligne), lance(), ferme(code). */
async function jouer121(reglages, autorisation, v121, ev) {
  const racine = path.join(reglages.dossier || cfg.DOSSIER, MC);
  fs.mkdirSync(racine, { recursive: true });
  const java = await assurerJava(reglages.dossier || cfg.DOSSIER, ev.etat, 21);
  await synchroniser(racine, v121, ev.etat);
  const base = await vanilla(racine, ev.etat);
  const neo = await neoforge(racine, java, v121.neoforge || '21.1.192', ev.etat);
  const chemins = await bibliotheques(racine, [neo, base], ev.etat);
  await ressources(racine, base, ev.etat);
  const natifs = path.join(racine, 'natives');
  fs.mkdirSync(natifs, { recursive: true });
  // Le .jar du jeu porte le nom de la version NeoForge (NeoForge l'écarte de ses modules d'après ce nom)
  const jarJeu = path.join(racine, 'versions', neo.id, neo.id + '.jar');
  const jarBase = path.join(racine, 'versions', MC, MC + '.jar');
  if (!fs.existsSync(jarJeu) || fs.statSync(jarJeu).size !== fs.statSync(jarBase).size) fs.copyFileSync(jarBase, jarJeu);
  const classpath = chemins.concat([jarJeu]).join(SEP);
  const serveur = v121.serveur || { hote: 'play.onyxfight.fr', port: 25566 };
  const vars = {
    natives_directory: natifs, launcher_name: 'OnyxFight', launcher_version: reglages.versionLauncher || '1',
    classpath, classpath_separator: SEP, library_directory: path.join(racine, 'libraries'), version_name: neo.id,
    auth_player_name: autorisation.name, auth_uuid: autorisation.uuid, auth_access_token: autorisation.access_token,
    auth_xuid: (autorisation.meta && autorisation.meta.xuid) || '0', clientid: autorisation.client_token || '0',
    user_type: autorisation.meta && autorisation.meta.type === 'mojang' ? 'legacy' : 'msa', version_type: 'release',
    game_directory: racine, assets_root: path.join(racine, 'assets'), assets_index_name: base.assetIndex.id,
  };
  const jvm = [`-Xmx${reglages.ram || 4}G`, '-Xms1G', ...arguments_(base.arguments.jvm, vars), ...arguments_((neo.arguments || {}).jvm, vars)];
  const jeu = [...arguments_(base.arguments.game, vars), ...arguments_((neo.arguments || {}).game, vars), '--width', '1280', '--height', '720'];
  if (reglages.connexionDirecte) jeu.push('--quickPlayMultiplayer', `${serveur.hote}:${serveur.port || 25566}`);
  // Le jeu en français la première fois
  const options = path.join(racine, 'options.txt');
  if (!fs.existsSync(options)) fs.writeFileSync(options, 'lang:fr_fr\nguiScale:3\n');
  ev.etat('Lancement de Minecraft 1.21.1…', 1);
  ev.journal('Java : ' + java);
  const proc = spawn(java, [...jvm, neo.mainClass || base.mainClass, ...jeu], { cwd: racine });
  let lance = false;
  const lignes = (d) => {
    const t = String(d);
    ev.journal(t.replace(autorisation.access_token, '***'));
    if (!lance && /Setting user|LWJGL|Backend library/.test(t)) {
      lance = true;
      ev.lance();
    }
  };
  proc.stdout.on('data', lignes);
  proc.stderr.on('data', lignes);
  proc.on('close', (code) => ev.ferme(code));
  proc.on('error', (e) => {
    ev.journal('ERREUR : ' + e);
    ev.ferme(-1);
  });
  return proc;
}

module.exports = { jouer121 };
