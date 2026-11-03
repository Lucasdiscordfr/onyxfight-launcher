// Compte Microsoft (comptes officiels uniquement) : fenêtre de connexion Microsoft, puis la connexion est gardée chiffrée
// (safeStorage : coffre de Windows). Le jeton de jeu Minecraft (valable environ 23 h) est gardé lui aussi : on ne
// redemande pas à Microsoft à chaque ouverture ou à chaque partie (sinon Minecraft refuse : trop de connexions).
const fs = require('fs');
const path = require('path');
const { safeStorage } = require('electron');
const { Auth } = require('msmc');

const MARGE = 10 * 60 * 1000; // on renouvelle le jeton 10 min avant qu'il expire

class Compte {
  constructor(dossier) {
    this.fichier = path.join(dossier, 'compte.dat');
    this.ms = null; // jeton Microsoft (pour renouveler)
    this.mc = null; // autorisation de jeu (format minecraft-launcher-core)
    this.exp = 0;
  }

  /** Infos à afficher (ou null si pas connecté). */
  profil() {
    if (!this.mc) return null;
    return { pseudo: this.mc.name, uuid: this.mc.uuid };
  }

  garder() {
    try {
      const texte = JSON.stringify({ ms: this.ms, mc: this.mc, exp: this.exp });
      const data = safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(texte) : Buffer.from(texte, 'utf8');
      fs.mkdirSync(path.dirname(this.fichier), { recursive: true });
      fs.writeFileSync(this.fichier, data);
    } catch (e) {
      console.error('Impossible de garder la connexion', e);
    }
  }

  /** Après une connexion ou un renouvellement auprès de Microsoft. */
  async depuisXbox(xbox) {
    const minecraft = await xbox.getMinecraft();
    if (!minecraft.profile) throw new Error('Ce compte Microsoft ne possède pas Minecraft Java Edition.');
    this.ms = xbox.save();
    this.mc = minecraft.mclc();
    this.exp = minecraft.exp || Date.now() + 23 * 3600 * 1000;
    this.garder();
  }

  /** Reprend la connexion gardée (au démarrage), sans rien demander à Microsoft si le jeton est encore bon. */
  async reprendre() {
    if (!fs.existsSync(this.fichier)) return null;
    try {
      const data = fs.readFileSync(this.fichier);
      const texte = safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(data) : data.toString('utf8');
      let d;
      try {
        d = JSON.parse(texte);
      } catch (e) {
        d = { ms: texte }; // ancien format : seulement le jeton Microsoft
      }
      this.ms = d.ms || null;
      this.mc = d.mc || null;
      this.exp = d.exp || 0;
      if (this.mc && this.exp - MARGE > Date.now()) return this.profil();
      await this.renouveler();
      return this.profil();
    } catch (e) {
      console.error('Connexion gardée expirée', e);
      // On garde le profil affiché s'il existe : on réessaiera au clic sur Jouer
      return this.profil();
    }
  }

  async renouveler() {
    if (!this.ms) throw new Error('Connecte-toi avec ton compte Microsoft.');
    const xbox = await new Auth('select_account').refresh(this.ms);
    await this.depuisXbox(xbox);
  }

  /** Ouvre la fenêtre de connexion Microsoft. */
  async connecter() {
    const xbox = await new Auth('select_account').launch('electron', {
      width: 520,
      height: 650,
      resizable: false,
      title: 'Connexion Microsoft - OnyxFight',
      autoHideMenuBar: true,
    });
    await this.depuisXbox(xbox);
    return this.profil();
  }

  /**
   * Le jeton de jeu est-il encore accepté par Minecraft ? Il peut être annulé avant l'heure (connexion sur un autre
   * ordinateur, changement de mot de passe) : le serveur dirait alors « Failed to verify username ».
   */
  async jetonValide() {
    if (!this.mc || !this.mc.access_token) return false;
    try {
      const r = await fetch('https://api.minecraftservices.com/minecraft/profile', {
        headers: { Authorization: 'Bearer ' + this.mc.access_token },
      });
      if (r.status === 401 || r.status === 403) return false;
      return true; // autre réponse (Minecraft injoignable…) : on garde le jeton plutôt que de bloquer
    } catch (e) {
      return true;
    }
  }

  /** Autorisation de jeu : celle gardée si elle est encore bonne (vérifiée auprès de Minecraft), sinon renouvelée. */
  async pourJouer() {
    if (!this.mc && !this.ms) throw new Error('Connecte-toi avec ton compte Microsoft.');
    if (!this.mc || this.exp - MARGE <= Date.now() || !(await this.jetonValide())) await this.renouveler();
    return Object.assign({}, this.mc);
  }

  deconnecter() {
    this.ms = null;
    this.mc = null;
    this.exp = 0;
    fs.rmSync(this.fichier, { force: true });
  }
}

module.exports = Compte;
