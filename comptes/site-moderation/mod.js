// Outils communs aux pages du site (connexion gardée dans le navigateur).
const $ = (id) => document.getElementById(id);
const Session = {
  lire() { try { return localStorage.getItem('onyx-mod-session'); } catch (e) { return null; } },
  ecrire(s) { try { s ? localStorage.setItem('onyx-mod-session', s) : localStorage.removeItem('onyx-mod-session'); } catch (e) { /* navigation privée */ } },
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

/** Barre du haut et vérification : sans compte d'équipe, retour à la connexion. */
async function entreeEquipe() {
  const s = Session.lire();
  if (!s) return null;
  const m = await api('mod/moi', { session: s });
  if (m.erreur || !m.niveau) {
    if (!m.erreur || /expir/.test(m.erreur)) { api('deconnexion', { session: s }); Session.ecrire(null); }
    return null;
  }
  const q = document.getElementById('qui-barre');
  if (q) {
    q.replaceChildren(teteMini(m.pseudo, 22), el('span', {}, m.pseudo + ' · ' + m.nomRole),
      el('button', { onclick: async () => { await api('deconnexion', { session: Session.lire() }); Session.ecrire(null); location.href = '/'; } }, 'Se déconnecter'));
  }
  return m;
}
