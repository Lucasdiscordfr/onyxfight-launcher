// Compte Microsoft (comptes officiels uniquement) : fenêtre de connexion Microsoft, puis le jeton de connexion est gardé
// chiffré (safeStorage : coffre de Windows) pour ne pas redemander à chaque lancement.
const fs = require('fs');
const path = require('path');
const { safeStorage } = require('electron');
const { Auth } = require('msmc');

class Compte {
  constructor(dossier) {
    this.fichier = path.join(dossier, 'compte.dat');
    this.xbox = null;
    this.minecraft = null;
  }

  /** Infos à afficher (ou null si pas connecté). */
  profil() {
    if (!this.minecraft || !this.minecraft.profile) return null;
    return { pseudo: this.minecraft.profile.name, uuid: this.minecraft.profile.id };
  }

  garder() {
    try {
      const jeton = this.xbox.save();
      const data = safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(jeton) : Buffer.from(jeton, 'utf8');
      fs.mkdirSync(path.dirname(this.fichier), { recursive: true });
      fs.writeFileSync(this.fichier, data);
    } catch (e) {
      console.error('Impossible de garder la connexion', e);
    }
  }

  /** Reprend la connexion gardée (au démarrage). */
  async reprendre() {
    if (!fs.existsSync(this.fichier)) return null;
    try {
      const data = fs.readFileSync(this.fichier);
      const jeton = safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(data) : data.toString('utf8');
      this.xbox = await new Auth('select_account').refresh(jeton);
      this.minecraft = await this.xbox.getMinecraft();
      this.garder();
      return this.profil();
    } catch (e) {
      console.error('Connexion gardée expirée', e);
      this.deconnecter();
      return null;
    }
  }

  /** Ouvre la fenêtre de connexion Microsoft. */
  async connecter() {
    const auth = new Auth('select_account');
    this.xbox = await auth.launch('electron', {
      width: 520,
      height: 650,
      resizable: false,
      title: 'Connexion Microsoft - OnyxFight',
      autoHideMenuBar: true,
    });
    this.minecraft = await this.xbox.getMinecraft();
    if (!this.minecraft.profile) {
      throw new Error("Ce compte Microsoft ne possède pas Minecraft Java Edition.");
    }
    this.garder();
    return this.profil();
  }

  /** Jeton de jeu frais (au moment de cliquer sur Jouer). */
  async pourJouer() {
    if (!this.xbox) throw new Error('Connecte-toi avec ton compte Microsoft.');
    if (!this.xbox.validate()) {
      await this.xbox.refresh(true);
      this.garder();
    }
    this.minecraft = await this.xbox.getMinecraft();
    return this.minecraft.mclc();
  }

  deconnecter() {
    this.xbox = null;
    this.minecraft = null;
    fs.rmSync(this.fichier, { force: true });
  }
}

module.exports = Compte;
