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
/** Remplit une liste déroulante avec les questions secrètes. */
async function remplirQuestions(sel, choisie) {
  try {
    const q = await (await fetch('/api/questions')).json();
    for (const [id, t] of Object.entries(q)) {
      const o = document.createElement('option');
      o.value = id;
      o.textContent = t;
      if (id === choisie) o.selected = true;
      sel.appendChild(o);
    }
  } catch (e) { /* réessayer plus tard */ }
}
function lireFichier(f) {
  return new Promise((ok, ko) => {
    const r = new FileReader();
    r.onload = () => ok(String(r.result).split(',')[1]);
    r.onerror = ko;
    r.readAsDataURL(f);
  });
}
function date(t) {
  return t ? new Date(t).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }) : '—';
}
function message(el, texte, ok) {
  el.textContent = texte || '';
  el.className = 'message ' + (texte ? (ok ? 'ok' : 'erreur') : '');
}
// En-tête (menu à gauche et à droite, logo au centre) et pied de page, communs à toutes les pages
const DISCORD = 'https://discord.gg/onyxfight';
const LAUNCHER = 'https://github.com/Lucasdiscordfr/onyxfight-launcher/releases/latest/download/OnyxFight-Launcher.exe';
document.addEventListener('DOMContentLoaded', () => {
  const ici = location.pathname.replace(/\.html$/, '').replace(/\/$/, '') || '/';
  const lien = (h, t, cls) => {
    const a = document.createElement('a');
    a.href = h;
    a.textContent = t;
    a.className = (cls || '') + (h === ici ? ' actif' : '');
    if (/^https:/.test(h)) { a.target = '_blank'; a.rel = 'noopener'; }
    return a;
  };
  const entete = document.getElementById('entete');
  if (entete) {
    const gauche = el('nav', {}, lien('/', 'Accueil'), lien('/jouer', 'Jouer'), lien('/voter', 'Votes'), lien('/boutique', 'Boutique', 'plein'));
    const droite = el('nav', { class: 'droite' }, lien('/reglement', 'Règlement'), lien('/classement', 'Classement'), lien(DISCORD, 'Discord'),
      lien('/compte', Session.lire() ? 'Mon compte' : 'Connexion', 'contour'));
    const burger = el('button', { class: 'burger', onclick: () => entete.classList.toggle('ouvert') }, '☰');
    entete.replaceChildren(el('div', { class: 'barre' }, gauche, el('a', { class: 'logo-centre', href: '/' }, el('img', { src: 'logo.png', alt: 'OnyxFight' })), droite, burger));
  }
  const pied = document.getElementById('pied');
  if (pied) {
    const p = (html) => { const x = document.createElement('p'); x.innerHTML = html; return x; };
    pied.replaceChildren(el('div', { class: 'colonnes' },
      el('div', {}, el('h4', {}, 'À propos'), p('Le <strong>PvP Faction</strong> moddé au combat de la <strong>1.8</strong> : factions, <strong>KOTH</strong>, catastrophes en warzone, <strong>Boss du Gouffre</strong>, runes légendaires et cosmétiques en 3D.')),
      el('div', {}, el('h4', {}, 'Liens'), el('div', { class: 'liens' }, lien('/', 'Accueil'), lien('/reglement', 'Règlement'), lien(DISCORD, 'Discord'), lien('/classement', 'Classement'), lien('/factions', 'Factions'),
        lien('/jouer', 'Nous rejoindre'), lien('/compte', 'Mon compte'), lien('/voter', 'Votes'), lien('/boutique', 'Boutique'), lien('/bugs', 'Signaler un bug'))),
      el('div', {}, el('h4', {}, 'Boutique'), p('Grades, clés et cosmétiques : tout arrive automatiquement en jeu, et ça aide le serveur à vivre.'),
        el('a', { class: 'bouton', href: '/boutique', style: 'width:100%;text-align:center' }, '🛒 Boutique'))),
      el('div', { class: 'copy' }, 'OnyxFight · serveur PvP Faction moddé · Pas affilié à Mojang ni Microsoft.'));
  }
});
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
function nombre(n) {
  return Math.round(Number(n) || 0).toLocaleString('fr-FR');
}

/** Petite tête du skin importé sur le site (carré violet sinon). */
function teteMini(pseudo, taille) {
  const t = taille || 24, k = t / 8;
  const e = el('span', { class: 'tete-mini', style: `width:${t}px;height:${t}px` });
  e.style.backgroundImage = `url(/api/tete/${encodeURIComponent(pseudo)}), url(/api/tete/${encodeURIComponent(pseudo)})`;
  e.style.backgroundSize = `${64 * k}px ${64 * k}px, ${64 * k}px ${64 * k}px`;
  e.style.backgroundPosition = `${-40 * k}px ${-8 * k}px, ${-8 * k}px ${-8 * k}px`;
  return e;
}
