// Outils communs aux pages du site (connexion gardée dans le navigateur).
const $ = (id) => document.getElementById(id);
const Session = {
  lire() { try { return localStorage.getItem('onyx-session'); } catch (e) { return null; } },
  ecrire(s) { try { s ? localStorage.setItem('onyx-session', s) : localStorage.removeItem('onyx-session'); } catch (e) { /* navigation privée */ } },
};
async function api(route, corps) {
  try {
    const r = await fetch('/api/' + route, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corps || {}) });
    const j = await r.json().catch(() => ({}));
    return r.ok ? j : { erreur: j.erreur || 'Erreur ' + r.status };
  } catch (e) {
    return { erreur: 'Serveur injoignable. Réessaie dans un instant.' };
  }
}
function message(el, texte, ok) {
  el.textContent = texte || '';
  el.className = 'message ' + (texte ? (ok ? 'ok' : 'erreur') : '');
}
// Menu : « Mon compte » si connecté, sinon « Connexion »
document.addEventListener('DOMContentLoaded', () => {
  const lien = document.querySelector('[data-compte]');
  if (lien && Session.lire()) lien.textContent = 'Mon compte';
});
