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

// ---------- API ----------
const ROUTES = {
  'POST /api/inscription': (b, ip) => {
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

// ---------- Site ----------
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.webp': 'image/webp' };
function fichierSite(url, res) {
  let p = decodeURIComponent(url.pathname);
  if (p === '/') p = '/index.html';
  if (!path.extname(p)) p += '.html';
  const f = path.normalize(path.join(SITE, p));
  if (!f.startsWith(SITE + path.sep)) return envoyer(res, 404, 'Introuvable');
  fs.readFile(f, (e, data) => {
    if (e) return fs.readFile(path.join(SITE, '404.html'), (e2, d2) => envoyer(res, 404, e2 ? 'Page introuvable' : d2, 'text/html; charset=utf-8'));
    envoyer(res, 200, data, TYPES[path.extname(f)] || 'application/octet-stream');
  });
}

function envoyer(res, code, corps, type) {
  const json = type === undefined && typeof corps === 'object' && !Buffer.isBuffer(corps);
  const data = json ? JSON.stringify(corps) : corps;
  res.writeHead(code, {
    'Content-Type': json ? 'application/json; charset=utf-8' : type || 'text/plain; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'same-origin',
    'X-Frame-Options': 'DENY',
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
    try {
      const [c, r] = traiter(b);
      envoyer(res, c, r);
    } catch (e) {
      console.error(e);
      envoyer(res, 500, { erreur: 'Erreur du serveur, réessaie.' });
    }
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
  if (url.pathname === '/api/serveur/profils') {
    if (!local || req.headers['x-forwarded-for'] || req.method !== 'POST') return envoyer(res, 403, { erreur: 'Interdit' });
    return lireCorps(req, res, 2 * 1024 * 1024, (b) => profilsJeu(b));
  }
  let m = url.pathname.match(/^\/api\/apparence\/([A-Za-z0-9_-]{3,36})$/);
  if (m) {
    const [c, r] = apparence(m[1]);
    return envoyer(res, c, r);
  }
  m = url.pathname.match(/^\/(skins|capes)\/([0-9a-f-]{36})\.png$/);
  if (m) {
    return fs.readFile(path.join(IMAGES, m[2] + (m[1] === 'skins' ? '-skin.png' : '-cape.png')), (e, data) => {
      if (e) return envoyer(res, 404, 'Introuvable');
      envoyer(res, 200, data, 'image/png');
    });
  }
  const route = ROUTES[req.method + ' ' + url.pathname];
  if (route && req.method === 'GET') {
    const [c, r] = route({}, ip);
    return envoyer(res, c, r);
  }
  if (!route) {
    if (url.pathname.startsWith('/api/')) return envoyer(res, 404, { erreur: 'Inconnu' });
    if (req.method !== 'GET' && req.method !== 'HEAD') return envoyer(res, 405, 'Méthode non permise');
    return fichierSite(url, res);
  }
  const max = url.pathname === '/api/skin' || url.pathname === '/api/cape' ? 600 * 1024 : 8192;
  lireCorps(req, res, max, (b) => route(b, ip));
}).listen(PORT, '127.0.0.1', () => console.log(`Comptes OnyxFight sur 127.0.0.1:${PORT} (${Object.keys(d.comptes).length} comptes)`));
