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
// Menu commun à toutes les pages (« Modération » pour l'équipe)
document.addEventListener('DOMContentLoaded', async () => {
  const nav = document.getElementById('menu');
  if (!nav) return;
  const ici = location.pathname.replace(/\.html$/, '').replace(/\/$/, '') || '/';
  const liens = [['/', 'Accueil'], ['/classement', 'Classement'], ['/boutique', 'Boutique'], ['/voter', 'Voter'],
    ['/compte', Session.lire() ? 'Mon compte' : 'Connexion']];
  const dessiner = (equipe) => {
    nav.innerHTML = '';
    for (const [h, t] of liens.concat(equipe ? [['/moderation', 'Modération']] : [])) {
      const a = document.createElement('a');
      a.href = h;
      a.textContent = t;
      if (h === ici) a.className = 'actif';
      nav.appendChild(a);
    }
    const dc = document.createElement('a');
    dc.href = 'https://discord.gg/onyxfight';
    dc.target = '_blank';
    dc.rel = 'noopener';
    dc.textContent = 'Discord';
    nav.appendChild(dc);
  };
  dessiner(false);
  if (Session.lire()) {
    const m = await api('mod/moi', { session: Session.lire() });
    if (m.niveau > 0) dessiner(true);
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
