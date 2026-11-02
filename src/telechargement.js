// Téléchargements (avec suivi) et vérification des fichiers.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const https = require('https');
const http = require('http');

/** Lit une adresse et renvoie le texte (suit les redirections). */
function lire(url, essais = 3) {
  return new Promise((ok, ko) => {
    const lib = url.startsWith('https') ? https : http;
    const req = lib.get(url, { headers: { 'User-Agent': 'OnyxFight-Launcher', 'Cache-Control': 'no-cache' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        return ok(lire(new URL(res.headers.location, url).toString(), essais));
      }
      if (res.statusCode !== 200) {
        res.resume();
        return ko(new Error(`${url} : erreur ${res.statusCode}`));
      }
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (c) => (data += c));
      res.on('end', () => ok(data));
    });
    req.setTimeout(20000, () => req.destroy(new Error('délai dépassé')));
    req.on('error', (e) => (essais > 1 ? setTimeout(() => ok(lire(url, essais - 1)), 1000) : ko(e)));
  });
}

async function lireJson(url) {
  // Évite le cache de GitHub (raw) avec un paramètre qui change
  const sep = url.includes('?') ? '&' : '?';
  return JSON.parse(await lire(`${url}${sep}t=${Date.now()}`));
}

/** Télécharge vers un fichier (fichier .part puis renommé). suivi(reçu, total). */
function telecharger(url, dest, suivi, essais = 3) {
  return new Promise((ok, ko) => {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    const tmp = dest + '.part';
    const lib = url.startsWith('https') ? https : http;
    const req = lib.get(url, { headers: { 'User-Agent': 'OnyxFight-Launcher' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        return ok(telecharger(new URL(res.headers.location, url).toString(), dest, suivi, essais));
      }
      if (res.statusCode !== 200) {
        res.resume();
        return ko(new Error(`${url} : erreur ${res.statusCode}`));
      }
      const total = parseInt(res.headers['content-length'] || '0', 10);
      let recu = 0;
      const out = fs.createWriteStream(tmp);
      res.on('data', (c) => {
        recu += c.length;
        if (suivi) suivi(recu, total);
      });
      res.pipe(out);
      out.on('finish', () => out.close(() => {
        fs.renameSync(tmp, dest);
        ok(dest);
      }));
      out.on('error', ko);
    });
    req.setTimeout(30000, () => req.destroy(new Error('délai dépassé')));
    req.on('error', (e) => {
      if (essais > 1) setTimeout(() => ok(telecharger(url, dest, suivi, essais - 1)), 1500);
      else ko(e);
    });
  });
}

function sha1(fichier) {
  return new Promise((ok, ko) => {
    const h = crypto.createHash('sha1');
    fs.createReadStream(fichier).on('data', (d) => h.update(d)).on('end', () => ok(h.digest('hex'))).on('error', ko);
  });
}

/** Le fichier est-il déjà là et bon (sha1, sinon taille) ? */
async function bon(fichier, attendu) {
  if (!fs.existsSync(fichier)) return false;
  if (attendu.sha1) return (await sha1(fichier)) === attendu.sha1.toLowerCase();
  if (attendu.taille) return fs.statSync(fichier).size === attendu.taille;
  return true;
}

module.exports = { lire, lireJson, telecharger, sha1, bon };
