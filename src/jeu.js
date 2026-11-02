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

/** options.txt : jeu en français par défaut (le joueur peut changer ensuite). */
function premiersReglages(racine) {
  const f = path.join(racine, 'options.txt');
  if (!fs.existsSync(f)) {
    fs.mkdirSync(racine, { recursive: true });
    fs.writeFileSync(f, 'lang:fr_FR\nguiScale:2\n');
  }
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
  const forgeNom = `forge-${cfg.MINECRAFT}-${cfg.FORGE}-${cfg.MINECRAFT}-universal.jar`;
  const forge = path.join(racine, 'forge', forgeNom);
  if (!fs.existsSync(forge)) {
    const url = `https://maven.minecraftforge.net/net/minecraftforge/forge/${cfg.MINECRAFT}-${cfg.FORGE}-${cfg.MINECRAFT}/${forgeNom}`;
    await telecharger(url, forge, (r, t) => ev.etat('Téléchargement de Forge…', t ? r / t : 0));
  }
  const serveur = manifeste.serveur || cfg.SERVEUR;
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
    forge,
    javaPath: java,
    memory: { max: `${reglages.ram || 4}G`, min: '1G' },
    window: { width: 1280, height: 720 },
    quickPlay: reglages.connexionDirecte === false ? undefined : { type: 'legacy', identifier: `${serveur.hote}:${serveur.port || 25565}` },
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
