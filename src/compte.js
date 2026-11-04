// Compte OnyxFight (pseudo + mot de passe créés sur le site). La connexion est gardée chiffrée (safeStorage : coffre de
// Windows) ; le mot de passe n'est jamais gardé. À chaque partie, le launcher demande un jeton de jeu au service des
// comptes et le passe au jeu : le serveur OnyxFight le vérifie à la connexion.
// Mode test (pseudo seul) : seulement quand le manifeste l'ouvre.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { safeStorage } = require('electron');
const cfg = require('./config');

/** UUID « hors ligne » de Minecraft pour un pseudo (le même que celui du serveur et du service des comptes). */
function uuidHorsLigne(pseudo) {
  const h = crypto.createHash('md5').update('OfflinePlayer:' + pseudo, 'utf8').digest();
  h[6] = (h[6] & 0x0f) | 0x30;
  h[8] = (h[8] & 0x3f) | 0x80;
  const x = h.toString('hex');
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20)}`;
}

/** Adresse du service des comptes (celle du manifeste si elle y est). */
let adresse = cfg.COMPTES;
function regler(url) {
  if (typeof url === 'string' && /^https:\/\//.test(url)) adresse = url.replace(/\/+$/, '');
}

async function api(route, corps) {
  let r;
  try {
    r = await fetch(`${adresse}/api/${route}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': 'OnyxFight-Launcher' },
      body: JSON.stringify(corps || {}),
      signal: AbortSignal.timeout(10000),
    });
  } catch (e) {
    const x = new Error('Service des comptes injoignable. Vérifie ta connexion Internet et réessaie.');
    x.reseau = true;
    throw x;
  }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    const x = new Error(j.erreur || `Erreur du service des comptes (${r.status}).`);
    x.code = r.status;
    throw x;
  }
  return j;
}

class Compte {
  constructor(dossier) {
    this.fichier = path.join(dossier, 'compte.dat');
    this.session = null; // connexion au service des comptes
    this.pseudo = null;
    this.uuid = null;
    this.test = false;
  }

  profil() {
    if (!this.pseudo) return null;
    return { pseudo: this.pseudo, uuid: this.uuid, test: this.test };
  }

  garder() {
    try {
      const texte = JSON.stringify({ type: 'site', session: this.session, pseudo: this.pseudo, uuid: this.uuid, test: this.test });
      const data = safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(texte) : Buffer.from(texte, 'utf8');
      fs.mkdirSync(path.dirname(this.fichier), { recursive: true });
      fs.writeFileSync(this.fichier, data);
    } catch (e) {
      console.error('Impossible de garder la connexion', e);
    }
  }

  /** Reprend la connexion gardée (au démarrage). Les anciennes connexions Microsoft sont oubliées. */
  async reprendre() {
    if (!fs.existsSync(this.fichier)) return null;
    try {
      const data = fs.readFileSync(this.fichier);
      const d = JSON.parse(safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(data) : data.toString('utf8'));
      if (d.type !== 'site' && !d.test) {
        this.deconnecter();
        return null;
      }
      this.session = d.session || null;
      this.pseudo = d.pseudo || null;
      this.uuid = d.uuid || null;
      this.test = !!d.test;
      if (this.test) return this.profil();
      try {
        await api('session', { session: this.session });
      } catch (e) {
        if (e.code === 401) {
          this.deconnecter();
          return null;
        }
        // Service injoignable : on garde le profil affiché, on réessaiera au clic sur Jouer
      }
      return this.profil();
    } catch (e) {
      return null;
    }
  }

  async connecter(pseudo, motdepasse) {
    const r = await api('connexion', { pseudo: String(pseudo || '').trim(), motdepasse: String(motdepasse || '') });
    this.session = r.session;
    this.pseudo = r.pseudo;
    this.uuid = r.uuid;
    this.test = false;
    this.garder();
    return this.profil();
  }

  /** Compte de test hors ligne : un simple pseudo (seulement quand le manifeste ouvre le mode test). */
  connecterTest(pseudo) {
    pseudo = String(pseudo || '').trim();
    if (!/^[A-Za-z0-9_]{3,16}$/.test(pseudo)) throw new Error('Pseudo de test : 3 à 16 lettres, chiffres ou _.');
    this.session = null;
    this.test = true;
    this.pseudo = pseudo;
    this.uuid = uuidHorsLigne(pseudo);
    this.garder();
    return this.profil();
  }

  /** Autorisation de jeu : pseudo, UUID et jeton de jeu (vérifié par le serveur OnyxFight). */
  async pourJouer() {
    if (!this.pseudo) throw new Error('Connecte-toi avec ton compte OnyxFight.');
    let jeton = crypto.randomBytes(16).toString('hex');
    if (!this.test) {
      try {
        const r = await api('jeu', { session: this.session });
        jeton = r.jeton;
        this.pseudo = r.pseudo;
        this.uuid = r.uuid;
      } catch (e) {
        if (e.code === 401) {
          this.deconnecter();
          throw new Error('Ta connexion a expiré : reconnecte-toi avec ton pseudo et ton mot de passe.');
        }
        throw e;
      }
    }
    return {
      access_token: jeton,
      client_token: crypto.randomBytes(16).toString('hex'),
      uuid: this.uuid,
      name: this.pseudo,
      user_properties: '{}',
      meta: { type: 'mojang', demo: false },
    };
  }

  deconnecter() {
    if (this.session) api('deconnexion', { session: this.session }).catch(() => {});
    this.session = null;
    this.pseudo = null;
    this.uuid = null;
    this.test = false;
    fs.rmSync(this.fichier, { force: true });
  }
}

Compte.regler = regler;
module.exports = Compte;
