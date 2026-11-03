// Interface du launcher (pas d'accès à Node : tout passe par window.onyx).
const $ = (id) => document.getElementById(id);
let profil = null;
let enCours = false;
let infos = null;

function etat(texte, part, erreur) {
  $('etat').textContent = texte || '';
  $('etat').classList.toggle('erreur', !!erreur);
  const barre = $('progression');
  if (part === undefined || part === null || !enCours) {
    barre.classList.add('cache');
  } else {
    barre.classList.remove('cache');
    $('barre').style.width = Math.round(Math.max(0, Math.min(1, part)) * 100) + '%';
  }
}

function afficherCompte(p) {
  profil = p;
  $('sans-compte').classList.toggle('cache', !!p);
  $('avec-compte').classList.toggle('cache', !p);
  if (p) {
    $('pseudo').textContent = p.pseudo;
    $('tete').src = `https://mc-heads.net/avatar/${p.uuid}/84`;
  }
  $('jouer').disabled = !p || enCours;
}

function echapper(t) {
  const d = document.createElement('div');
  d.textContent = t == null ? '' : String(t);
  return d.innerHTML;
}

async function chargerActus() {
  const liste = await window.onyx.actualites();
  const zone = $('actus');
  if (!Array.isArray(liste) || liste.length === 0) {
    zone.innerHTML = '<p class="vide">Pas d\'actualité pour le moment.</p>';
    return;
  }
  zone.innerHTML = liste.slice(0, 10).map((a, i) => `
    <article class="actu">
      <span class="date">${echapper(a.date)}</span>
      <h3>${echapper(a.titre)}</h3>
      <p>${echapper(a.texte)}${a.lien ? ` <a data-i="${i}">En savoir plus</a>` : ''}</p>
    </article>`).join('');
  zone.querySelectorAll('a[data-i]').forEach((el) => {
    el.addEventListener('click', () => window.onyx.ouvrir(liste[el.dataset.i].lien));
  });
}

async function chargerStatut() {
  const s = await window.onyx.statut();
  $('pastille').className = 'pastille ' + (s.enLigne ? 'ok' : 'ko');
  $('statut').textContent = s.enLigne ? `${s.joueurs} / ${s.max} joueurs en ligne` : 'Serveur hors ligne ou injoignable';
}

function ouvrirReglages() {
  const r = infos.reglages;
  $('ram').max = Math.max(4, Math.min(16, infos.memoireMax));
  $('ram').value = r.ram;
  $('ram-valeur').textContent = r.ram;
  $('garder').checked = !!r.garderOuvert;
  $('direct').checked = !!r.connexionDirecte;
  $('reglages').classList.remove('cache');
}

async function demarrer() {
  infos = await window.onyx.infos();
  $('version').textContent = 'v' + infos.version;

  $('reduire').onclick = () => window.onyx.fenetre('reduire');
  $('fermer').onclick = () => window.onyx.fenetre('fermer');
  $('site').onclick = () => window.onyx.ouvrir(infos.site);
  $('discord').onclick = () => window.onyx.ouvrir(infos.discord);
  $('ouvrir-reglages').onclick = ouvrirReglages;
  $('ram').oninput = () => ($('ram-valeur').textContent = $('ram').value);
  $('dossier').onclick = () => window.onyx.ouvrirDossier();
  $('fermer-reglages').onclick = async () => {
    infos.reglages = await window.onyx.sauverReglages({
      ram: $('ram').value,
      garderOuvert: $('garder').checked,
      connexionDirecte: $('direct').checked,
    });
    $('reglages').classList.add('cache');
  };

  $('connecter').onclick = async () => {
    $('connecter').disabled = true;
    etat('Connexion à Microsoft…');
    const r = await window.onyx.connecter();
    $('connecter').disabled = false;
    if (r.profil) {
      afficherCompte(r.profil);
      etat('');
    } else {
      etat(r.annule ? '' : r.erreur, null, !r.annule);
    }
  };
  $('deconnecter').onclick = async () => {
    await window.onyx.deconnecter();
    afficherCompte(null);
  };

  $('jouer').onclick = async () => {
    if (!profil || enCours) return;
    enCours = true;
    $('jouer').disabled = true;
    $('jouer').textContent = 'PRÉPARATION…';
    etat('Préparation…', 0);
    const r = await window.onyx.jouer();
    if (r.erreur) {
      enCours = false;
      $('jouer').disabled = false;
      $('jouer').textContent = 'JOUER';
      etat(r.erreur, null, true);
    }
  };

  window.onyx.surEtat((d) => {
    if (d.lance) $('jouer').textContent = 'EN JEU';
    if (d.fini) {
      enCours = false;
      $('jouer').textContent = 'JOUER';
      $('jouer').disabled = !profil;
      etat(d.texte, null, !!d.texte);
      return;
    }
    etat(d.texte, d.part);
  });
  window.onyx.surMaj((d) => {
    $('maj').textContent = d.texte;
    $('maj').classList.remove('cache');
  });

  etat('Connexion au compte…');
  afficherCompte(await window.onyx.reprendre());
  etat('');
  chargerActus();
  chargerStatut();
  setInterval(chargerStatut, 60000);
}

demarrer();
