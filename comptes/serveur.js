#!/usr/bin/env node
// Comptes OnyxFight : inscription et connexion par pseudo + mot de passe (site et launcher), jetons de jeu vérifiés
// par le serveur Minecraft. Node 18+ sans aucune dépendance. Écoute en local (127.0.0.1) ; Caddy le met en HTTPS.
//
//   ONYX_PORT=8090 ONYX_DONNEES=/opt/onyxfight/comptes/donnees node serveur.js
//
// Mots de passe : jamais gardés, seulement leur empreinte scrypt (sel aléatoire par compte).
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = parseInt(process.env.ONYX_PORT || '8090', 10);
const DONNEES = process.env.ONYX_DONNEES || path.join(__dirname, 'donnees');
const SITE = process.env.ONYX_SITE || path.join(__dirname, 'site');
// Panneau de l'équipe, servi seulement à l'adresse moderation.… (pas sur le site public)
const SITE_MOD = process.env.ONYX_SITE_MOD || path.join(__dirname, 'site-moderation');
const HOTE_MOD = /^moderation\./i;
const FICHIER = path.join(DONNEES, 'comptes.json');
const IMAGES = path.join(DONNEES, 'images'); // skins et capes importés (nommés par UUID)
const JOUR = 24 * 3600 * 1000;
const DUREE_SESSION = 30 * JOUR; // connexion gardée par le launcher / le site
const DUREE_JEU = JOUR; // jeton donné au jeu à chaque lancement

fs.mkdirSync(DONNEES, { recursive: true, mode: 0o700 });
fs.mkdirSync(IMAGES, { recursive: true, mode: 0o700 });

// ---------- Données ----------
let d = { comptes: {}, sessions: {}, jeux: {} };
try {
  d = Object.assign(d, JSON.parse(fs.readFileSync(FICHIER, 'utf8')));
} catch (e) {
  if (e.code !== 'ENOENT') { console.error('comptes.json illisible :', e.message); process.exit(1); }
}
let aEcrire = false;
function sauver() {
  aEcrire = true;
}
setInterval(ecrire, 2000).unref();
function ecrire() {
  if (!aEcrire) return;
  aEcrire = false;
  const tmp = FICHIER + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(d), { mode: 0o600 });
  fs.renameSync(tmp, FICHIER);
}
for (const s of ['SIGINT', 'SIGTERM']) process.on(s, () => { ecrire(); process.exit(0); });

// Ménage des jetons expirés (toutes les heures)
setInterval(() => {
  const t = Date.now();
  for (const table of [d.sessions, d.jeux]) for (const k of Object.keys(table)) if (table[k].exp < t) delete table[k];
  sauver();
}, 3600 * 1000).unref();

// ---------- Outils ----------
function uuidHorsLigne(pseudo) {
  const h = crypto.createHash('md5').update('OfflinePlayer:' + pseudo, 'utf8').digest();
  h[6] = (h[6] & 0x0f) | 0x30;
  h[8] = (h[8] & 0x3f) | 0x80;
  const x = h.toString('hex');
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20)}`;
}
function empreinte(mdp, sel) {
  return crypto.scryptSync(mdp, Buffer.from(sel, 'hex'), 64, { N: 16384, r: 8, p: 1 }).toString('hex');
}
function egal(a, b) {
  const x = Buffer.from(a, 'hex'), y = Buffer.from(b, 'hex');
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}
function jeton() {
  return crypto.randomBytes(32).toString('hex');
}
const PSEUDO = /^[A-Za-z0-9_]{3,16}$/;
const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,24}$/;
/** Questions secrètes (pour récupérer son compte). */
const QUESTIONS = {
  animal: 'Le nom de ton premier animal de compagnie ?',
  ville: 'La ville où tu es né(e) ?',
  ecole: 'Le nom de ta première école ?',
  plat: 'Ton plat préféré quand tu étais petit(e) ?',
  ami: "Le prénom de ton meilleur ami d'enfance ?",
  jeu: 'Ton tout premier jeu vidéo ?',
};
/** Réponse comparée sans majuscules, accents ni espaces en trop. */
function normaliser(r) {
  return String(r || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}
function masquerEmail(e) {
  if (!e) return null;
  const [a, b] = e.split('@');
  return (a.length <= 2 ? a[0] + '*' : a.slice(0, 2) + '*'.repeat(Math.min(6, a.length - 2))) + '@' + b;
}
/** Largeur et hauteur d'un PNG (ou null si ce n'en est pas un). */
function taillePng(buf) {
  if (buf.length < 24 || buf.readUInt32BE(0) !== 0x89504e47 || buf.readUInt32BE(4) !== 0x0d0a1a0a || buf.toString('ascii', 12, 16) !== 'IHDR') return null;
  return { l: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}
const INTERDITS = /^(admin|administrateur|moderateur|modo|staff|onyxfight|console|serveur|server|owner|fondateur)$/i;

// Limite d'essais par adresse (contre les essais de mots de passe en boucle)
const essais = new Map();
function trop(ip, quoi, max, minutes) {
  const k = quoi + ':' + ip, t = Date.now();
  const l = (essais.get(k) || []).filter((x) => t - x < minutes * 60000);
  l.push(t);
  essais.set(k, l);
  return l.length > max;
}
setInterval(() => essais.clear(), 3600 * 1000).unref();

function session(s) {
  const x = typeof s === 'string' && d.sessions[s];
  if (!x || x.exp < Date.now()) return null;
  return d.comptes[x.cle] || null;
}
function fiche(c) {
  return { pseudo: c.pseudo, uuid: c.uuid, cree: c.cree };
}
/** Tout ce que la page « Mon compte » affiche. */
function ficheComplete(c) {
  return {
    ...fiche(c),
    email: masquerEmail(c.email),
    question: c.question ? QUESTIONS[c.question] : null,
    recuperable: !!(c.email && c.reponseHash),
    skin: c.skin ? { modele: c.skin.modele, version: c.skin.version } : null,
    cape: c.cape ? { version: c.cape.version } : null,
    capePermise: !!(c.jeu && c.jeu.cape),
    jeu: c.jeu || null,
    derniereConnexion: c.derniereConnexion || null,
    connexions: c.connexions || 0,
  };
}

/** Inscriptions fermées tant que le fichier « inscriptions-fermees » existe dans le dossier des données. */
function inscriptionsOuvertes() {
  return !fs.existsSync(path.join(DONNEES, 'inscriptions-fermees'));
}

// ---------- API ----------
const ROUTES = {
  'GET /api/etat': () => [200, { inscriptions: inscriptionsOuvertes() }],

  'POST /api/inscription': (b, ip) => {
    if (!inscriptionsOuvertes()) return [403, { erreur: 'Les inscriptions sont fermées pour le moment. Suis le Discord pour leur ouverture !' }];
    if (trop(ip, 'inscription', 5, 60)) return [429, { erreur: 'Trop de comptes créés depuis ta connexion. Réessaie plus tard.' }];
    const pseudo = String(b.pseudo || '').trim(), mdp = String(b.motdepasse || '');
    if (!PSEUDO.test(pseudo)) return [400, { erreur: 'Pseudo : 3 à 16 lettres, chiffres ou _ (sans espace ni accent).' }];
    if (INTERDITS.test(pseudo)) return [400, { erreur: 'Ce pseudo est réservé.' }];
    if (mdp.length < 8 || mdp.length > 128) return [400, { erreur: 'Mot de passe : 8 caractères au minimum.' }];
    if (mdp.toLowerCase().includes(pseudo.toLowerCase())) return [400, { erreur: 'Le mot de passe ne doit pas contenir ton pseudo.' }];
    const email = String(b.email || '').trim().toLowerCase();
    if (!EMAIL.test(email)) return [400, { erreur: 'Adresse e-mail invalide.' }];
    if (!QUESTIONS[b.question]) return [400, { erreur: 'Choisis une question secrète.' }];
    const reponse = normaliser(b.reponse);
    if (reponse.length < 2 || reponse.length > 64) return [400, { erreur: 'Réponse à la question secrète : 2 caractères au minimum.' }];
    const cle = pseudo.toLowerCase();
    if (d.comptes[cle]) return [409, { erreur: 'Ce pseudo est déjà pris.' }];
    const sel = crypto.randomBytes(16).toString('hex'), selR = crypto.randomBytes(16).toString('hex');
    d.comptes[cle] = { pseudo, uuid: uuidHorsLigne(pseudo), sel, hash: empreinte(mdp, sel), cree: Date.now(),
      email, question: b.question, reponseSel: selR, reponseHash: empreinte(reponse, selR) };
    const s = jeton();
    d.sessions[s] = { cle, exp: Date.now() + DUREE_SESSION };
    sauver();
    console.log('Nouveau compte :', pseudo);
    return [200, { session: s, ...fiche(d.comptes[cle]) }];
  },

  'POST /api/connexion': (b, ip) => {
    if (trop(ip, 'connexion', 10, 15)) return [429, { erreur: 'Trop d\'essais. Attends 15 minutes.' }];
    const c = d.comptes[String(b.pseudo || '').trim().toLowerCase()];
    const mdp = String(b.motdepasse || '');
    // Même calcul que le compte existe ou non (on ne dit pas lequel des deux est faux)
    const h = empreinte(mdp, c ? c.sel : '00000000000000000000000000000000');
    if (!c || !egal(h, c.hash)) return [401, { erreur: 'Pseudo ou mot de passe incorrect.' }];
    const s = jeton();
    d.sessions[s] = { cle: c.pseudo.toLowerCase(), exp: Date.now() + DUREE_SESSION };
    sauver();
    return [200, { session: s, ...fiche(c) }];
  },

  'POST /api/session': (b) => {
    const c = session(b.session);
    return c ? [200, fiche(c)] : [401, { erreur: 'Connexion expirée : reconnecte-toi.' }];
  },

  /** Jeton donné au jeu (le launcher le passe comme « jeton d'accès ») : le serveur Minecraft le vérifie. */
  'POST /api/jeu': (b) => {
    const c = session(b.session);
    if (!c) return [401, { erreur: 'Connexion expirée : reconnecte-toi.' }];
    const j = jeton();
    d.jeux[j] = { cle: c.pseudo.toLowerCase(), exp: Date.now() + DUREE_JEU };
    sauver();
    return [200, { jeton: j, ...fiche(c) }];
  },

  'POST /api/deconnexion': (b) => {
    if (typeof b.session === 'string' && d.sessions[b.session]) {
      delete d.sessions[b.session];
      sauver();
    }
    return [200, { ok: true }];
  },

  'GET /api/questions': () => [200, QUESTIONS],

  /** Mot de passe oublié : pseudo + e-mail + réponse à la question secrète → nouveau mot de passe. */
  'POST /api/question': (b, ip) => {
    if (trop(ip, 'recuperation', 20, 60)) return [429, { erreur: 'Trop d\'essais. Réessaie dans une heure.' }];
    const c = d.comptes[String(b.pseudo || '').trim().toLowerCase()];
    // Même réponse que le compte existe ou non
    return [200, { question: c && c.question ? QUESTIONS[c.question] : QUESTIONS.animal }];
  },
  'POST /api/recuperer': (b, ip) => {
    if (trop(ip, 'recuperation', 20, 60)) return [429, { erreur: 'Trop d\'essais. Réessaie dans une heure.' }];
    const cle = String(b.pseudo || '').trim().toLowerCase(), c = d.comptes[cle];
    if (c && trop(cle, 'recuperation-compte', 5, 60)) return [429, { erreur: 'Trop d\'essais pour ce compte. Réessaie dans une heure.' }];
    const email = String(b.email || '').trim().toLowerCase();
    const h = empreinte(normaliser(b.reponse), c && c.reponseSel ? c.reponseSel : '00000000000000000000000000000000');
    if (!c || !c.reponseHash || c.email !== email || !egal(h, c.reponseHash)) {
      return [401, { erreur: 'Ces informations ne correspondent pas à un compte.' }];
    }
    const mdp = String(b.nouveau || '');
    if (mdp.length < 8 || mdp.length > 128) return [400, { erreur: 'Nouveau mot de passe : 8 caractères au minimum.' }];
    c.sel = crypto.randomBytes(16).toString('hex');
    c.hash = empreinte(mdp, c.sel);
    for (const table of [d.sessions, d.jeux]) for (const k of Object.keys(table)) if (table[k].cle === cle) delete table[k];
    const s2 = jeton();
    d.sessions[s2] = { cle, exp: Date.now() + DUREE_SESSION };
    sauver();
    console.log('Compte récupéré :', c.pseudo);
    return [200, { session: s2, ...fiche(c) }];
  },

  'POST /api/profil': (b) => {
    const c = session(b.session);
    return c ? [200, ficheComplete(c)] : [401, { erreur: 'Connexion expirée : reconnecte-toi.' }];
  },

  /** E-mail et question secrète (le mot de passe actuel est demandé). */
  'POST /api/securite': (b, ip) => {
    if (trop(ip, 'connexion', 10, 15)) return [429, { erreur: 'Trop d\'essais. Attends 15 minutes.' }];
    const c = session(b.session);
    if (!c) return [401, { erreur: 'Connexion expirée : reconnecte-toi.' }];
    if (!egal(empreinte(String(b.motdepasse || ''), c.sel), c.hash)) return [401, { erreur: 'Mot de passe incorrect.' }];
    const email = String(b.email || '').trim().toLowerCase();
    if (!EMAIL.test(email)) return [400, { erreur: 'Adresse e-mail invalide.' }];
    if (!QUESTIONS[b.question]) return [400, { erreur: 'Choisis une question secrète.' }];
    const reponse = normaliser(b.reponse);
    if (reponse.length < 2 || reponse.length > 64) return [400, { erreur: 'Réponse : 2 caractères au minimum.' }];
    c.email = email;
    c.question = b.question;
    c.reponseSel = crypto.randomBytes(16).toString('hex');
    c.reponseHash = empreinte(reponse, c.reponseSel);
    sauver();
    return [200, ficheComplete(c)];
  },

  /** Skin importé : PNG 64×64, modèle « classic » (bras larges) ou « slim » (bras fins). */
  'POST /api/skin': (b) => {
    const c = session(b.session);
    if (!c) return [401, { erreur: 'Connexion expirée : reconnecte-toi.' }];
    if (b.supprimer) {
      fs.rmSync(path.join(IMAGES, c.uuid + '-skin.png'), { force: true });
      delete c.skin;
      sauver();
      return [200, ficheComplete(c)];
    }
    const img = Buffer.from(String(b.image || ''), 'base64');
    const t = taillePng(img);
    if (!t) return [400, { erreur: 'Le skin doit être une image PNG.' }];
    if (t.l !== 64 || t.h !== 64) return [400, { erreur: `Le skin doit faire 64 × 64 pixels (le tien fait ${t.l} × ${t.h}).` }];
    if (img.length > 64 * 1024) return [400, { erreur: 'Image trop lourde (64 Ko au maximum).' }];
    fs.writeFileSync(path.join(IMAGES, c.uuid + '-skin.png'), img, { mode: 0o600 });
    c.skin = { modele: b.modele === 'slim' ? 'slim' : 'classic', version: Date.now() };
    sauver();
    return [200, ficheComplete(c)];
  },

  /** Cape importée (réservée au plus haut grade) : PNG au format des capes, 64×32 jusqu'à 1024×512. */
  'POST /api/cape': (b) => {
    const c = session(b.session);
    if (!c) return [401, { erreur: 'Connexion expirée : reconnecte-toi.' }];
    if (b.supprimer) {
      fs.rmSync(path.join(IMAGES, c.uuid + '-cape.png'), { force: true });
      delete c.cape;
      sauver();
      return [200, ficheComplete(c)];
    }
    if (!(c.jeu && c.jeu.cape)) return [403, { erreur: 'Importer une cape est réservé au plus haut grade.' }];
    const img = Buffer.from(String(b.image || ''), 'base64');
    const t = taillePng(img);
    if (!t) return [400, { erreur: 'La cape doit être une image PNG.' }];
    if (![64, 128, 256, 512, 1024].includes(t.l) || t.h * 2 !== t.l) {
      return [400, { erreur: `La cape doit faire 64 × 32 pixels (ou 128 × 64… jusqu'à 1024 × 512). La tienne fait ${t.l} × ${t.h}.` }];
    }
    if (img.length > 400 * 1024) return [400, { erreur: 'Image trop lourde (400 Ko au maximum).' }];
    fs.writeFileSync(path.join(IMAGES, c.uuid + '-cape.png'), img, { mode: 0o600 });
    c.cape = { version: Date.now() };
    sauver();
    return [200, ficheComplete(c)];
  },

  'POST /api/motdepasse': (b, ip) => {
    if (trop(ip, 'connexion', 10, 15)) return [429, { erreur: 'Trop d\'essais. Attends 15 minutes.' }];
    const c = session(b.session);
    if (!c) return [401, { erreur: 'Connexion expirée : reconnecte-toi.' }];
    if (!egal(empreinte(String(b.ancien || ''), c.sel), c.hash)) return [401, { erreur: 'Ancien mot de passe incorrect.' }];
    const mdp = String(b.nouveau || '');
    if (mdp.length < 8 || mdp.length > 128) return [400, { erreur: 'Mot de passe : 8 caractères au minimum.' }];
    c.sel = crypto.randomBytes(16).toString('hex');
    c.hash = empreinte(mdp, c.sel);
    // Toutes les autres connexions et les jeux lancés sont coupés
    const cle = c.pseudo.toLowerCase();
    for (const table of [d.sessions, d.jeux]) for (const k of Object.keys(table)) if (table[k].cle === cle && k !== b.session) delete table[k];
    sauver();
    return [200, { ok: true }];
  },
};

/** Vérification par le serveur Minecraft (seulement depuis la machine elle-même). */
function verifier(q) {
  const j = d.jeux[q.get('jeton') || ''];
  if (!j || j.exp < Date.now()) return [200, { ok: false }];
  const c = d.comptes[j.cle];
  if (!c || c.pseudo.toLowerCase() !== String(q.get('pseudo') || '').toLowerCase()) return [200, { ok: false }];
  c.derniereConnexion = Date.now();
  c.connexions = (c.connexions || 0) + 1;
  sauver();
  return [200, { ok: true, pseudo: c.pseudo, uuid: c.uuid }];
}

/** Profils de jeu envoyés par le plugin (grade, argent, faction…) : seulement depuis la machine. */
function profilsJeu(b) {
  const liste = Array.isArray(b.joueurs) ? b.joueurs.slice(0, 500) : [];
  let n = 0;
  for (const j of liste) {
    const c = d.comptes[String(j.pseudo || '').toLowerCase()];
    if (!c) continue;
    c.jeu = {
      grade: String(j.grade || 'Joueur').slice(0, 40),
      cape: !!j.cape,
      argent: Number(j.argent) || 0,
      faction: j.faction ? String(j.faction).slice(0, 40) : null,
      kills: parseInt(j.kills, 10) || 0,
      morts: parseInt(j.morts, 10) || 0,
      puissance: Number(j.puissance) || 0,
      maj: Date.now(),
    };
    n++;
  }
  if (n) sauver();
  return [200, { ok: true, n }];
}

/** Apparence d'un joueur pour les jeux (skin et cape importés), par pseudo ou UUID. */
function apparence(qui) {
  const k = String(qui || '').toLowerCase();
  let c = d.comptes[k];
  if (!c) c = Object.values(d.comptes).find((x) => x.uuid === k);
  if (!c) return [404, { erreur: 'Inconnu' }];
  return [200, {
    pseudo: c.pseudo,
    skin: c.skin ? { url: `/skins/${c.uuid}.png?v=${c.skin.version}`, modele: c.skin.modele } : null,
    cape: c.cape && c.jeu && c.jeu.cape ? { url: `/capes/${c.uuid}.png?v=${c.cape.version}` } : null,
  }];
}


// =====================================================================================================================
// Jeu ↔ site : modération (rôles, journal, file d'actions pour le plugin, console), classements, boutique, votes
// =====================================================================================================================
const CONFIG = path.join(DONNEES, 'config.json');
function config() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG, 'utf8'));
  } catch (e) {
    return {};
  }
}
if (!d.journal) d.journal = [];

/** Rôles : joueur (0), moderateur (1), admin (2), createur (3). */
const ROLES = { joueur: 0, moderateur: 1, admin: 2, createur: 3 };
const NOMS_ROLES = { joueur: 'Joueur', moderateur: 'Modérateur', admin: 'Administrateur', createur: 'Créateur' };
function niveau(c) {
  return ROLES[c && c.role] || 0;
}
/** Compte connecté avec au moins ce niveau, sinon la réponse d'erreur. */
function equipe(b, min) {
  const c = session(b.session);
  if (!c) return [null, [401, { erreur: 'Connexion expirée : reconnecte-toi.' }]];
  if (niveau(c) < min) return [null, [403, { erreur: 'Tu n\'as pas accès à cette partie.' }]];
  return [c, null];
}
function noter(par, action, details) {
  d.journal.push({ t: Date.now(), par, action, details: String(details || '').slice(0, 500) });
  if (d.journal.length > 3000) d.journal.splice(0, d.journal.length - 3000);
  sauver();
}

// État envoyé par le plugin (en mémoire : il le renvoie tout seul après un redémarrage)
const jeu = { enLigne: [], max: 0, tps: -1, majEnLigne: 0, classements: {}, factions: [], casiers: [], majDonnees: 0 };
const console_ = { lignes: [], seq: 0 };
const file = []; // actions en attente pour le plugin
const resultats = new Map(); // id → { ok, message, t }

/** Qui peut faire quoi. */
function niveauAction(a) {
  switch (a.type) {
    case 'sanction':
      return a.sanction === 'ban' && !(Sanctions_duree(a.duree) > 0 && Sanctions_duree(a.duree) <= 7 * 86400000) ? 2 : 1;
    case 'lever':
      return a.sanction === 'ban' ? 2 : 1;
    case 'inventaire':
      return 1;
    case 'joueur':
      return a.action === 'vider' ? 2 : 1;
    case 'annonce':
    case 'faction':
    case 'evenement':
      return 2;
    case 'argent':
    case 'giveall':
    case 'commande':
      return 3;
    default:
      return 99;
  }
}
function Sanctions_duree(t) {
  const m = /^(\d{1,4})(m|min|h|j|d|s|sem)$/.exec(String(t || '').toLowerCase());
  if (!m) return 0;
  const n = parseInt(m[1], 10);
  return n * ({ m: 60e3, min: 60e3, h: 3600e3, j: 86400e3, d: 86400e3, s: 7 * 86400e3, sem: 7 * 86400e3 }[m[2]]);
}
/** Événements lancés depuis le site (commandes connues du serveur, rien d'autre). */
const EVENEMENTS = {
  boss: 'gouffre invoquer', largage: 'largage lancer', koth: 'koth lancer',
  tornade: 'evenement lancer tornade maintenant', meteorites: 'evenement lancer meteorites maintenant',
  eruption: 'evenement lancer eruption maintenant', seisme: 'evenement lancer seisme maintenant',
  grele: 'evenement lancer grele maintenant', tempete: 'evenement lancer tempete maintenant',
  lunedesang: 'evenement lancer lunedesang maintenant', arreter: 'evenement arreter', retirerboss: 'gouffre retirer',
};
const PSEUDO_JEU = /^[A-Za-z0-9_]{1,16}$/;
/** Vérifie et nettoie une action venue du site. */
function nettoyer(a) {
  const x = { type: String(a.type || '') };
  const t = (k, max) => String(a[k] == null ? '' : a[k]).slice(0, max);
  switch (x.type) {
    case 'sanction':
      x.sanction = t('sanction', 8);
      if (!['ban', 'mute', 'warn', 'kick'].includes(x.sanction)) return null;
      x.pseudo = t('pseudo', 16);
      x.duree = t('duree', 8);
      x.raison = t('raison', 200);
      if (x.duree && !Sanctions_duree(x.duree)) return null;
      break;
    case 'lever':
      x.sanction = t('sanction', 8);
      if (!['ban', 'mute'].includes(x.sanction)) return null;
      x.pseudo = t('pseudo', 16);
      break;
    case 'annonce':
      x.texte = t('texte', 300).replace(/§/g, '');
      if (!x.texte.trim()) return null;
      break;
    case 'giveall':
      x.objet = t('objet', 64);
      x.quantite = Math.max(1, Math.min(2304, parseInt(a.quantite, 10) || 1));
      if (!/^[a-z0-9_:]+$/i.test(x.objet)) return null;
      break;
    case 'argent':
      x.pseudo = t('pseudo', 16);
      x.mode = ['donner', 'retirer', 'definir'].includes(a.mode) ? a.mode : null;
      x.montant = Number(a.montant);
      if (!x.mode || !isFinite(x.montant) || x.montant < 0 || x.montant > 1e12) return null;
      break;
    case 'faction':
      x.action = ['dissoudre', 'renommer', 'expulser', 'banque'].includes(a.action) ? a.action : null;
      x.id = t('id', 64);
      x.valeur = t('valeur', 32);
      if (!x.action) return null;
      break;
    case 'inventaire':
      x.pseudo = t('pseudo', 16);
      break;
    case 'joueur':
      x.pseudo = t('pseudo', 16);
      x.action = ['soigner', 'spawn', 'vider', 'message'].includes(a.action) ? a.action : null;
      x.valeur = t('valeur', 200).replace(/§/g, '');
      if (!x.action) return null;
      break;
    case 'evenement':
      if (!EVENEMENTS[a.nom]) return null;
      return { type: 'commande', commande: EVENEMENTS[a.nom], nomEvenement: a.nom };
    case 'commande':
      x.commande = t('commande', 300).replace(/^\//, '');
      if (!x.commande.trim()) return null;
      break;
    default:
      return null;
  }
  if (x.pseudo !== undefined && !PSEUDO_JEU.test(x.pseudo)) return null;
  return x;
}

Object.assign(ROUTES, {
  // ---------- Public ----------
  'GET /api/statut': () => [200, { enLigne: Date.now() - jeu.majEnLigne < 30000, joueurs: jeu.enLigne.length, max: jeu.max }],
  'GET /api/classements': () => [200, { classements: jeu.classements, maj: jeu.majDonnees }],
  'GET /api/votes': () => [200, { sites: Array.isArray(config().votes) ? config().votes : [] }],

  'GET /api/boutique': async () => {
    const token = config().tebex;
    if (!token) return [200, { ouverte: false }];
    if (cacheBoutique && Date.now() - cacheBoutique.t < 300000) return [200, cacheBoutique.r];
    try {
      const r = await fetch(`https://headless.tebex.io/api/accounts/${encodeURIComponent(token)}/categories?includePackages=1`,
        { signal: AbortSignal.timeout(8000) });
      const j = await r.json();
      const categories = (j.data || []).map((c) => ({
        nom: c.name, description: c.description || '',
        produits: (c.packages || []).map((p) => ({ id: p.id, nom: p.name, description: p.description || '', prix: p.total_price ?? p.base_price,
          devise: p.currency, image: p.image || null })),
      }));
      cacheBoutique = { t: Date.now(), r: { ouverte: true, categories } };
      return [200, cacheBoutique.r];
    } catch (e) {
      return [502, { erreur: 'La boutique ne répond pas pour le moment.' }];
    }
  },

  /** Panier Tebex au nom du joueur connecté, puis lien de paiement. */
  'POST /api/boutique/panier': async (b) => {
    const c = session(b.session);
    if (!c) return [401, { erreur: 'Connecte-toi pour acheter (l\'achat arrive sur ton compte en jeu).' }];
    const token = config().tebex;
    if (!token) return [400, { erreur: 'La boutique n\'est pas encore ouverte.' }];
    const id = parseInt(b.produit, 10);
    if (!id) return [400, { erreur: 'Produit inconnu.' }];
    const site = String(config().adresse || 'https://play.onyxfight.fr').replace(/\/+$/, '');
    try {
      const r1 = await fetch(`https://headless.tebex.io/api/accounts/${encodeURIComponent(token)}/baskets`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(8000),
        body: JSON.stringify({ complete_url: site + '/boutique?merci=1', cancel_url: site + '/boutique', complete_auto_redirect: true,
          username: c.pseudo, custom: { pseudo: c.pseudo, uuid: c.uuid } }),
      });
      const p1 = await r1.json();
      const ident = p1.data && p1.data.ident;
      if (!ident) return [502, { erreur: (p1 && (p1.detail || p1.message)) || 'Tebex refuse le panier.' }];
      const r2 = await fetch(`https://headless.tebex.io/api/baskets/${ident}/packages`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(8000),
        body: JSON.stringify({ package_id: id, quantity: 1 }),
      });
      const p2 = await r2.json();
      const lien = (p2.data && p2.data.links && p2.data.links.checkout) || (p1.data.links && p1.data.links.checkout);
      if (!lien) return [502, { erreur: (p2 && (p2.detail || p2.message)) || 'Tebex refuse ce produit.' }];
      return [200, { lien }];
    } catch (e) {
      return [502, { erreur: 'La boutique ne répond pas pour le moment.' }];
    }
  },

  // ---------- Équipe ----------
  'POST /api/mod/moi': (b) => {
    const c = session(b.session);
    if (!c) return [401, { erreur: 'Connexion expirée : reconnecte-toi.' }];
    return [200, { pseudo: c.pseudo, role: c.role || 'joueur', nomRole: NOMS_ROLES[c.role || 'joueur'], niveau: niveau(c) }];
  },

  'POST /api/mod/etat': (b) => {
    const [, err] = equipe(b, 1);
    if (err) return err;
    return [200, { enLigne: jeu.enLigne, max: jeu.max, tps: jeu.tps, connecte: Date.now() - jeu.majEnLigne < 30000,
      comptes: Object.keys(d.comptes).length, inscriptions: inscriptionsOuvertes() }];
  },

  /** Fiche d'un joueur : compte du site, infos de jeu, casier, position s'il est connecté. */
  'POST /api/mod/joueur': (b) => {
    const [, err] = equipe(b, 1);
    if (err) return err;
    const p = String(b.pseudo || '').trim().toLowerCase();
    if (!p) return [400, { erreur: 'Donne un pseudo.' }];
    const c = d.comptes[p];
    const cas = jeu.casiers.find((x) => x.pseudo.toLowerCase() === p);
    const ligne = jeu.enLigne.find((x) => x.pseudo.toLowerCase() === p);
    if (!c && !cas && !ligne) return [404, { erreur: 'Joueur inconnu.' }];
    return [200, {
      pseudo: (c && c.pseudo) || (ligne && ligne.pseudo) || (cas && cas.pseudo),
      compte: c ? { cree: c.cree, role: NOMS_ROLES[c.role || 'joueur'], email: masquerEmail(c.email), derniereConnexion: c.derniereConnexion || null,
        connexions: c.connexions || 0, jeu: c.jeu || null, skin: !!c.skin } : null,
      enLigne: ligne || null,
      casier: cas ? cas.sanctions : [],
    }];
  },

  'POST /api/mod/joueurs': (b) => {
    const [, err] = equipe(b, 1);
    if (err) return err;
    const q = String(b.recherche || '').toLowerCase();
    const noms = new Map();
    for (const c of Object.values(d.comptes)) noms.set(c.pseudo.toLowerCase(), c.pseudo);
    for (const c of jeu.casiers) noms.set(c.pseudo.toLowerCase(), c.pseudo);
    const liste = [...noms.values()].filter((n) => n.toLowerCase().includes(q)).sort().slice(0, 50).map((n) => {
      const cas = jeu.casiers.find((x) => x.pseudo.toLowerCase() === n.toLowerCase());
      return { pseudo: n, enLigne: jeu.enLigne.some((x) => x.pseudo === n), sanctions: cas ? cas.sanctions.length : 0 };
    });
    return [200, { joueurs: liste }];
  },

  'POST /api/mod/factions': (b) => {
    const [, err] = equipe(b, 2);
    if (err) return err;
    return [200, { factions: jeu.factions, maj: jeu.majDonnees }];
  },

  'POST /api/mod/console': (b) => {
    const [, err] = equipe(b, 2);
    if (err) return err;
    const depuis = parseInt(b.depuis, 10) || 0;
    const debut = console_.seq - console_.lignes.length;
    const de = Math.max(0, depuis - debut);
    return [200, { seq: console_.seq, lignes: console_.lignes.slice(de) }];
  },

  /** Une action pour le serveur (mise en file ; le plugin la fait dans la seconde). */
  'POST /api/mod/action': (b) => {
    const c = session(b.session);
    if (!c) return [401, { erreur: 'Connexion expirée : reconnecte-toi.' }];
    const a = nettoyer(b.action || {});
    if (!a) return [400, { erreur: 'Action incomplète ou invalide.' }];
    const min = a.nomEvenement ? 2 : niveauAction(a);
    if (niveau(c) < min) return [403, { erreur: 'Ton rôle ne permet pas cette action.' }];
    if (Date.now() - jeu.majEnLigne > 30000) return [503, { erreur: 'Le serveur de jeu ne répond pas (éteint ou en redémarrage).' }];
    a.id = jeton().slice(0, 16);
    a.par = c.pseudo;
    a.cree = Date.now();
    delete a.nomEvenement;
    file.push(a);
    const { id, par, cree, ...details } = a;
    noter(c.pseudo, a.type, JSON.stringify(details));
    return [200, { id: a.id }];
  },

  'POST /api/mod/resultat': (b) => {
    const [, err] = equipe(b, 1);
    if (err) return err;
    const r = resultats.get(String(b.id || ''));
    if (r) return [200, r];
    const attente = file.find((x) => x.id === b.id);
    return [200, { attente: true, perdu: !attente && !r }];
  },

  'POST /api/mod/journal': (b) => {
    const [, err] = equipe(b, 2);
    if (err) return err;
    return [200, { journal: d.journal.slice(-300).reverse() }];
  },

  'POST /api/mod/roles': (b) => {
    const [c, err] = equipe(b, 3);
    if (err) return err;
    if (b.pseudo) {
      const cible = d.comptes[String(b.pseudo).toLowerCase()];
      if (!cible) return [404, { erreur: 'Pas de compte à ce nom sur le site.' }];
      if (!(b.role in ROLES)) return [400, { erreur: 'Rôle inconnu.' }];
      if (cible === c && b.role !== 'createur') return [400, { erreur: 'Tu ne peux pas retirer ton propre rôle de créateur.' }];
      cible.role = b.role === 'joueur' ? undefined : b.role;
      noter(c.pseudo, 'role', `${cible.pseudo} → ${NOMS_ROLES[b.role]}`);
    }
    const equipeListe = Object.values(d.comptes).filter((x) => niveau(x) > 0).map((x) => ({ pseudo: x.pseudo, role: x.role, nomRole: NOMS_ROLES[x.role] }));
    return [200, { equipe: equipeListe }];
  },

  /** Réglages du site (Créateur) : boutique Tebex (clé publique de la boutique), sites de vote. */
  'POST /api/mod/config': (b) => {
    const [c, err] = equipe(b, 3);
    if (err) return err;
    const cfg = config();
    if (b.config) {
      const n = b.config;
      if (typeof n.tebex === 'string') cfg.tebex = n.tebex.trim().slice(0, 80);
      if (Array.isArray(n.votes)) {
        cfg.votes = n.votes.slice(0, 10).map((v) => ({ nom: String(v.nom || '').slice(0, 40), url: String(v.url || '').slice(0, 300) }))
          .filter((v) => v.nom && /^https:\/\//.test(v.url));
      }
      fs.writeFileSync(CONFIG, JSON.stringify(cfg, null, 2), { mode: 0o600 });
      cacheBoutique = null;
      noter(c.pseudo, 'reglages', 'boutique / votes');
    }
    return [200, { tebex: cfg.tebex || '', votes: cfg.votes || [], inscriptions: inscriptionsOuvertes() }];
  },

  'POST /api/mod/inscriptions': (b) => {
    const [c, err] = equipe(b, 3);
    if (err) return err;
    const f = path.join(DONNEES, 'inscriptions-fermees');
    if (b.ouvrir) fs.rmSync(f, { force: true });
    else fs.writeFileSync(f, '');
    noter(c.pseudo, 'inscriptions', b.ouvrir ? 'ouvertes' : 'fermées');
    return [200, { inscriptions: inscriptionsOuvertes() }];
  },
});
let cacheBoutique = null;

// ---------- Activité des joueurs (temps de jeu par jour, connexions, adresses) ----------
if (!d.activite) d.activite = {};
function jourDe(t) {
  const x = new Date(t + 3600e3); // heure de Paris (approchée : UTC+1)
  return x.toISOString().slice(0, 10);
}
function activite(cle) {
  if (!d.activite[cle]) d.activite[cle] = { jours: {}, evenements: [], ips: [] };
  return d.activite[cle];
}
function evenementJoueur(a, type, t) {
  a.evenements.push({ t, type });
  if (a.evenements.length > 300) a.evenements.splice(0, a.evenements.length - 300);
}
function suivreActivite(avant, maintenant, ecart) {
  const t = Date.now(), jour = jourDe(t);
  const pas = ecart > 0 && ecart < 20000 ? ecart / 1000 : 5; // secondes depuis le dernier envoi
  const ici = new Set();
  for (const j of maintenant) {
    const cle = j.pseudo.toLowerCase();
    ici.add(cle);
    const a = activite(cle);
    a.pseudo = j.pseudo;
    if (!a.premiere) a.premiere = t;
    a.derniere = t;
    const jj = a.jours[jour] || (a.jours[jour] = { s: 0, afk: 0 });
    jj.s += pas;
    if (j.afk) jj.afk += pas;
    if (!avant.has(cle)) evenementJoueur(a, 'connexion', t);
    if (j.ip && (!a.ips.length || a.ips[a.ips.length - 1].ip !== j.ip)) {
      a.ips = a.ips.filter((x) => x.ip !== j.ip);
      a.ips.push({ ip: j.ip, t });
      if (a.ips.length > 10) a.ips.shift();
    }
    if (j.ip && a.ips.length) a.ips[a.ips.length - 1].t = t;
  }
  for (const cle of avant) if (!ici.has(cle)) evenementJoueur(activite(cle), 'depart', t);
  sauver();
}
// Jours de plus de 7 mois : effacés (une fois par jour)
setInterval(() => {
  const limite = jourDe(Date.now() - 214 * 86400e3);
  for (const a of Object.values(d.activite)) for (const j of Object.keys(a.jours)) if (j < limite) delete a.jours[j];
}, 86400e3).unref();

/** Statistiques de temps de jeu (secondes) : total, 30 et 7 derniers jours, moyenne par semaine, 6 derniers mois. */
function tempsDeJeu(a) {
  const r = { total: 0, totalAfk: 0, j30: 0, j30Afk: 0, j7: 0, j7Afk: 0, mois: [] };
  if (!a) return r;
  const j30 = jourDe(Date.now() - 30 * 86400e3), j7 = jourDe(Date.now() - 7 * 86400e3);
  const parMois = {};
  for (const [j, v] of Object.entries(a.jours)) {
    r.total += v.s;
    r.totalAfk += v.afk;
    if (j > j30) { r.j30 += v.s; r.j30Afk += v.afk; }
    if (j > j7) { r.j7 += v.s; r.j7Afk += v.afk; }
    const m = j.slice(0, 7);
    parMois[m] = parMois[m] || { s: 0, afk: 0 };
    parMois[m].s += v.s;
    parMois[m].afk += v.afk;
  }
  const now = new Date();
  for (let i = 5; i >= 0; i--) {
    const x = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const m = `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}`;
    r.mois.push({ mois: m, s: (parMois[m] || {}).s || 0, afk: (parMois[m] || {}).afk || 0 });
  }
  const semaines = Math.max(1, Math.min(26, (Date.now() - (a.premiere || Date.now())) / (7 * 86400e3)));
  r.moyenneSemaine = r.total / semaines;
  return r;
}

Object.assign(ROUTES, {
  /** Profil complet d'un joueur pour l'équipe. */
  'POST /api/mod/fiche': (b) => {
    const [moi, err] = equipe(b, 1);
    if (err) return err;
    const cle = String(b.pseudo || '').trim().toLowerCase();
    const c = d.comptes[cle], a = d.activite[cle];
    const cas = jeu.casiers.find((x) => x.pseudo.toLowerCase() === cle);
    const ligne = jeu.enLigne.find((x) => x.pseudo.toLowerCase() === cle);
    if (!c && !a && !cas && !ligne) return [404, { erreur: 'Joueur inconnu.' }];
    const pseudo = (c && c.pseudo) || (ligne && ligne.pseudo) || (a && a.pseudo) || (cas && cas.pseudo);
    const admin = niveau(moi) >= 2;
    // Autres pseudos vus avec les mêmes adresses (doubles comptes)
    const ips = a ? a.ips.map((x) => x.ip) : [];
    const lies = !admin ? [] : Object.values(d.activite).filter((x) => x !== a && x.ips.some((y) => ips.includes(y.ip))).map((x) => x.pseudo);
    const enLigneSansIp = ligne ? Object.assign({}, ligne, { ip: admin ? ligne.ip : undefined }) : null;
    return [200, {
      pseudo,
      uuid: (c && c.uuid) || (ligne && ligne.uuid) || uuidHorsLigne(pseudo),
      compte: c ? { cree: c.cree, role: c.role || 'joueur', nomRole: NOMS_ROLES[c.role || 'joueur'], email: masquerEmail(c.email),
        recuperable: !!(c.email && c.reponseHash), connexions: c.connexions || 0, derniereConnexion: c.derniereConnexion || null,
        skin: c.skin ? { version: c.skin.version, modele: c.skin.modele } : null, jeu: c.jeu || null } : null,
      enLigne: enLigneSansIp,
      casier: cas ? cas.sanctions : [],
      temps: tempsDeJeu(a),
      premiere: (a && a.premiere) || (c && c.cree) || null,
      derniere: ligne ? Date.now() : (a && a.derniere) || (c && c.derniereConnexion) || null,
      evenements: a ? a.evenements.slice(-100).reverse() : [],
      ips: admin && a ? a.ips.slice().reverse() : null,
      lies,
      journal: d.journal.filter((j) => j.details.toLowerCase().includes('"pseudo":"' + cle) || j.details.toLowerCase().includes(cle + ' →')).slice(-100).reverse(),
    }];
  },
});

/** Requêtes du plugin (seulement depuis la machine). */
const LOCAL = {
  '/api/serveur/actions': () => {
    const l = file.splice(0, 50);
    for (const a of l) resultats.set(a.id, { attente: true, prise: Date.now() });
    return [200, { actions: l }];
  },
  '/api/serveur/resultats': (b) => {
    for (const r of Array.isArray(b.resultats) ? b.resultats : []) {
      resultats.set(String(r.id), { ok: !!r.ok, message: String(r.message || '').slice(0, 500), donnees: r.donnees || null, t: Date.now() });
    }
    while (resultats.size > 500) resultats.delete(resultats.keys().next().value);
    return [200, { ok: true }];
  },
  '/api/serveur/console': (b) => {
    for (const l of Array.isArray(b.lignes) ? b.lignes : []) {
      console_.lignes.push(String(l).slice(0, 2000));
      console_.seq++;
    }
    if (console_.lignes.length > 3000) console_.lignes.splice(0, console_.lignes.length - 3000);
    return [200, { ok: true }];
  },
  '/api/serveur/enligne': (b) => {
    const avant = new Set(jeu.enLigne.map((j) => j.pseudo.toLowerCase()));
    const maintenant = Array.isArray(b.joueurs) ? b.joueurs.slice(0, 500) : [];
    suivreActivite(avant, maintenant, Date.now() - jeu.majEnLigne);
    jeu.enLigne = maintenant;
    jeu.max = b.max || 0;
    jeu.tps = b.tps;
    jeu.majEnLigne = Date.now();
    return [200, { ok: true }];
  },
  '/api/serveur/donnees': (b) => {
    if (b.classements) jeu.classements = b.classements;
    if (Array.isArray(b.factions)) jeu.factions = b.factions;
    jeu.majDonnees = Date.now();
    return [200, { ok: true }];
  },
  '/api/serveur/casiers': (b) => {
    if (Array.isArray(b.casiers)) jeu.casiers = b.casiers;
    return [200, { ok: true }];
  },
  /** Premier créateur (depuis la machine) : curl -X POST 127.0.0.1:8090/api/serveur/role -d '{"pseudo":"…","role":"createur"}' */
  '/api/serveur/role': (b) => {
    const c = d.comptes[String(b.pseudo || '').toLowerCase()];
    if (!c || !(b.role in ROLES)) return [400, { erreur: 'Pseudo ou rôle inconnu.' }];
    c.role = b.role === 'joueur' ? undefined : b.role;
    noter('Console', 'role', `${c.pseudo} → ${NOMS_ROLES[b.role]}`);
    return [200, { ok: true, pseudo: c.pseudo, role: b.role }];
  },
};

// ---------- Site ----------
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.webp': 'image/webp' };
function fichierSite(url, res, mod) {
  const racine = mod ? SITE_MOD : SITE;
  let p = decodeURIComponent(url.pathname);
  if (p === '/') p = '/index.html';
  if (!path.extname(p)) p += '.html';
  const f = path.normalize(path.join(racine, p));
  if (!f.startsWith(racine + path.sep)) return envoyer(res, 404, 'Introuvable');
  fs.readFile(f, (e, data) => {
    if (e && mod) return envoyer(res, 302, '', 'text/plain', { Location: '/' });
    if (e) return fs.readFile(path.join(SITE, '404.html'), (e2, d2) => envoyer(res, 404, e2 ? 'Page introuvable' : d2, 'text/html; charset=utf-8'));
    envoyer(res, 200, data, TYPES[path.extname(f)] || 'application/octet-stream');
  });
}

function envoyer(res, code, corps, type, entetes) {
  const json = type === undefined && typeof corps === 'object' && !Buffer.isBuffer(corps);
  const data = json ? JSON.stringify(corps) : corps;
  res.writeHead(code, {
    'Content-Type': json ? 'application/json; charset=utf-8' : type || 'text/plain; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'same-origin',
    'X-Frame-Options': 'DENY',
    ...(entetes || {}),
    'Cache-Control': json ? 'no-store' : 'public, max-age=300',
  });
  res.end(data);
}

/** Lit le corps JSON (taille limitée) puis répond avec ce que renvoie « traiter ». */
function lireCorps(req, res, max, traiter) {
  const morceaux = [];
  let taille = 0;
  req.on('data', (x) => {
    taille += x.length;
    if (taille > max) {
      envoyer(res, 413, { erreur: 'Fichier trop lourd.' });
      req.destroy();
      return;
    }
    morceaux.push(x);
  });
  req.on('end', () => {
    if (taille > max) return;
    let b;
    try {
      b = JSON.parse(Buffer.concat(morceaux).toString('utf8') || '{}');
    } catch (e) {
      return envoyer(res, 400, { erreur: 'Requête illisible' });
    }
    Promise.resolve().then(() => traiter(b)).then(([c, r]) => envoyer(res, c, r), (e) => {
      console.error(e);
      envoyer(res, 500, { erreur: 'Erreur du serveur, réessaie.' });
    });
  });
}

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://local');
  const local = req.socket.remoteAddress === '127.0.0.1' || req.socket.remoteAddress === '::1' || req.socket.remoteAddress === '::ffff:127.0.0.1';
  // Adresse du joueur (Caddy la passe) ; directement sinon
  const ip = (local && req.headers['x-forwarded-for'] ? String(req.headers['x-forwarded-for']).split(',')[0].trim() : req.socket.remoteAddress) || '?';
  if (url.pathname === '/api/verifier') {
    // Caddy ajoute X-Forwarded-For : une requête qui vient d'Internet n'y a jamais accès
    if (!local || req.headers['x-forwarded-for']) return envoyer(res, 403, { erreur: 'Interdit' });
    const [c, r] = verifier(url.searchParams);
    return envoyer(res, c, r);
  }
  if (url.pathname === '/api/serveur/profils' || LOCAL[url.pathname]) {
    if (!local || req.headers['x-forwarded-for'] || req.method !== 'POST') return envoyer(res, 403, { erreur: 'Interdit' });
    return lireCorps(req, res, 2 * 1024 * 1024, (b) => (LOCAL[url.pathname] || profilsJeu)(b));
  }
  let m = url.pathname.match(/^\/api\/apparence\/([A-Za-z0-9_-]{3,36})$/);
  if (m) {
    const [c, r] = apparence(m[1]);
    return envoyer(res, c, r);
  }
  m = url.pathname.match(/^\/api\/tete\/([A-Za-z0-9_]{1,16})$/);
  if (m) {
    const c = d.comptes[m[1].toLowerCase()];
    if (!c || !c.skin) return envoyer(res, 404, 'Pas de skin');
    res.writeHead(302, { Location: `/skins/${c.uuid}.png?v=${c.skin.version}`, 'Cache-Control': 'public, max-age=300' });
    return res.end();
  }
  m = url.pathname.match(/^\/(skins|capes)\/([0-9a-f-]{36})\.png$/);
  if (m) {
    return fs.readFile(path.join(IMAGES, m[2] + (m[1] === 'skins' ? '-skin.png' : '-cape.png')), (e, data) => {
      if (e) return envoyer(res, 404, 'Introuvable');
      envoyer(res, 200, data, 'image/png');
    });
  }
  const mod = HOTE_MOD.test(String(req.headers.host || ''));
  // Les routes de l'équipe ne répondent qu'à l'adresse de la modération
  if (url.pathname.startsWith('/api/mod/') && !mod) return envoyer(res, 404, { erreur: 'Inconnu' });
  const route = ROUTES[req.method + ' ' + url.pathname];
  if (route && req.method === 'GET') {
    return Promise.resolve(route({}, ip)).then(([c, r]) => envoyer(res, c, r), () => envoyer(res, 500, { erreur: 'Erreur du serveur.' }));
  }
  if (!route) {
    if (url.pathname.startsWith('/api/')) return envoyer(res, 404, { erreur: 'Inconnu' });
    if (req.method !== 'GET' && req.method !== 'HEAD') return envoyer(res, 405, 'Méthode non permise');
    return fichierSite(url, res, mod);
  }
  const max = url.pathname === '/api/skin' || url.pathname === '/api/cape' ? 600 * 1024 : 8192;
  lireCorps(req, res, max, (b) => route(b, ip));
}).listen(PORT, '127.0.0.1', () => console.log(`Comptes OnyxFight sur 127.0.0.1:${PORT} (${Object.keys(d.comptes).length} comptes)`));
