// Espace équipe : connexion, menu, pages (#/accueil, #/joueurs, #/joueur/Pseudo, #/console…).
let moi = null, minuterie = null;
const NOMS_SANCTIONS = { ban: 'Bannissement', mute: 'Mute', warn: 'Avertissement', kick: 'Expulsion' };
const MENU = [
  ['Général'], ['accueil', '⌂', 'Accueil', 1], ['joueurs', '👥', 'Joueurs', 1],
  ['Serveur'], ['console', '▤', 'Console', 2], ['evenements', '⚡', 'Événements & annonces', 2], ['factions', '⚑', 'Factions', 2], ['economie', '$', 'Argent & cadeaux', 3],
  ['Administration'], ['equipe', '🛡', 'Équipe', 3], ['journal', '☰', 'Journal de l\'équipe', 2], ['reglages', '⚙', 'Réglages', 3],
];
const vue = () => $('vue');
const nav = (h) => (location.hash = h);

// ---------------------------------------------------------------------------------------------------------------- Pages
const PAGES = {
  async accueil() {
    $('titre').textContent = 'Accueil';
    const [e, l] = await Promise.all([api('mod/etat'), api('mod/liste')]);
    if (e.erreur) return vue().replaceChildren(carte(null, e.erreur));
    const s = l.stats || {};
    vue().replaceChildren(
      tuiles(s),
      carte('Serveur', el('div', { class: 'tuiles', style: 'margin:0' },
        tuile('●', 'État', e.connecte ? el('span', { class: 'vert' }, 'En ligne') : el('span', { class: 'rouge' }, 'Injoignable')),
        tuile('⏱', 'TPS', e.tps >= 0 ? e.tps : '—'), tuile('👤', 'Joueurs', e.enLigne.length + ' / ' + e.max),
        tuile('✉', 'Comptes du site', e.comptes), tuile('✎', 'Inscriptions', e.inscriptions ? 'Ouvertes' : 'Fermées'))),
      carte('Joueurs connectés', tableJoueursEnLigne(e.enLigne)));
    minuterie = setInterval(() => location.hash.startsWith('#/accueil') && PAGES.accueil(), 15000);
  },

  async joueurs(_, q) {
    $('titre').textContent = 'Joueurs';
    const r = await api('mod/liste', { recherche: q || '' });
    if (r.erreur) return vue().replaceChildren(carte(null, r.erreur));
    const champRecherche = el('input', { placeholder: 'Rechercher (pseudo, UUID, n°)…', value: q || '', style: 'max-width:380px' });
    let filtre = 'tous';
    const corps = el('tbody');
    const compteur = el('span', { class: 'aide' });
    const createur = moi.niveau >= 3;
    const dessiner = () => {
      const t = champRecherche.value.toLowerCase();
      let l = r.joueurs.filter((j) => !t || j.pseudo.toLowerCase().includes(t) || j.uuid.includes(t) || String(j.id) === t);
      if (filtre === 'enligne') l = l.filter((j) => j.enLigne);
      if (filtre === 'bannis') l = l.filter((j) => j.banni);
      if (filtre === 'staff') l = l.filter((j) => j.role);
      if (filtre === 'suspects') l = l.filter((j) => j.suspicion >= 50);
      compteur.textContent = `${l.length} / ${r.joueurs.length} joueurs affichés`;
      corps.replaceChildren(...l.slice(0, 500).map((j) => el('tr', { class: 'cliquable', onclick: () => nav('#/joueur/' + encodeURIComponent(j.pseudo)) },
        el('td', { class: 'gris' }, j.id),
        el('td', {}, el('div', { style: 'display:flex;align-items:center' }, teteMini(j.pseudo, 28), el('div', {},
          el('strong', {}, j.pseudo, j.enLigne ? el('span', { class: 'vert', title: 'En ligne' }, ' ●') : null, j.role ? el('span', { class: 'puce', style: 'margin-left:6px' }, j.role) : null),
          el('div', { class: 'mono' }, j.uuid)))),
        el('td', { class: 'mono', style: 'color:var(--texte);font-size:12px' }, duree(j.temps)),
        el('td', { class: j.premiere && Date.now() - j.premiere > 365 * 86400e3 ? '' : 'vert' }, anciennete(j.premiere)),
        createur ? el('td', {}, drapeau(j.pays)) : null,
        createur ? el('td', {}, j.vpn ? el('span', { class: 'etiquette ban' }, 'VPN') : el('span', { class: 'gris' }, '—')) : null,
        el('td', {}, j.compte ? '✔' : el('span', { class: 'gris' }, '—')),
        el('td', {}, j.banni ? el('span', { class: 'etiquette ban' }, 'Banni') : j.sanctions ? el('span', { class: 'etiquette' }, j.sanctions) : el('span', { class: 'gris' }, '—')),
        el('td', {}, suspicion(j.suspicion)),
        el('td', { class: 'gris' }, '⋮'))));
      if (!l.length) corps.replaceChildren(el('tr', {}, el('td', { colspan: 10, class: 'vide' }, 'Aucun joueur.')));
    };
    champRecherche.addEventListener('input', dessiner);
    const tuilesFiltres = tuiles(r.stats, (f) => { filtre = filtre === f ? 'tous' : f; dessiner(); document.querySelectorAll('.tuile[data-f]').forEach((x) => x.classList.toggle('choisie', x.dataset.f === filtre)); });
    vue().replaceChildren(tuilesFiltres,
      carte(null, el('div', { style: 'display:flex;gap:14px;align-items:center;flex-wrap:wrap;margin-bottom:10px' }, champRecherche, compteur),
        el('div', { style: 'overflow-x:auto' }, el('table', {}, el('thead', {}, el('tr', {}, ['N°', 'Joueur', 'Temps de jeu', 'Ancienneté', createur ? 'Pays' : null, createur ? 'VPN' : null,
          'Compte', 'Sanctions', 'Suspicion', ''].filter((x) => x !== null).map((t) => el('th', {}, t)))), corps))));
    dessiner();
  },

  async joueur(pseudo, onglet) {
    const p = decodeURIComponent(pseudo || '');
    $('titre').textContent = 'Joueur - ' + p;
    const f = await api('mod/fiche', { pseudo: p });
    if (f.erreur) return vue().replaceChildren(carte(null, f.erreur));
    $('titre').replaceChildren(teteMini(f.pseudo, 24), 'Joueur - ' + f.pseudo);
    const ONGLETS = [['infos', 'Informations'], ['modifier', 'Modifier'], ['casier', `Casier (${f.casier.length})`], ['inventaire', 'Inventaire'], ['logs', 'Logs'],
      ['identifiants', 'Identifiants'], ['equipe', 'Actions de l\'équipe']];
    const o = ONGLETS.some((x) => x[0] === onglet) ? onglet : 'infos';
    const gauche = el('div'), droite = el('div');
    vue().replaceChildren(
      el('div', { class: 'onglets' }, ONGLETS.map(([id, t]) => el('a', { class: id === o ? 'actif' : '', onclick: () => nav(`#/joueur/${encodeURIComponent(f.pseudo)}/${id}`) }, t))),
      el('div', { class: 'profil' }, gauche, droite));
    PROFIL[o](gauche, f);
    colonneDroite(droite, f);
  },

  async console() {
    $('titre').textContent = 'Console';
    let seq = 0;
    const boite = el('div', { class: 'console' });
    const entree = el('input', { placeholder: moi.niveau >= 3 ? 'Commande (sans /) puis Entrée…' : 'Seul le Créateur peut taper des commandes', disabled: moi.niveau < 3 });
    const msg = el('div', { class: 'message' });
    entree.addEventListener('keydown', async (e) => {
      if (e.key !== 'Enter' || !entree.value.trim()) return;
      const c = entree.value.trim();
      entree.value = '';
      await action({ type: 'commande', commande: c }, msg);
    });
    vue().replaceChildren(carte(null, boite, el('div', { style: 'margin-top:10px' }, entree), msg));
    const lire = async () => {
      const r = await api('mod/console', { depuis: seq });
      if (r.erreur) return;
      const enBas = boite.scrollTop + boite.clientHeight >= boite.scrollHeight - 30;
      for (const l of r.lignes) boite.append(el('div', { class: /WARN/.test(l) ? 'warn' : /ERROR|FATAL/.test(l) ? 'err' : '' }, l));
      while (boite.childNodes.length > 3000) boite.firstChild.remove();
      seq = r.seq;
      if (enBas) boite.scrollTop = boite.scrollHeight;
    };
    await lire();
    boite.scrollTop = boite.scrollHeight;
    minuterie = setInterval(lire, 1500);
  },

  async evenements() {
    $('titre').textContent = 'Événements & annonces';
    const msg = el('div', { class: 'message' });
    const evts = [['boss', '👹 Boss du Gouffre'], ['koth', '⛰ KOTH'], ['largage', '📦 Largage'], ['tornade', '🌪 Tornade'], ['meteorites', '☄ Météorites'],
      ['eruption', '🌋 Éruption'], ['seisme', '🌍 Séisme'], ['grele', '🧊 Grêle'], ['tempete', '⛈ Tempête'], ['lunedesang', '🌕 Lune de sang']];
    vue().replaceChildren(
      carte('Annonce à tout le serveur', el('div', { class: 'ligne-form' }, champ('a-texte', 'Message', { placeholder: 'Titre à l\'écran + message dans le chat' }),
        el('button', { class: 'bouton', onclick: () => val('a-texte') && action({ type: 'annonce', texte: val('a-texte') }, msg) }, 'Annoncer'))),
      carte('Lancer un événement', el('div', { class: 'petits' }, evts.map(([n, t]) => el('button', { onclick: () => confirm('Lancer : ' + t + ' ?') && action({ type: 'evenement', nom: n }, msg) }, t))),
        el('div', { class: 'petits', style: 'margin-top:10px' },
          el('button', { class: 'danger', onclick: () => action({ type: 'evenement', nom: 'arreter' }, msg) }, '⏹ Arrêter l\'événement en cours'),
          el('button', { class: 'danger', onclick: () => action({ type: 'evenement', nom: 'retirerboss' }, msg) }, '✖ Retirer le Boss'))), msg);
  },

  async factions() {
    $('titre').textContent = 'Factions';
    const r = await api('mod/factions');
    if (r.erreur) return vue().replaceChildren(carte(null, r.erreur));
    const msg = el('div', { class: 'message' });
    const re = () => setTimeout(PAGES.factions, 2500);
    vue().replaceChildren(msg, carte(`Factions (${r.factions.length})`, r.factions.length ? el('table', {}, el('thead', {}, el('tr', {}, ['Nom', 'Chef', 'Membres', 'Puissance', 'Territoires', 'Banque', 'Kills', ''].map((t) => el('th', {}, t)))),
      el('tbody', {}, r.factions.map((f) => el('tr', {}, el('td', {}, el('strong', {}, f.nom)),
        el('td', {}, el('a', { href: '#/joueur/' + encodeURIComponent(f.chef) }, f.chef)),
        el('td', {}, el('div', {}, f.membres.map((m) => el('a', { class: 'puce', href: '#/joueur/' + encodeURIComponent(m), style: 'text-decoration:none' }, m)))),
        el('td', {}, nombre(f.puissance)), el('td', {}, f.territoires), el('td', {}, nombre(f.banque)), el('td', {}, f.kills),
        el('td', {}, el('div', { class: 'petits' },
          el('button', { onclick: async () => { const n = prompt('Nouveau nom de ' + f.nom + ' ?'); if (n) { await action({ type: 'faction', action: 'renommer', id: f.id, valeur: n }, msg); re(); } } }, 'Renommer'),
          el('button', { onclick: async () => { const n = prompt('Nouveau montant de la banque ?', f.banque); if (n !== null) { await action({ type: 'faction', action: 'banque', id: f.id, valeur: n }, msg); re(); } } }, 'Banque'),
          el('button', { class: 'danger', onclick: async () => { if (confirm('Dissoudre ' + f.nom + ' ?')) { await action({ type: 'faction', action: 'dissoudre', id: f.id }, msg); re(); } } }, 'Dissoudre')))))))
      : el('p', { class: 'vide' }, 'Aucune faction.')), el('p', { class: 'aide' }, r.maj ? 'Mise à jour le ' + dh(r.maj) + ' (toutes les minutes).' : ''));
  },

  async economie() {
    $('titre').textContent = 'Argent & cadeaux';
    const msg = el('div', { class: 'message' });
    vue().replaceChildren(
      carte('Argent d\'un joueur', el('div', { class: 'ligne-form' }, champ('e-pseudo', 'Joueur'),
        champ('e-mode', 'Opération', { liste: [['donner', 'Donner'], ['retirer', 'Retirer'], ['definir', 'Définir à']] }), champ('e-montant', 'Montant', { type: 'number', min: 0 }),
        el('button', { class: 'bouton', onclick: () => action({ type: 'argent', pseudo: val('e-pseudo'), mode: val('e-mode'), montant: val('e-montant') }, msg) }, 'Valider'))),
      carte('Cadeau à tous les joueurs connectés (giveall)', el('div', { class: 'ligne-form' },
        champ('g-objet', 'Objet', { placeholder: 'diamond, golden_apple, onyxfight:cle_rare…' }), champ('g-qte', 'Quantité', { type: 'number', min: 1, value: 1 }),
        el('button', { class: 'bouton', onclick: () => confirm('Donner ' + val('g-qte') + ' × ' + val('g-objet') + ' à tous les joueurs connectés ?') && action({ type: 'giveall', objet: val('g-objet'), quantite: val('g-qte') }, msg) }, 'Donner à tous'))), msg);
  },

  async equipe() {
    $('titre').textContent = 'Équipe';
    const msg = el('div', { class: 'message' });
    const charger = async (x) => {
      const r = await api('mod/roles', x || {});
      if (r.erreur) return message(msg, r.erreur);
      vue().replaceChildren(carte('Membres de l\'équipe', el('table', {}, el('tbody', {}, r.equipe.map((m) => el('tr', {},
        el('td', {}, el('a', { href: '#/joueur/' + encodeURIComponent(m.pseudo), style: 'display:flex;align-items:center;text-decoration:none' }, teteMini(m.pseudo), m.pseudo)),
        el('td', {}, el('span', { class: 'puce' }, m.nomRole)),
        el('td', {}, el('div', { class: 'petits' }, el('button', { class: 'danger', onclick: () => confirm('Retirer ' + m.pseudo + ' de l\'équipe ?') && charger({ pseudo: m.pseudo, role: 'joueur' }) }, 'Retirer'))))))),
        el('div', { class: 'ligne-form', style: 'margin-top:14px' }, champ('r-pseudo', 'Pseudo (compte du site)'),
          champ('r-role', 'Rôle', { liste: [['moderateur', 'Modérateur — sanctions, casier, logs'], ['admin', 'Administrateur — + console, événements, factions'], ['createur', 'Créateur — tout, IP et pays']] }),
          el('button', { class: 'bouton', onclick: () => charger({ pseudo: val('r-pseudo'), role: val('r-role') }) }, 'Donner le rôle')), msg));
      if (x) message(msg, 'Rôle mis à jour.', true);
    };
    charger();
  },

  async journal() {
    $('titre').textContent = 'Journal de l\'équipe';
    const r = await api('mod/journal');
    if (r.erreur) return vue().replaceChildren(carte(null, r.erreur));
    vue().replaceChildren(carte(null, r.journal.length ? el('table', {}, el('thead', {}, el('tr', {}, ['Date', 'Qui', 'Action', 'Détails'].map((t) => el('th', {}, t)))),
      el('tbody', {}, r.journal.map((j) => el('tr', {}, el('td', { style: 'white-space:nowrap' }, dh(j.t)), el('td', {}, j.par), el('td', {}, el('span', { class: 'etiquette' }, j.action)),
        el('td', { class: 'aide' }, j.details))))) : el('p', { class: 'vide' }, 'Rien pour le moment.')));
  },

  async reglages() {
    $('titre').textContent = 'Réglages';
    const msg = el('div', { class: 'message' });
    const r = await api('mod/config');
    if (r.erreur) return vue().replaceChildren(carte(null, r.erreur));
    const votes = el('textarea', { rows: 4 });
    votes.value = r.votes.map((v) => v.nom + ' | ' + v.url).join('\n');
    vue().replaceChildren(
      carte('Boutique Tebex', champ('c-tebex', 'Clé publique de la boutique (Tebex → Integrations → Headless API)', { value: r.tebex }),
        el('p', { class: 'aide' }, 'La livraison en jeu utilise la clé secrète du serveur (tebex.secret dans la config du plugin).')),
      carte('Sites de vote', el('label', {}, 'Un site par ligne : Nom | https://adresse-de-vote'), votes),
      carte('Inscriptions', el('p', {}, r.inscriptions ? 'Les inscriptions sont ouvertes.' : 'Les inscriptions sont fermées.'),
        el('button', { class: 'bouton secondaire', onclick: async () => { const x = await api('mod/inscriptions', { ouvrir: !r.inscriptions }); if (!x.erreur) PAGES.reglages(); } },
          r.inscriptions ? 'Fermer les inscriptions' : 'Ouvrir les inscriptions')),
      el('button', { class: 'bouton', onclick: async () => {
        const v = votes.value.split('\n').map((l) => l.split('|').map((x) => x.trim())).filter((x) => x.length === 2).map(([nom, url]) => ({ nom, url }));
        const x = await api('mod/config', { config: { tebex: val('c-tebex'), votes: v } });
        message(msg, x.erreur || 'Réglages enregistrés.', !x.erreur);
      } }, 'Enregistrer'), msg);
  },
};

function tuile(ic, nom, v, sous) { return el('div', { class: 'tuile' }, el('div', { class: 'ic' }, ic), el('div', {}, el('span', {}, nom), el('strong', {}, v), sous ? el('small', {}, sous) : null)); }
function tuiles(s, choisir) {
  s = s || {};
  const t = (f, ic, nom, v, sous) => {
    const x = tuile(ic, nom, nombre(v), sous);
    if (choisir) { x.dataset.f = f; x.style.cursor = 'pointer'; x.addEventListener('click', () => choisir(f)); }
    return x;
  };
  const pc = (v) => s.total ? Math.round((v / s.total) * 100) + '% des joueurs' : '';
  return el('div', { class: 'tuiles' }, t('tous', '👥', 'Total joueurs', s.total), t('enligne', '●', 'En ligne', s.enLigne, pc(s.enLigne)),
    t('bannis', '⛔', 'Bannis', s.bannis, pc(s.bannis)), t('staff', '🛡', 'Équipe', s.staff), t('suspects', '⚠', 'Suspects', s.suspects, pc(s.suspects)));
}
function tableJoueursEnLigne(l) {
  if (!l.length) return el('p', { class: 'vide' }, 'Personne en ligne.');
  return el('table', {}, el('thead', {}, el('tr', {}, ['Joueur', 'Grade', 'Faction', 'Position', 'Vie', 'Ping'].map((t) => el('th', {}, t)))),
    el('tbody', {}, l.map((j) => el('tr', { class: 'cliquable', onclick: () => nav('#/joueur/' + encodeURIComponent(j.pseudo)) },
      el('td', {}, el('div', { style: 'display:flex;align-items:center' }, teteMini(j.pseudo), el('strong', {}, j.pseudo), j.afk ? el('span', { class: 'gris' }, ' 💤') : null)),
      el('td', {}, j.grade), el('td', {}, j.faction || '—'), el('td', { class: 'mono', style: 'color:var(--texte)' }, `${j.monde} ${j.x} ${j.y} ${j.z}`),
      el('td', {}, j.vie + ' ❤'), el('td', {}, j.ping + ' ms')))));
}

// ------------------------------------------------------------------------------------------------------- Profil joueur
function dessinerSkin(canvas, img, slim) {
  const k = 5, g = canvas.getContext('2d');
  canvas.width = 16 * k; canvas.height = 32 * k;
  g.imageSmoothingEnabled = false;
  const b = slim ? 3 : 4;
  const p = (sx, sy, w, h, dx, dy) => g.drawImage(img, sx, sy, w, h, dx * k, dy * k, w * k, h * k);
  if (!img) {
    g.fillStyle = '#26262a';
    [[4, 0, 8, 8], [4, 8, 8, 12], [4, 20, 8, 12], [4 - b, 8, b, 12], [12, 8, b, 12]].forEach(([x, y, w, h]) => g.fillRect(x * k, y * k, w * k, h * k));
    return;
  }
  p(8, 8, 8, 8, 4, 0); p(40, 8, 8, 8, 4, 0); p(20, 20, 8, 12, 4, 8); p(20, 36, 8, 12, 4, 8);
  p(44, 20, b, 12, 4 - b, 8); p(44, 36, b, 12, 4 - b, 8); p(36, 52, b, 12, 12, 8); p(52, 52, b, 12, 12, 8);
  p(4, 20, 4, 12, 4, 20); p(4, 36, 4, 12, 4, 20); p(20, 52, 4, 12, 8, 20); p(4, 52, 4, 12, 8, 20);
}
let modeTemps = 'reel';
const recharger = (f, o) => setTimeout(() => PAGES.joueur(encodeURIComponent(f.pseudo), o), 2000);
const PROFIL = {
  infos(z, f) {
    const c = f.compte, j = c && c.jeu, l = f.enLigne;
    const grade = (l && l.grade) || (j && j.grade) || 'Joueur', faction = (l && l.faction) || (j && j.faction);
    const ligne = (k, v) => [el('div', { class: 'cle' }, k), el('div', {}, v)];
    const canvas = el('canvas');
    z.replaceChildren(
      carte(null, el('div', { class: 'badge-haut' }, c ? c.nomRole : 'Sans compte sur le site'), el('div', { class: 'fiche' },
        el('div', { class: 'lignes' },
          ...ligne('Identifiant', el('span', { class: 'mono', style: 'color:var(--texte)' }, f.uuid)),
          ...ligne('Pseudo', el('strong', {}, f.pseudo)),
          ...ligne('Grade', el('span', { class: 'puce' }, grade)),
          ...ligne('Faction', faction ? [el('span', { class: 'puce' }, faction), l && l.rang ? el('span', { class: 'puce' }, l.rang) : null] : 'Aucune'),
          ...ligne('Classes', l && l.classes ? Object.entries(l.classes).map(([n, v]) => el('span', { class: 'puce' }, n + ' · niv. ' + v)) : el('span', { class: 'gris' }, 'visibles quand il est connecté')),
          el('div', { class: 'groupe' }, 'Argent & combat'),
          ...ligne('Argent', el('strong', {}, nombre(l ? l.argent : j ? j.argent : 0) + ' $')),
          ...ligne('Kills · Morts', j ? `${j.kills} · ${j.morts} (ratio ${(j.morts ? j.kills / j.morts : j.kills).toFixed(2)})` : '—'),
          ...ligne('Puissance', j ? j.puissance + ' / 10' : '—'),
          ...ligne('Suspicion', suspicion(f.suspicion)),
          f.pays ? ligne('Pays', [drapeau(f.pays.code, f.pays.pays), ' ', f.pays.pays || '', f.pays.vpn ? el('span', { class: 'etiquette ban', style: 'margin-left:8px' }, 'VPN') : null]) : []),
        el('div', {}, el('div', { class: 'carte-id' },
          el('div', { class: 'entete' }, el('span', {}, '◆ OnyxFight'), el('span', {}, 'Carte de joueur')),
          el('div', { class: 'corps' }, canvas, el('div', {},
            el('div', { class: 'nom' }, f.pseudo),
            el('div', { class: 'k' }, 'Grade'), el('div', { class: 'v' }, grade),
            el('div', { class: 'k' }, 'Faction'), el('div', { class: 'v' }, faction || '—'),
            el('div', { class: 'k' }, 'Arrivé le'), el('div', { class: 'v' }, dj(f.premiere)),
            el('div', { class: 'k' }, 'Statut'), el('div', { class: 'v' }, l ? el('span', { class: 'vert' }, '● En ligne') : el('span', { class: 'gris' }, '● Hors ligne')))))))),
      carteTemps(f, z));
    if (c && c.skin) {
      const img = new Image();
      img.onload = () => dessinerSkin(canvas, img, c.skin.modele === 'slim');
      img.src = '/skins/' + f.uuid + '.png?v=' + c.skin.version;
    } else dessinerSkin(canvas, null);
  },

  modifier(z, f) {
    const msg = el('div', { class: 'message' });
    const m = f.meta, l = f.enLigne, j = f.compte && f.compte.jeu;
    const createur = moi.niveau >= 3;
    const fait = (a) => action(Object.assign({ type: 'modifier', pseudo: f.pseudo }, a), msg).then(() => recharger(f, 'modifier'));
    const bloc = (titre, niveau, ...c) => carte(titre, moi.niveau >= niveau ? c : el('p', { class: 'aide' }, 'Réservé ' + (niveau >= 3 ? 'au Créateur.' : 'aux administrateurs.')));
    z.replaceChildren(msg, el('div', { class: 'grille-edit' },
      bloc('Grade', 3, el('div', { class: 'ligne-form' },
        champ('m-grade', 'Grade', { liste: [['aucun', 'Joueur (aucun)']].concat(Object.entries(m.grades)) }),
        champ('m-jours', 'Durée (jours, vide = à vie)', { type: 'number', min: 1 })),
        el('button', { class: 'bouton', style: 'margin-top:10px', onclick: () => fait({ champ: 'grade', valeur: val('m-grade'), valeur2: val('m-jours') }) }, 'Appliquer')),
      bloc('Argent', 3, el('div', { class: 'ligne-form' },
        champ('m-mode', 'Opération', { liste: [['definir', 'Définir à'], ['donner', 'Donner'], ['retirer', 'Retirer']] }),
        champ('m-montant', 'Montant (actuel : ' + nombre(l ? l.argent : j ? j.argent : 0) + ')', { type: 'number', min: 0 })),
        el('button', { class: 'bouton', style: 'margin-top:10px', onclick: () => action({ type: 'argent', pseudo: f.pseudo, mode: val('m-mode'), montant: val('m-montant') }, msg).then(() => recharger(f, 'modifier')) }, 'Appliquer')),
      bloc('Faction', 2, el('div', { class: 'ligne-form' },
        champ('m-faction', 'Faction', { liste: [['', '— Aucune (le sortir de sa faction)']].concat(m.factions.map((x) => [x.id, x.nom])) })),
        el('button', { class: 'bouton', style: 'margin-top:10px', onclick: () => fait({ champ: 'faction', valeur: val('m-faction') }) }, 'Appliquer'),
        el('div', { class: 'ligne-form', style: 'margin-top:12px' }, champ('m-rang', 'Rang dans sa faction', { liste: [['recrue', 'Recrue'], ['membre', 'Membre'], ['officier', 'Officier'], ['chef', 'Chef']] })),
        el('button', { class: 'bouton secondaire', style: 'margin-top:10px', onclick: () => fait({ champ: 'rang', valeur: val('m-rang') }) }, 'Changer le rang')),
      bloc('Statistiques', 3, el('div', { class: 'ligne-form' },
        champ('m-kills', 'Kills', { type: 'number', min: 0, value: j ? j.kills : '' }), champ('m-morts', 'Morts', { type: 'number', min: 0, value: j ? j.morts : '' }),
        champ('m-puissance', 'Puissance (-10 à 10)', { type: 'number', min: -10, max: 10, value: j ? j.puissance : '' })),
        el('button', { class: 'bouton', style: 'margin-top:10px', onclick: () => fait({ champ: 'stats', kills: val('m-kills'), morts: val('m-morts'), puissance: val('m-puissance') }) }, 'Appliquer')),
      bloc('Cosmétiques', 3, el('div', { class: 'ligne-form' }, champ('m-cos', 'Cosmétique', { liste: Object.entries(m.cosmetiques) })),
        el('div', { class: 'petits', style: 'margin-top:10px' },
          el('button', { onclick: () => fait({ champ: 'cosmetique', valeur: val('m-cos'), valeur2: 'donner' }) }, 'Donner'),
          el('button', { class: 'danger', onclick: () => fait({ champ: 'cosmetique', valeur: val('m-cos'), valeur2: 'retirer' }) }, 'Retirer'))),
      bloc('Clés de coffre', 3, el('div', { class: 'ligne-form' },
        champ('m-cle', 'Type', { liste: [['commun', 'Commune'], ['rare', 'Rare'], ['epique', 'Épique'], ['onyx', 'Onyx']] }), champ('m-nb', 'Nombre', { type: 'number', min: 1, value: 1 })),
        el('button', { class: 'bouton', style: 'margin-top:10px', onclick: () => fait({ champ: 'cles', valeur: val('m-cle'), valeur2: val('m-nb') }) }, 'Donner')),
      bloc('XP de classe', 3, el('div', { class: 'ligne-form' },
        champ('m-classe', 'Classe', { liste: (m.classes.length ? m.classes : ['mineur', 'fermier', 'bucheron', 'guerrier']).map((x) => [x, x]) }), champ('m-xp', 'XP à donner', { type: 'number', min: 1, value: 100 })),
        el('button', { class: 'bouton', style: 'margin-top:10px', disabled: !l, onclick: () => fait({ champ: 'classe', valeur: val('m-classe'), valeur2: val('m-xp') }) }, l ? 'Donner' : 'Le joueur doit être connecté')),
      createur ? null : null));
  },

  casier(z, f) {
    const msg = el('div', { class: 'message' });
    z.replaceChildren(
      carte('Sanctionner', el('div', { class: 'ligne-form' },
        champ('s-type', 'Sanction', { liste: [['warn', 'Avertissement'], ['mute', 'Mute'], ['kick', 'Expulsion'], ['ban', 'Bannissement']] }),
        champ('s-duree', 'Durée (vide = définitif)', { placeholder: '30m, 2h, 7j, 2sem' }), champ('s-raison', 'Raison', { placeholder: 'Visible par le joueur' }),
        el('button', { class: 'bouton', onclick: async () => {
          if (!val('s-raison')) return message(msg, 'Donne une raison.');
          if (val('s-type') === 'ban' && !confirm(`Bannir ${f.pseudo} ${val('s-duree') ? 'pour ' + val('s-duree') : 'définitivement'} ?`)) return;
          await action({ type: 'sanction', sanction: val('s-type'), pseudo: f.pseudo, duree: ['ban', 'mute'].includes(val('s-type')) ? val('s-duree') : '', raison: val('s-raison') }, msg);
          recharger(f, 'casier');
        } }, 'Appliquer')),
        el('div', { class: 'petits', style: 'margin-top:10px' },
          el('button', { onclick: async () => { await action({ type: 'lever', sanction: 'mute', pseudo: f.pseudo }, msg); recharger(f, 'casier'); } }, 'Lever le mute'),
          el('button', { onclick: async () => { await action({ type: 'lever', sanction: 'ban', pseudo: f.pseudo }, msg); recharger(f, 'casier'); } }, 'Lever le bannissement')),
        el('p', { class: 'aide' }, 'Modérateur : bannissement jusqu\'à 7 jours. Administrateur et Créateur : sans limite.'), msg),
      carte('Casier', f.casier.length ? el('table', {}, el('thead', {}, el('tr', {}, ['Date', 'Sanction', 'Raison', 'Par', 'Fin'].map((t) => el('th', {}, t)))),
        el('tbody', {}, f.casier.map((s) => el('tr', {}, el('td', { style: 'white-space:nowrap' }, dh(s.debut)),
          el('td', {}, el('span', { class: 'etiquette ' + s.type }, NOMS_SANCTIONS[s.type] || s.type), s.leve ? el('span', { class: 'etiquette ok', style: 'margin-left:6px' }, 'levé par ' + (s.levePar || '?')) : null),
          el('td', {}, s.raison), el('td', {}, s.par), el('td', {}, ['ban', 'mute'].includes(s.type) ? (s.fin > 0 ? dh(s.fin) : 'Définitif') : '—'))))) : el('p', { class: 'vide' }, 'Casier vierge.')));
  },

  async inventaire(z, f) {
    const msg = el('div', { class: 'message' });
    if (!f.enLigne) return z.replaceChildren(carte('Inventaire', el('p', { class: 'vide' }, 'Le joueur doit être connecté pour voir son inventaire.')));
    z.replaceChildren(carte('Inventaire', el('p', { class: 'vide' }, 'Demande au serveur…'), msg));
    const r = await action({ type: 'inventaire', pseudo: f.pseudo }, msg);
    if (!r || !r.donnees) return;
    const grille = (objets, n, ordre) => el('div', { class: 'inv' }, Array.from({ length: n }, (_, i) => {
      const idx = ordre ? ordre[i] : i;
      const o = objets.find((x) => x.case === idx);
      if (!o) return el('div', { class: 'case' });
      const nom = o.nom || o.id.replace(/^minecraft:/, '').replace(/^onyxfight:/, '◆ ').replace(/_/g, ' ');
      const info = [o.nom ? o.nom + ' (' + o.id + ')' : o.id, o.enchantements ? 'Enchantements : ' + o.enchantements.join(', ') : '', o.usure ? 'Usure : ' + o.usure : ''].filter(Boolean).join('\n');
      return el('div', { class: 'case pleine' + (o.enchantements ? ' ench' : ''), title: info }, nom, o.nombre > 1 ? el('span', { class: 'n' }, o.nombre) : null);
    }));
    const d = r.donnees, ordre = [...Array(27).keys()].map((i) => i + 9).concat([...Array(9).keys()]);
    z.replaceChildren(carte('Armure', grille(d.armure, 4, [3, 2, 1, 0])),
      carte('Inventaire', grille(d.inventaire, 36, ordre), el('p', { class: 'aide' }, 'La dernière ligne est la barre d\'objets. Survole un objet pour ses détails.')),
      carte('Coffre de l\'Ender', grille(d.coffreEnder, 27)));
  },

  logs(z, f) {
    const TYPES = [['tous', 'Tout'], ['connexion', 'Connexions'], ['chat', 'Chat'], ['commande', 'Commandes'], ['mort', 'Morts'], ['kill', 'Kills'], ['objet', 'Objets jetés'], ['mode', 'Mode de jeu']];
    let type = 'tous';
    const recherche = el('input', { placeholder: 'Rechercher dans les logs…', style: 'max-width:320px' });
    const corps = el('tbody');
    const filtres = el('div', { class: 'filtres' });
    const dessiner = () => {
      filtres.replaceChildren(...TYPES.map(([id, t]) => el('button', { class: id === type ? 'actif' : '', onclick: () => { type = id; dessiner(); } }, t)));
      const q = recherche.value.toLowerCase();
      const l = f.logs.filter((x) => (type === 'tous' || x.type === type || (type === 'connexion' && x.type === 'depart')) && (!q || x.texte.toLowerCase().includes(q)));
      corps.replaceChildren(...(l.length ? l.slice(0, 600).map((x) => el('tr', {}, el('td', { style: 'white-space:nowrap', class: 'gris' }, dh(x.t)),
        el('td', {}, el('span', { class: 'etiquette' + (x.type === 'mort' ? ' ban' : x.type === 'kill' ? ' ok' : '') }, x.type)), el('td', {}, x.texte)))
        : [el('tr', {}, el('td', { colspan: 3, class: 'vide' }, 'Rien.'))]));
    };
    recherche.addEventListener('input', dessiner);
    z.replaceChildren(carte(`Logs de ${f.pseudo} (${f.logs.length} derniers)`, el('div', { style: 'display:flex;gap:12px;flex-wrap:wrap;align-items:center' }, filtres, recherche),
      el('table', {}, el('thead', {}, el('tr', {}, ['Date', 'Type', 'Détails'].map((t) => el('th', {}, t)))), corps)));
    dessiner();
  },

  identifiants(z, f) {
    const c = f.compte;
    const l = (k, v) => [el('div', { class: 'cle' }, k), el('div', {}, v)];
    z.replaceChildren(
      carte('Identifiants', el('div', { class: 'lignes' },
        ...l('UUID', el('span', { class: 'mono', style: 'color:var(--texte)' }, f.uuid)), ...l('Pseudo', f.pseudo),
        ...l('Compte du site', c ? 'Oui, créé le ' + dh(c.cree) : 'Non'), ...l('Rôle', c ? c.nomRole : '—'),
        ...l('E-mail', c && c.email ? c.email : '—'), ...l('Récupération', c ? (c.recuperable ? '✔ e-mail + question secrète' : '⚠ rien d\'enregistré') : '—'),
        ...l('Parties (launcher)', c ? c.connexions : '—'), ...l('Skin importé', c && c.skin ? 'Oui' : 'Non'),
        ...(f.pays ? l('Pays', [drapeau(f.pays.code, f.pays.pays), ' ', f.pays.pays || '—', f.pays.vpn ? el('span', { class: 'etiquette ban', style: 'margin-left:8px' }, 'VPN / hébergeur') : null]) : []),
        ...(f.pays && f.pays.fai ? l('Fournisseur', f.pays.fai) : []))),
      carte('Adresses IP', f.ips === null ? el('p', { class: 'aide' }, 'Visible seulement par le Créateur.') : f.ips.length
        ? el('table', {}, el('thead', {}, el('tr', {}, ['Adresse', 'Pays', 'VPN', 'Fournisseur', 'Dernière fois'].map((t) => el('th', {}, t)))),
          el('tbody', {}, f.ips.map((x) => el('tr', {}, el('td', { class: 'mono', style: 'color:var(--texte);font-size:12px' }, x.ip),
            el('td', {}, drapeau(x.code, x.pays), ' ', x.pays || ''), el('td', {}, x.vpn ? el('span', { class: 'etiquette ban' }, 'Oui') : 'Non'), el('td', { class: 'aide' }, x.fai || '—'), el('td', {}, dh(x.t))))))
        : el('p', { class: 'vide' }, 'Aucune adresse enregistrée.')),
      carte('Comptes liés (même adresse IP)', moi.niveau < 2 ? el('p', { class: 'aide' }, 'Visible par les administrateurs.') : f.lies.length
        ? el('div', {}, f.lies.map((p) => el('a', { class: 'puce', href: '#/joueur/' + encodeURIComponent(p), style: 'text-decoration:none' }, p))) : el('p', { class: 'vide' }, 'Aucun.')));
  },

  equipe(z, f) {
    z.replaceChildren(carte('Actions de l\'équipe sur ' + f.pseudo, f.journal.length ? el('table', {}, el('tbody', {}, f.journal.map((j) => el('tr', {},
      el('td', { style: 'white-space:nowrap' }, dh(j.t)), el('td', {}, j.par), el('td', {}, el('span', { class: 'etiquette' }, j.action)), el('td', { class: 'aide' }, j.details)))))
      : el('p', { class: 'vide' }, 'Aucune.')));
  },
};

function carteTemps(f, z) {
  const t = f.temps, afk = modeTemps === 'total';
  const v = (s, a) => (afk ? s : s - a);
  const max = Math.max(3600, ...t.mois.map((m) => m.s));
  const b = (id, x) => el('button', { class: modeTemps === id ? 'actif' : '', onclick: () => { modeTemps = id; PROFIL.infos(z, f); } }, x);
  return carte(null,
    el('div', { style: 'display:flex;justify-content:space-between;align-items:center' }, el('h3', { style: 'margin:0' }, '📈 Temps de jeu des 6 derniers mois'), el('div', { class: 'filtres', style: 'margin:0' }, b('reel', 'Réel'), b('total', 'Total (dont AFK)'))),
    el('div', { class: 'stats-temps' },
      el('div', {}, el('span', {}, 'Temps total'), el('strong', {}, duree(v(t.total, t.totalAfk)))),
      el('div', {}, el('span', {}, 'Première connexion'), el('strong', {}, dj(f.premiere))),
      el('div', {}, el('span', {}, 'Dernière activité'), el('strong', {}, f.enLigne ? 'En ligne' : dj(f.derniere))),
      el('div', {}, el('span', {}, 'Moyenne / semaine'), el('strong', {}, duree(t.moyenneSemaine))),
      el('div', {}, el('span', {}, '30 derniers jours'), el('strong', {}, duree(v(t.j30, t.j30Afk))), el('small', {}, 'dont AFK ' + duree(t.j30Afk))),
      el('div', {}, el('span', {}, '7 derniers jours'), el('strong', {}, duree(v(t.j7, t.j7Afk))), el('small', {}, 'dont AFK ' + duree(t.j7Afk)))),
    el('div', { class: 'barres' }, t.mois.map((m) => {
      const x = v(m.s, m.afk);
      return el('div', { class: 'col' }, el('span', { class: 'val' }, x ? duree(x) : ''), el('div', { class: 'barre', style: `height:${(x / max) * 100}%` }, afk && m.s ? el('div', { class: 'afk', style: `height:${(m.afk / m.s) * 100}%` }) : null));
    })),
    el('div', { class: 'axe' }, t.mois.map((m) => el('span', {}, new Date(m.mois + '-15').toLocaleDateString('fr-FR', { month: 'short', year: '2-digit' })))),
    afk ? el('p', { class: 'aide' }, 'En rouge : temps AFK (5 minutes sans bouger).') : null);
}

function colonneDroite(z, f) {
  const l = f.enLigne, msg = el('div', { class: 'message' });
  const jauge = (nom, v, max, couleur, texte) => el('div', { class: 'jauge-l' }, el('div', { class: 't' }, el('span', {}, nom), el('strong', {}, texte || `${v} / ${max}`)),
    el('div', { class: 'jauge' }, el('div', { style: `width:${Math.max(0, Math.min(100, (v / max) * 100))}%;background:${couleur}` })));
  const fin = () => recharger(f, 'infos');
  z.replaceChildren(
    carte('⚡ Actions rapides', el('div', { class: 'actions' },
      el('button', { disabled: !l, onclick: () => { const t = prompt('Message privé à ' + f.pseudo + ' ?'); if (t) action({ type: 'joueur', pseudo: f.pseudo, action: 'message', valeur: t }, msg); } }, '💬 Message'),
      el('button', { disabled: !l, onclick: () => action({ type: 'joueur', pseudo: f.pseudo, action: 'soigner' }, msg) }, '✚ Soigner'),
      el('button', { disabled: !l, onclick: () => action({ type: 'joueur', pseudo: f.pseudo, action: 'spawn' }, msg) }, '⌂ Au spawn'),
      el('button', { onclick: () => { const r = prompt('Raison de l\'avertissement ?'); if (r) action({ type: 'sanction', sanction: 'warn', pseudo: f.pseudo, raison: r }, msg).then(fin); } }, '⚠ Avertir'),
      el('button', { onclick: () => { const d = prompt('Durée du mute (30m, 2h, 7j… vide = définitif) ?'); if (d === null) return; const r = prompt('Raison ?'); if (r) action({ type: 'sanction', sanction: 'mute', pseudo: f.pseudo, duree: d, raison: r }, msg).then(fin); } }, '🔇 Mute'),
      el('button', { disabled: !l, onclick: () => { const r = prompt('Raison de l\'expulsion ?'); if (r) action({ type: 'sanction', sanction: 'kick', pseudo: f.pseudo, raison: r }, msg); } }, '👢 Kick'),
      el('button', { class: 'danger', onclick: () => { const d = prompt('Durée du bannissement (30m, 2h, 7j… vide = définitif) ?'); if (d === null) return; const r = prompt('Raison ?'); if (r && confirm('Bannir ' + f.pseudo + ' ?')) action({ type: 'sanction', sanction: 'ban', pseudo: f.pseudo, duree: d, raison: r }, msg).then(fin); } }, '⛔ Bannir'),
      el('button', { class: 'danger', disabled: !l || moi.niveau < 2, onclick: () => confirm('Vider tout l\'inventaire de ' + f.pseudo + ' ?') && action({ type: 'joueur', pseudo: f.pseudo, action: 'vider' }, msg) }, '🗑 Vider l\'inv.')), msg),
    carte('Statut', l ? el('div', {},
      jauge('Vie', l.vie, l.vieMax || 20, '#f87171'), jauge('Armure', l.armure || 0, 20, '#d4d4d8'), jauge('Faim', l.faim, 20, '#fb923c'),
      jauge('Saturation', l.saturation || 0, 20, '#facc15'), jauge('Niveau d\'XP', Math.min(l.niveauXp || 0, 100), 100, '#4ade80', 'niv. ' + (l.niveauXp || 0)),
      el('div', { class: 'aide', style: 'margin-top:8px' }, (l.mode || '') + ' · ' + l.ping + ' ms' + (l.afk ? ' · 💤 AFK' : '') + (l.op ? ' · ⭐ op' : '')),
      l.effets && l.effets.length ? el('div', { style: 'margin-top:8px' }, l.effets.map((e) => el('span', { class: 'puce' }, e))) : null)
      : el('p', { class: 'vide' }, '● Hors ligne · vu le ' + dh(f.derniere))),
    carte('Position', l ? el('div', {}, el('span', { class: 'puce' }, l.monde), el('span', { class: 'puce' }, l.zone || 'Nature'),
      el('div', { class: 'position' }, el('div', {}, el('small', {}, 'X'), l.x), el('div', {}, el('small', {}, 'Y'), l.y), el('div', {}, el('small', {}, 'Z'), l.z)),
      f.pays ? el('p', { class: 'aide', style: 'margin:10px 0 0' }, drapeau(f.pays.code, f.pays.pays), ' ', f.pays.pays || '', l.ip ? ' · ' + l.ip : '') : null)
      : el('p', { class: 'vide' }, 'Hors ligne')));
}

// ------------------------------------------------------------------------------------------------- Menu, routes, entrée
function dessinerMenu(page) {
  $('menu').replaceChildren(...MENU.map((m) => (m.length === 1 ? el('div', { class: 'groupe' }, m[0])
    : el('a', { href: '#/' + m[0], class: (page === m[0] || (page === 'joueur' && m[0] === 'joueurs') ? 'actif' : '') + (moi.niveau < m[3] ? ' bloque' : '') }, el('span', {}, m[1]), m[2]))));
}
async function router() {
  if (minuterie) { clearInterval(minuterie); minuterie = null; }
  const [, page, a, b] = (location.hash || '#/accueil').split('/');
  const p = PAGES[page] ? page : 'accueil';
  const min = (MENU.find((m) => m[0] === p) || [0, 0, 0, 1])[3];
  dessinerMenu(p);
  if (moi.niveau < min) return vue().replaceChildren(carte(null, 'Ton rôle ne donne pas accès à cette page.'));
  vue().replaceChildren(el('p', { class: 'vide' }, 'Chargement…'));
  await PAGES[p](a, b);
}
function rechercheHaut() {
  const ch = $('recherche'), sug = $('suggestions');
  let t = null;
  ch.addEventListener('input', () => {
    clearTimeout(t);
    t = setTimeout(async () => {
      if (!ch.value.trim()) return sug.classList.add('cache');
      const r = await api('mod/liste', { recherche: ch.value.trim() });
      const l = (r.joueurs || []).slice(0, 8);
      sug.replaceChildren(...l.map((j) => el('a', { href: '#/joueur/' + encodeURIComponent(j.pseudo), onclick: () => { sug.classList.add('cache'); ch.value = ''; } },
        teteMini(j.pseudo), j.pseudo, j.enLigne ? el('span', { class: 'vert' }, ' ●') : null)));
      sug.classList.toggle('cache', !l.length);
    }, 200);
  });
  ch.addEventListener('keydown', (e) => { if (e.key === 'Enter' && ch.value.trim()) { nav('#/joueurs/' + encodeURIComponent(ch.value.trim())); sug.classList.add('cache'); } });
  document.addEventListener('click', (e) => { if (!e.target.closest('.recherche')) sug.classList.add('cache'); });
}
PAGES.joueurs = ((f) => (a) => f(null, a ? decodeURIComponent(a) : ''))(PAGES.joueurs);

async function entrer() {
  moi = await api('mod/moi');
  if (moi.erreur || !moi.niveau) return montrerConnexion();
  $('ecran-connexion').classList.add('cache');
  $('appli').classList.remove('cache');
  $('qui').replaceChildren(teteMini(moi.pseudo, 24), el('span', {}, moi.pseudo + ' · ' + moi.nomRole),
    el('button', { onclick: async () => { await api('deconnexion'); Session.ecrire(null); location.reload(); } }, 'Déconnexion'));
  rechercheHaut();
  window.addEventListener('hashchange', router);
  router();
}
function montrerConnexion() {
  Session.ecrire(null);
  $('appli').classList.add('cache');
  $('ecran-connexion').classList.remove('cache');
}
document.addEventListener('DOMContentLoaded', () => {
  $('form-connexion').onsubmit = async (e) => {
    e.preventDefault();
    $('c-valider').disabled = true;
    const r = await api('mod/connexion', { pseudo: $('c-pseudo').value.trim(), motdepasse: $('c-mdp').value });
    $('c-valider').disabled = false;
    if (r.erreur) return message($('c-msg'), r.erreur);
    Session.ecrire(r.session);
    entrer();
  };
  if (S()) entrer(); else montrerConnexion();
});
