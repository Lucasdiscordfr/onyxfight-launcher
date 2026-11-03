// Installation (Forge, mods du serveur) et lancement de Minecraft 1.7.10 avec le mod OnyxFight.
const fs = require('fs');
const path = require('path');
const { Client } = require('minecraft-launcher-core');
const cfg = require('./config');
const { lireJson, telecharger, bon } = require('./telechargement');
const { assurerJava } = require('./java');

/**
 * Manifeste (distribution/manifest.json du dépôt public) :
 * { "serveur": {"hote": "...", "port": 25565},
 *   "fichiers": [{"chemin": "mods/onyxfight.jar", "url": "...", "sha1": "...", "taille": 123}],
 *   "supprimer": ["mods/ancien.jar"] }
 * Les mods qui ne sont pas dans la liste sont retirés du dossier mods (pas de mods en plus sur le serveur).
 */
async function synchroniser(racine, etat) {
  etat('Recherche des mises à jour…', 0);
  const m = await lireJson(cfg.MANIFESTE);
  const fichiers = m.fichiers || [];
  const voulus = new Set();
  for (let i = 0; i < fichiers.length; i++) {
    const f = fichiers[i];
    const dest = path.join(racine, ...f.chemin.split('/'));
    voulus.add(path.normalize(dest));
    if (await bon(dest, f)) continue;
    const nom = path.basename(f.chemin);
    await telecharger(f.url, dest, (r, t) => etat(`Téléchargement : ${nom}`, t ? r / t : 0));
    if (!(await bon(dest, f))) throw new Error(`Fichier abîmé : ${nom}. Réessaie.`);
  }
  for (const s of m.supprimer || []) fs.rmSync(path.join(racine, ...s.split('/')), { force: true });
  // Le dossier mods ne contient que les mods du serveur
  const mods = path.join(racine, 'mods');
  if (fs.existsSync(mods)) {
    for (const e of fs.readdirSync(mods)) {
      const p = path.normalize(path.join(mods, e));
      if (e.endsWith('.jar') && !voulus.has(p)) fs.rmSync(p, { force: true });
    }
  }
  return m;
}

/**
 * options.txt : jeu en français par défaut, et pack de ressources « OnyxFight » (logo de l'écran de chargement)
 * toujours activé (le joueur garde ses autres packs).
 */
function premiersReglages(racine) {
  const f = path.join(racine, 'options.txt');
  fs.mkdirSync(racine, { recursive: true });
  let lignes = fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split(/\r?\n/).filter((l) => l.length) : ['lang:fr_FR', 'guiScale:2'];
  const i = lignes.findIndex((l) => l.startsWith('resourcePacks:'));
  let packs = [];
  if (i >= 0) {
    try {
      packs = JSON.parse(lignes[i].slice('resourcePacks:'.length));
    } catch (e) {
      packs = [];
    }
  }
  if (!packs.includes('OnyxFight.zip')) packs.push('OnyxFight.zip');
  const ligne = 'resourcePacks:' + JSON.stringify(packs);
  if (i >= 0) lignes[i] = ligne;
  else lignes.push(ligne);
  fs.writeFileSync(f, lignes.join('\n') + '\n');
}

/**
 * Écran du tout début (le logo Mojang, avant l'écran de chargement de Forge) : Minecraft le lit dans ses ressources
 * avant tout pack. On ajoute notre image dans une copie du .jar de Forge, qui est le premier sur le classpath : elle est
 * lue à la place de celle de Minecraft. Copie refaite seulement si l'image change.
 */
function forgeAvecEcran(racine, forge) {
  const image = path.join(racine, 'onyxfight', 'chargement-mojang.png');
  if (!fs.existsSync(image)) return forge;
  const copie = forge.replace(/\.jar$/, '-onyxfight.jar');
  const marque = copie + '.version';
  const empreinte = require('crypto').createHash('sha1').update(fs.readFileSync(image)).digest('hex');
  try {
    if (fs.existsSync(copie) && fs.existsSync(marque) && fs.readFileSync(marque, 'utf8') === empreinte) return copie;
    const AdmZip = require('adm-zip');
    const zip = new AdmZip(forge);
    zip.addFile('assets/minecraft/textures/gui/title/mojang.png', fs.readFileSync(image));
    zip.writeZip(copie);
    fs.writeFileSync(marque, empreinte);
    return copie;
  } catch (e) {
    return forge; // en cas de souci, l'écran Mojang normal
  }
}

/** Réglages lus par le menu du mod (adresse du serveur, site, Discord, saison, version du launcher). */
function reglagesClient(racine, manifeste, version) {
  const serveur = manifeste.serveur || cfg.SERVEUR;
  fs.writeFileSync(path.join(racine, 'onyxfight-client.json'), JSON.stringify({
    serveur: { hote: serveur.hote, port: serveur.port || 25565 },
    site: manifeste.site || cfg.SITE,
    discord: manifeste.discord || cfg.DISCORD,
    saison: manifeste.saison || '',
    version,
  }, null, 2));
}

/**
 * Lance le jeu. evenements : etat(texte, part), journal(ligne), lance(), ferme(code).
 */
async function jouer(reglages, autorisation, ev) {
  const racine = reglages.dossier || cfg.DOSSIER;
  fs.mkdirSync(racine, { recursive: true });
  const java = await assurerJava(racine, ev.etat);
  const manifeste = await synchroniser(racine, ev.etat);
  premiersReglages(racine);
  reglagesClient(racine, manifeste, reglages.versionLauncher || '');
  const forgeNom = `forge-${cfg.MINECRAFT}-${cfg.FORGE}-${cfg.MINECRAFT}-universal.jar`;
  const forge = path.join(racine, 'forge', forgeNom);
  if (!fs.existsSync(forge)) {
    const url = `https://maven.minecraftforge.net/net/minecraftforge/forge/${cfg.MINECRAFT}-${cfg.FORGE}-${cfg.MINECRAFT}/${forgeNom}`;
    await telecharger(url, forge, (r, t) => ev.etat('Téléchargement de Forge…', t ? r / t : 0));
  }
  const serveur = manifeste.serveur || cfg.SERVEUR;
  // Minecraft 1.7.10 plante si « --userProperties » n'a pas de valeur : il lui faut un texte JSON ('{}')
  if (typeof autorisation.user_properties !== 'string') {
    autorisation.user_properties = JSON.stringify(autorisation.user_properties || {});
  }
  const client = new Client();
  client.on('progress', (p) => {
    const quoi = { assets: 'ressources', natives: 'fichiers système', classes: 'bibliothèques', 'assets-copy': 'ressources', forge: 'Forge' }[p.type] || p.type;
    ev.etat(`Installation de Minecraft (${quoi})…`, p.total ? p.task / p.total : 0);
  });
  client.on('debug', (l) => ev.journal(String(l)));
  client.on('data', (l) => {
    const t = String(l);
    ev.journal(t);
    if (t.includes('LWJGL Version') || t.includes('Setting user:')) ev.lance();
  });
  client.on('close', (code) => ev.ferme(code));
  ev.etat('Lancement de Minecraft…', 1);
  const proc = await client.launch({
    authorization: autorisation,
    root: racine,
    version: { number: cfg.MINECRAFT, type: 'release' },
    forge: forgeOnyx,
    javaPath: java,
    memory: { max: `${reglages.ram || 4}G`, min: '1G' },
    window: { width: 1280, height: 720 },
    quickPlay: !reglages.connexionDirecte ? undefined : { type: 'legacy', identifier: `${serveur.hote}:${serveur.port || 25565}` },
    overrides: {
      detached: false,
      maxSockets: 8,
      url: { mavenForge: 'https://maven.minecraftforge.net/' },
    },
  });
  if (!proc) throw new Error("Minecraft n'a pas pu démarrer (voir le journal).");
  return proc;
}

module.exports = { jouer, synchroniser };
