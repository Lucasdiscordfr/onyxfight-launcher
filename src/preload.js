// Pont sûr entre l'interface et le processus principal (l'interface n'a pas accès à Node).
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('onyx', {
  fenetre: (quoi) => ipcRenderer.send('fenetre', quoi),
  ouvrir: (url) => ipcRenderer.send('ouvrir', url),
  infos: () => ipcRenderer.invoke('infos'),
  actualites: () => ipcRenderer.invoke('actualites'),
  statut: () => ipcRenderer.invoke('statut'),
  reprendre: () => ipcRenderer.invoke('compte:reprendre'),
  connecter: () => ipcRenderer.invoke('compte:connecter'),
  deconnecter: () => ipcRenderer.invoke('compte:deconnecter'),
  modeTest: () => ipcRenderer.invoke('compte:modeTest'),
  connecterTest: (pseudo) => ipcRenderer.invoke('compte:test', pseudo),
  sauverReglages: (r) => ipcRenderer.invoke('reglages:sauver', r),
  ouvrirDossier: () => ipcRenderer.invoke('reglages:dossier'),
  jouer: () => ipcRenderer.invoke('jouer'),
  surEtat: (f) => ipcRenderer.on('etat', (e, d) => f(d)),
  surMaj: (f) => ipcRenderer.on('maj', (e, d) => f(d)),
});
