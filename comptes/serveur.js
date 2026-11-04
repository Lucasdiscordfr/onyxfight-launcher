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
const JOUR = 24 * 3600 * 1000;
const DUREE_SESSION = 30 * JOUR; // connexion gardée par le launcher / le site
const DUREE_JEU = JOUR; // jeton donné au jeu à chaque lancement

fs.mkdirSync(DONNEES, { recursive: true, mode: 0o700 });

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

// ---------- API ----------
const ROUTES = {
  'POST /api/inscription': (b, ip) => {
    if (trop(ip, 'inscription', 5, 60)) return [429, { erreur: 'Trop de comptes créés depuis ta connexion. Réessaie plus tard.' }];
    const pseudo = String(b.pseudo || '').trim(), mdp = String(b.motdepasse || '');
    if (!PSEUDO.test(pseudo)) return [400, { erreur: 'Pseudo : 3 à 16 lettres, chiffres ou _ (sans espace ni accent).' }];
    if (INTERDITS.test(pseudo)) return [400, { erreur: 'Ce pseudo est réservé.' }];
    if (mdp.length < 8 || mdp.length > 128) return [400, { erreur: 'Mot de passe : 8 caractères au minimum.' }];
    if (mdp.toLowerCase().includes(pseudo.toLowerCase())) return [400, { erreur: 'Le mot de passe ne doit pas contenir ton pseudo.' }];
    const cle = pseudo.toLowerCase();
    if (d.comptes[cle]) return [409, { erreur: 'Ce pseudo est déjà pris.' }];
    const sel = crypto.randomBytes(16).toString('hex');
    d.comptes[cle] = { pseudo, uuid: uuidHorsLigne(pseudo), sel, hash: empreinte(mdp, sel), cree: Date.now() };
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
  return [200, { ok: true, pseudo: c.pseudo, uuid: c.uuid }];
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
  const route = ROUTES[req.method + ' ' + url.pathname];
  if (!route) {
    if (url.pathname.startsWith('/api/')) return envoyer(res, 404, { erreur: 'Inconnu' });
    if (req.method !== 'GET' && req.method !== 'HEAD') return envoyer(res, 405, 'Méthode non permise');
    return fichierSite(url, res);
  }
  let corps = '';
  req.on('data', (x) => {
    corps += x;
    if (corps.length > 4096) req.destroy();
  });
  req.on('end', () => {
    let b;
    try {
      b = JSON.parse(corps || '{}');
    } catch (e) {
      return envoyer(res, 400, { erreur: 'Requête illisible' });
    }
    try {
      const [c, r] = route(b, ip);
      envoyer(res, c, r);
    } catch (e) {
      console.error(e);
      envoyer(res, 500, { erreur: 'Erreur du serveur, réessaie.' });
    }
  });
}).listen(PORT, '127.0.0.1', () => console.log(`Comptes OnyxFight sur 127.0.0.1:${PORT} (${Object.keys(d.comptes).length} comptes)`));
