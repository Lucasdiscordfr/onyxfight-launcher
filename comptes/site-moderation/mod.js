// Outils de l'espace équipe (connexion à part de celle du site public).
const $ = (id) => document.getElementById(id);
const Session = {
  lire() { try { return localStorage.getItem('onyx-equipe'); } catch (e) { return null; } },
  ecrire(s) { try { s ? localStorage.setItem('onyx-equipe', s) : localStorage.removeItem('onyx-equipe'); } catch (e) { /* navigation privée */ } },
};
const S = () => Session.lire();
async function api(route, corps) {
  try {
    const r = await fetch('/api/' + route, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(Object.assign({ session: S() }, corps || {})) });
    const j = await r.json().catch(() => ({}));
    if (r.status === 401 && route !== 'mod/connexion') { Session.ecrire(null); location.reload(); }
    return r.ok ? j : { erreur: j.erreur || 'Erreur ' + r.status };
  } catch (e) {
    return { erreur: 'Serveur injoignable. Réessaie dans un instant.' };
  }
}
function el(tag, attrs, ...enfants) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (k === 'class') e.className = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (v !== false && v != null) e.setAttribute(k, v === true ? '' : v);
  }
  for (const x of enfants.flat()) if (x != null && x !== false) e.append(x instanceof Node ? x : String(x));
  return e;
}
function message(z, texte, ok) {
  z.textContent = texte || '';
  z.className = 'message ' + (texte ? (ok ? 'ok' : 'erreur') : '');
}
const nombre = (n) => Math.round(Number(n) || 0).toLocaleString('fr-FR');
const dh = (t) => t ? new Date(t).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }) : '—';
const dj = (t) => t ? new Date(t).toLocaleDateString('fr-FR') : '—';
function duree(s) {
  s = Math.round(s || 0);
  const j = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  return j ? `${j}j ${h}h` : h ? `${h}h${String(m).padStart(2, '0')}` : `${m} min`;
}
function anciennete(t) {
  if (!t) return '—';
  const j = Math.floor((Date.now() - t) / 86400e3);
  return j >= 365 ? `${Math.floor(j / 365)} an${j >= 730 ? 's' : ''} et ${j % 365} jours` : `${j} jour${j > 1 ? 's' : ''}`;
}
function drapeau(code, titre) {
  if (!code) return el('span', { class: 'gris' }, '—');
  return el('img', { class: 'drapeau', src: `https://flagcdn.com/20x15/${code.toLowerCase()}.png`, alt: code, title: titre || code });
}
function teteMini(pseudo, taille) {
  const t = taille || 24, k = t / 8;
  const e = el('span', { class: 'tete-mini', style: `width:${t}px;height:${t}px` });
  e.style.backgroundImage = `url(/api/tete/${encodeURIComponent(pseudo)}), url(/api/tete/${encodeURIComponent(pseudo)})`;
  e.style.backgroundSize = `${64 * k}px ${64 * k}px, ${64 * k}px ${64 * k}px`;
  e.style.backgroundPosition = `${-40 * k}px ${-8 * k}px, ${-8 * k}px ${-8 * k}px`;
  return e;
}
function carte(titre, ...c) { return el('div', { class: 'carte' }, titre ? el('h3', {}, titre) : null, ...c); }
function champ(id, etiquette, attrs) {
  const { liste, ...autres } = attrs || {};
  return el('div', {}, el('label', { for: id }, etiquette), el(liste ? 'select' : 'input', Object.assign({ id }, autres),
    ...(liste || []).map(([v, t]) => el('option', { value: v }, t))));
}
const val = (id) => { const x = document.getElementById(id); return x ? x.value.trim() : ''; };
function suspicion(v) { return el('span', { class: 'susp ' + (v >= 50 ? 's2' : v >= 20 ? 's1' : 's0') }, v + '%'); }

/** Envoie une action au serveur de jeu et attend le résultat (le plugin la fait dans la seconde). */
async function action(a, zone) {
  const r = await api('mod/action', { action: a });
  if (r.erreur) { if (zone) message(zone, r.erreur); return null; }
  if (zone) message(zone, 'Envoyé au serveur…', true);
  for (let i = 0; i < 20; i++) {
    await new Promise((ok) => setTimeout(ok, 700));
    const x = await api('mod/resultat', { id: r.id });
    if (x.message !== undefined) { if (zone) message(zone, x.donnees ? '' : x.message, x.ok); return x; }
  }
  if (zone) message(zone, 'Pas de réponse du serveur pour le moment (l\'action sera faite dès qu\'il répond).');
  return null;
}
