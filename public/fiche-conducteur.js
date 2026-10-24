/* Soft Moto — fiche conducteur : VIDANGE (décompte de 14 jours depuis le jour du paiement) + REDEVANCE (paiements). */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var MOIS_FR = ['janvier','février','mars','avril','mai','juin','juillet','août','septembre','octobre','novembre','décembre'];
  var MOIS_COURT = ['janv.','févr.','mars','avr.','mai','juin','juil.','août','sept.','oct.','nov.','déc.'];

  function initials(n) { return n.trim().split(/\s+/).slice(0, 2).map(function (w) { return w[0].toUpperCase(); }).join(''); }
  function avatarClass(n) { var h = 0; for (var i = 0; i < n.length; i++) h = (h * 31 + n.charCodeAt(i)) >>> 0; return 'av-' + (1 + (h % 6)); }
  function pad(n) { return String(n).padStart(2, '0'); }
  function iso(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function court(d) { return d.getDate() + ' ' + MOIS_COURT[d.getMonth()]; }
  function fcfa(n) { return Math.round(n).toLocaleString('fr-FR') + ' F'; }
  function normaliser(v) { return v.trim().toUpperCase().replace(/\s+/g, ''); }
  function api(url, opts) {
    return fetch(url, opts).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (data) {
        if (r.status === 401) { window.location.href = 'login.html'; throw new Error('Session expirée.'); }
        if (!r.ok) throw new Error(data.erreur || 'Erreur serveur.');
        return data;
      });
    });
  }
  function aller(url) { if (window.smGo) window.smGo(url); else window.location.href = url; }

  /* ---------- Session, fuseau, mode caissière ---------- */
  var FUSEAU = 'Africa/Porto-Novo';
  var configPrete = api('/api/config').then(function (c) { FUSEAU = c.fuseau || FUSEAU; }).catch(function () {});
  function aujourdhui() {
    try {
      var p = new Intl.DateTimeFormat('en-CA', { timeZone: FUSEAU }).format(new Date()).split('-').map(Number);
      return new Date(p[0], p[1] - 1, p[2]);
    } catch (e) { var n = new Date(); return new Date(n.getFullYear(), n.getMonth(), n.getDate()); }
  }

  api('/api/moi').then(function (moi) {
    var admin = moi.role === 'admin'; estAdmin = admin; monId = moi.id; if (obs) afficherObs();
    document.querySelectorAll('.sidebar-profile').forEach(function (bloc) {
      var av = bloc.querySelector('.avatar'); if (av) { av.textContent = initials(moi.nom); av.className = 'avatar ' + avatarClass(moi.nom); }
      var nm = bloc.querySelector('.name'); if (nm) nm.textContent = moi.nom;
      var rl = bloc.querySelector('.role'); if (rl) rl.textContent = admin ? 'Administrateur' : 'Caissière';
    });
    if (!admin) {
      $('app').classList.add('solo');
      $('soloNom').textContent = moi.nom;
      $('backLink').setAttribute('href', 'caissiere.html');
      $('backText').textContent = 'Ma tournée';
    }
  }).catch(function () {});

  var logout = function (e) { e.preventDefault(); fetch('/api/deconnexion', { method: 'POST' }).finally(function () { window.location.href = 'login.html'; }); };
  if ($('logoutLink')) $('logoutLink').addEventListener('click', logout);
  $('soloLogout').addEventListener('click', logout);
  $('menuToggle').addEventListener('click', function () { $('sidebar').classList.toggle('open'); });

  /* ---------- État ---------- */
  var client = null, paiements = {}, vid = null, MONTANT_VID = 100, periodes = [], periodeChoisie = -1, viewY = 0, viewM = 0;

  // Un jour compte dans le suivi entre l'inscription (ou début de contrat) et la fin du contrat, jusqu'à aujourd'hui.
  function dansSuivi(d, auj) {
    var k = iso(d);
    var debut = ((client.date_debut || client.date_creation) || '').slice(0, 10);
    var fin = (client.date_fin || '').slice(0, 10);
    return d <= auj && (!debut || k >= debut) && (!fin || k <= fin);
  }

  /* ---------- Redevance par semaine / par mois : périodes du contrat ---------- */
  function freq() { return (client && client.frequence) || 'jour'; }
  function addJ(s, n) { var d = new Date(s + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
  function diffJ(a, b) { return Math.round((new Date(b + 'T00:00:00Z') - new Date(a + 'T00:00:00Z')) / 86400000); }
  function debutMois(debut, k) {
    var a = debut.split('-').map(Number), total = (a[1] - 1) + k;
    var an = a[0] + Math.floor(total / 12), mo = ((total % 12) + 12) % 12;
    var dernier = new Date(Date.UTC(an, mo + 1, 0)).getUTCDate();
    return an + '-' + pad(mo + 1) + '-' + pad(Math.min(a[2], dernier));
  }
  function periodesDe(jusqua) {
    var f = freq(), debut = ((client.date_debut || client.date_creation) || '').slice(0, 10), out = [];
    if (f === 'jour' || !debut) return out;
    var finC = (client.date_fin || '').slice(0, 10);
    for (var k = 0; k < 1500; k++) {
      var d = f === 'semaine' ? addJ(debut, 7 * k) : debutMois(debut, k);
      if (d > jusqua || (finC && d > finC)) break;
      var suivant = f === 'semaine' ? addJ(debut, 7 * (k + 1)) : debutMois(debut, k + 1);
      var finPleine = addJ(suivant, -1), fin = finC && finC < finPleine ? finC : finPleine;
      out.push({ index: k, debut: d, fin: fin, jours: diffJ(d, fin) + 1, joursPleins: diffJ(d, finPleine) + 1 });
    }
    return out;
  }
  function dueDe(p) { var c = client.montant_journalier_effectif || 0; return p.jours < p.joursPleins ? Math.round(c * p.jours / p.joursPleins) : c; }
  function sommePeriode(p) { var t = 0; for (var k = p.debut; k <= p.fin; k = addJ(k, 1)) { var r = paiements[k]; if (r) t += r.montant || 0; } return t; }
  function jjmm(k) { var a = k.split('-'); return a[2] + '/' + a[1]; }
  var NOM_PERIODE = { semaine: 'semaine', mois: 'mois' };

  /* ---------- VIDANGE : décompte de 14 jours à partir du jour où le conducteur a payé ---------- */
  function dFR(s) { var a = String(s || '').split('-'); return a.length === 3 ? a[2] + '/' + a[1] + '/' + a[0] : ''; }
  function jours(n) { n = Math.abs(n); return n + ' jour' + (n > 1 ? 's' : ''); }
  function libelleVidange() {
    if (!vid || vid.statut === 'jamais') return '—';
    if (vid.statut === 'retard') return 'En retard de ' + jours(vid.jours_restants);
    if (vid.statut === 'aujourdhui') return 'Aujourd\'hui';
    return 'Dans ' + jours(vid.jours_restants);
  }
  function afficherVidange() {
    if (!vid) return;
    var s = vid.statut, delai = vid.delai || 14, ecoule = s === 'jamais' ? 0 : Math.min(delai, Math.max(0, delai - vid.jours_restants));
    var titre, sous;
    if (s === 'jamais') { titre = 'Aucune vidange payée'; sous = 'Le décompte de ' + delai + ' jours démarrera le jour où le conducteur paiera sa première vidange.'; }
    else if (s === 'retard') { titre = 'Vidange en retard de ' + jours(vid.jours_restants); sous = 'Elle était due le ' + dFR(vid.prochaine) + ' (dernière payée le ' + dFR(vid.derniere) + ').'; }
    else if (s === 'aujourdhui') { titre = 'Vidange à faire aujourd\'hui'; sous = 'Dernière payée le ' + dFR(vid.derniere) + ' : les ' + delai + ' jours sont écoulés.'; }
    else { titre = 'Prochaine vidange dans ' + jours(vid.jours_restants); sous = 'Due le ' + dFR(vid.prochaine) + ' (dernière payée le ' + dFR(vid.derniere) + ').'; }
    $('vidStatus').className = 'vid-card ' + (s === 'jamais' ? '' : s);
    $('vidStatus').innerHTML = '<p class="v-big">' + titre + '</p><p class="v-sub">' + sous + '</p>' +
      (s === 'jamais' ? '' : '<div class="vid-bar"><i style="width:' + Math.round(ecoule / delai * 100) + '%"></i></div>');
    $('vidHist').innerHTML = vid.lignes.length ? vid.lignes.map(function (l) {
      return '<li><strong>' + dFR(l.date_paiement) + '</strong><span>' + fcfa(l.montant) + '</span><span class="vh-next">prochaine : ' + dFR(l.prochaine) + '</span>' +
        '<button type="button" data-id="' + l.id + '" data-date="' + l.date_paiement + '">Annuler</button></li>';
    }).join('') : '<li><span class="vh-next">Aucune vidange enregistrée pour le moment.</span></li>';
    var archive = client && client.statut === 'suspendu';
    $('vidForm').style.display = archive ? 'none' : '';
    if (archive) $('vidError').textContent = 'Ce conducteur est suspendu (archivé) : les paiements sont désactivés.';
  }
  function construirePeriodes() { /* ancien découpage en 24 périodes supprimé */ }
  function afficherPeriodes() { afficherVidange(); }

  function afficherKpis(anime) {
    var an = String(aujourdhui().getFullYear());
    var total = Object.keys(paiements).reduce(function (t, k) { return k.slice(0, 4) === an ? t + (paiements[k].montant || 0) : t; }, 0);
    var auj = iso(aujourdhui()), impayes = 0;
    if (freq() === 'jour') {
      // jours suivis (début du contrat -> aujourd'hui, borné par la fin) sans paiement complet
      var debut = ((client.date_debut || client.date_creation) || '').slice(0, 10), fin = (client.date_fin || '').slice(0, 10);
      var dernier = fin && fin < auj ? fin : auj;
      for (var k = debut, n = 0; debut && k <= dernier && n < 4000; k = addJ(k, 1), n++) { var r = paiements[k]; if (!(r && r.paye)) impayes++; }
      $('kUnpaidLabel').textContent = 'Jours impayés';
    } else {
      // semaines / mois terminés dont la somme versée n'atteint pas le montant dû
      impayes = periodesDe(auj).filter(function (p) { return p.fin < auj && sommePeriode(p) < dueDe(p); }).length;
      $('kUnpaidLabel').textContent = freq() === 'semaine' ? 'Semaines impayées' : 'Mois impayés';
    }
    // Visiteur (Journée payée) pendant ses 13 premiers jours : rien n'est encore un impayé (il le devient au 14e jour).
    if (client.sursis) { impayes = 0; $('kUnpaidLabel').textContent = 'Impayés · sursis (jour ' + client.jour_precontrat + '/13)'; }
    var entier = function (n) { return String(Math.round(n)); };
    if (anime && window.smCountUp) {
      window.smCountUp($('kPaid'), total, { format: fcfa });
      window.smCountUp($('kUnpaid'), impayes, { format: entier });
      $('kDone').textContent = libelleVidange();
    } else {
      $('kPaid').textContent = fcfa(total); $('kUnpaid').textContent = impayes; $('kDone').textContent = libelleVidange();
    }
  }

  /* ---------- REDEVANCE : calendrier du mois (partie caissière) ---------- */
  var calGrid = $('calGrid');
  function contenuJour(day, p, dateKey) {
    var paye = !!(p && p.paye), futur = !!dateKey && dateKey > iso(aujourdhui());
    return '<span class="num">' + day + '</span><span aria-hidden="true">' + (paye ? '✓' : (futur || (client && client.sursis)) ? '…' : '✗') + '</span>' +
      (p && p.montant > 0 ? '<span class="amt">' + p.montant.toLocaleString('fr-FR') + '</span>' : '') +
      (p && p.montant > 0 && p.moyen ? '<span class="mv" style="display:block;font-size:9.5px;font-weight:700;opacity:.9;line-height:1.1">' + ({ especes: 'ESP', momo: 'MOMO', momo_regulateur: 'RÉG' })[p.moyen] + '</span>' : '') +
      (p && p.regle_le ? '<span class="rg" style="display:block;font-size:9px;font-weight:600;opacity:.85;line-height:1.1">' + (dateKey && p.regle_le < dateKey ? 'payé d\'avance le ' : 'réglé le ') + p.regle_le.split('-').reverse().join('/') + '</span>' : '');
  }
  function majCellule(cell, p) {
    var day = Number(cell.dataset.date.split('-')[2]), paye = !!(p && p.paye), futur = cell.dataset.date > iso(aujourdhui());
    // Jour à venir partiellement payé d'avance : ni payé ni impayé (orange)
    var sursis = !!(client && client.sursis);
    cell.classList.toggle('paid', paye); cell.classList.toggle('unpaid', !paye && !futur && !sursis); cell.classList.toggle('wait', !paye && !futur && sursis); cell.classList.toggle('advance', !paye && futur);
    cell.innerHTML = contenuJour(day, p, cell.dataset.date);
    cell.setAttribute('aria-label', day + ' ' + MOIS_FR[viewM] + ' : ' + (paye ? 'payé' + (p.regle_le && p.regle_le < cell.dataset.date ? ' d\'avance' : '') + ', ' + p.montant.toLocaleString('fr-FR') + ' F' : futur ? 'avance partielle' : 'non payé'));
  }
  // Dernier mois à afficher : le mois en cours, ou plus tard si des jours ont été payés d'avance.
  function moisMax() {
    var auj = aujourdhui(), m = auj.getFullYear() * 12 + auj.getMonth();
    Object.keys(paiements).forEach(function (k) { var a = k.split('-').map(Number), v = a[0] * 12 + (a[1] - 1); if (v > m && paiements[k].montant > 0) m = v; });
    return m;
  }
  function minMois() {
    var s = ((client.date_debut || client.date_creation) || '').slice(0, 7);
    if (s) { var a = s.split('-').map(Number); return a[0] * 12 + (a[1] - 1); }
    return aujourdhui().getFullYear() * 12;
  }

  function renderCalendar() {
    if (!client) return;
    var y = viewY, m = viewM, auj = aujourdhui();
    var moisCourant = y === auj.getFullYear() && m === auj.getMonth();
    $('calTitle').textContent = MOIS_FR[m] + ' ' + y;
    $('nextMonthBtn').disabled = (y * 12 + m) >= moisMax();
    $('prevMonthBtn').disabled = (y * 12 + m) <= minMois();
    calGrid.querySelectorAll('.cal-day, .cal-empty').forEach(function (el) { el.remove(); });

    var decalage = (new Date(y, m, 1).getDay() + 6) % 7; // 0 = lundi
    for (var e = 0; e < decalage; e++) { var vide = document.createElement('div'); vide.className = 'cal-empty'; calGrid.appendChild(vide); }
    var dernier = new Date(y, m + 1, 0).getDate();
    var per = null;

    for (var day = 1; day <= dernier; day++) {
      var d = new Date(y, m, day), k = iso(d), p = paiements[k];
      var cell = document.createElement('button');
      cell.type = 'button'; cell.className = 'cal-day'; cell.dataset.date = k;
      if (d.getTime() === auj.getTime()) cell.classList.add('today');
      if (per && d >= per.debut && d <= per.fin) cell.classList.add('in-periode');
      if (!(p && p.montant > 0) && !dansSuivi(d, auj)) {
        cell.classList.add('future'); cell.disabled = true;
        cell.innerHTML = '<span class="num">' + day + '</span>';
      } else {
        majCellule(cell, p);
        cell.addEventListener('click', (function (c) { return function () { ouvrirModal(c); }; })(cell));
      }
      calGrid.appendChild(cell);
    }
    totaux();
  }

  function totaux() {
    var cible = client ? client.montant_journalier_effectif : 0;
    var pa = 0, pj = 0, ua = 0, uj = 0;
    calGrid.querySelectorAll('.cal-day.paid, .cal-day.unpaid').forEach(function (c) {
      var p = paiements[c.dataset.date], mt = p ? p.montant : 0;
      if (c.classList.contains('paid')) { pa += mt; pj++; } else { ua += Math.max(0, cible - mt); uj++; }
    });
    $('paidAmount').textContent = fcfa(pa); $('unpaidAmount').textContent = fcfa(ua);
    $('paidCount').textContent = pj + (pj > 1 ? ' jours' : ' jour'); $('unpaidCount').textContent = uj + (uj > 1 ? ' jours' : ' jour');
  }

  function changerMois(delta) {
    calGrid.style.transition = 'opacity .15s ease, transform .15s ease';
    calGrid.style.opacity = '0'; calGrid.style.transform = 'translateX(' + (delta > 0 ? 8 : -8) + 'px)';
    setTimeout(function () {
      viewM += delta;
      if (viewM < 0) { viewM = 11; viewY -= 1; }
      if (viewM > 11) { viewM = 0; viewY += 1; }
      renderCalendar();
      requestAnimationFrame(function () { calGrid.style.opacity = ''; calGrid.style.transform = ''; });
    }, 140);
  }
  $('prevMonthBtn').addEventListener('click', function () { if (!$('prevMonthBtn').disabled) changerMois(-1); });
  $('nextMonthBtn').addEventListener('click', function () { if (!$('nextMonthBtn').disabled) changerMois(1); });

  /* ---------- REDEVANCE : par jour (calendrier) ou par semaine / mois (cartes) ---------- */
  function renderRedevance() {
    if (!client) return;
    var nonJour = freq() !== 'jour', nom = NOM_PERIODE[freq()];
    $('vueJour').style.display = nonJour ? 'none' : ''; $('vuePeriodes').style.display = nonJour ? '' : 'none';
    $('rTitre').textContent = nonJour ? 'Redevance : paiements par ' + nom : 'Redevance : paiements jour par jour';
    $('rSub').textContent = nonJour
      ? 'Ce conducteur paie par ' + nom + ' : ' + fcfa(client.montant_journalier_effectif) + '. Enregistrez chaque versement dans la période concernée ; elle est payée quand la somme atteint ce montant.'
      : 'Touchez un jour pour enregistrer le montant remis.';
    if (nonJour) renderPeriodesRedevance(); else renderCalendar();
  }
  var MOY = { especes: 'Espèces', momo: 'MOMO', momo_regulateur: 'MOMO régularisation' };
  function renderPeriodesRedevance() {
    var auj = iso(aujourdhui()), nom = freq() === 'semaine' ? 'Semaine' : 'Mois';
    // les 2 prochaines périodes du contrat peuvent être payées d'avance
    var avenir = periodesDe(addJ(auj, 400)).filter(function (p) { return p.debut > auj; }).slice(0, 2);
    var l = periodesDe(auj).concat(avenir).reverse();
    if (!l.length) { $('perList').innerHTML = '<p class="desc">Aucune période : vérifiez la date de début du contrat de ce conducteur.</p>'; return; }
    $('perList').innerHTML = l.map(function (p) {
      var verse = sommePeriode(p), due = dueDe(p), complete = verse >= due, terminee = p.fin < auj;
      var futur = p.debut > auj;
      var etat = complete ? 'paid' : terminee ? 'unpaid' : futur ? 'future' : 'due';
      var badge = complete ? (futur ? 'Payé d\'avance' : 'Payé') : terminee ? (client.sursis ? 'En attente' : (verse > 0 ? 'Partiel · impayé' : 'Impayé')) : futur ? (verse > 0 ? 'Avance partielle' : 'À venir') : 'En cours';
      var lignes = [];
      for (var k = p.debut; k <= p.fin; k = addJ(k, 1)) {
        var r = paiements[k];
        if (r && r.montant > 0) lignes.push('<li><span>' + jjmm(k) + '</span><strong>' + fcfa(r.montant) + '</strong><span>' + (MOY[r.moyen] || '') + '</span><button type="button" data-date="' + k + '" data-index="' + p.index + '">Modifier</button></li>');
      }
      return '<div class="per-card ' + etat + '"><div class="per-head"><strong>' + nom + ' ' + (p.index + 1) + '</strong>' +
        '<span class="per-dates">du ' + jjmm(p.debut) + ' au ' + jjmm(p.fin) + '</span><span class="per-badge ' + etat + '">' + badge + '</span></div>' +
        '<div class="per-bar"><i style="width:' + Math.min(100, Math.round(verse / Math.max(1, due) * 100)) + '%"></i></div>' +
        '<div class="per-amt">' + fcfa(verse) + ' / ' + fcfa(due) + '</div>' +
        (lignes.length ? '<ul class="per-lines">' + lignes.join('') + '</ul>' : '') +
        '<button type="button" class="c-btn ghost per-add" data-index="' + p.index + '">' + (futur ? 'Payer d\'avance' : 'Enregistrer un versement') + '</button></div>';
    }).join('');
  }
  $('perList').addEventListener('click', function (e) {
    var b = e.target.closest('button'); if (!b) return;
    var auj = iso(aujourdhui()), p = periodesDe(addJ(auj, 400))[Number(b.dataset.index)]; if (!p) return;
    ouvrirModalPeriode(p, b.dataset.date || (p.debut > auj ? p.debut : (auj >= p.debut && auj <= p.fin ? auj : p.fin)));
  });

  /* ---------- Onglets ---------- */
  function placerPastille() {
    var actif = document.querySelector('.tabs button[aria-selected="true"]'), pill = $('tabPill');
    if (!actif) return;
    pill.style.width = actif.offsetWidth + 'px';
    pill.style.transform = 'translateX(' + (actif.offsetLeft - 4) + 'px)';
  }
  function basculer(nom) {
    var vid = nom === 'vidange', red = nom === 'redevance', con = nom === 'contrat', ob = nom === 'obs';
    $('tabVidange').setAttribute('aria-selected', vid); $('tabRedevance').setAttribute('aria-selected', red); $('tabContrat').setAttribute('aria-selected', con); $('tabObs').setAttribute('aria-selected', ob);
    $('panelVidange').classList.toggle('show', vid); $('panelRedevance').classList.toggle('show', red); $('panelContrat').classList.toggle('show', con); $('panelObs').classList.toggle('show', ob);
    placerPastille();
    if (red) renderRedevance();
    if (con) renderContrat();
  }
  $('tabVidange').addEventListener('click', function () { basculer('vidange'); });
  $('tabRedevance').addEventListener('click', function () { basculer('redevance'); });
  $('tabContrat').addEventListener('click', function () { basculer('contrat'); });
  if (window.smContrat && smContrat.pret) smContrat.pret.then(function () { if (client) renderContrat(); });
  $('tabObs').addEventListener('click', function () { basculer('obs'); });

  /* ---------- Observations (commentaires sur le conducteur) ---------- */
  var obs = null, monId = null;
  function dateHeure(isoStr) {
    try { return new Intl.DateTimeFormat('fr-FR', { timeZone: FUSEAU, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(isoStr)); }
    catch (e) { return isoStr; }
  }
  function echapper(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function afficherObs() {
    if (!obs) return;
    $('tabObs').textContent = 'Observations' + (obs.length ? ' (' + obs.length + ')' : ''); placerPastille();
    $('obsList').innerHTML = obs.length ? obs.map(function (o) {
      var peut = estAdmin || o.compte_id === monId;
      return '<li><div class="o-meta"><strong>' + echapper(o.auteur || 'Inconnu') + '</strong><span>' + dateHeure(o.cree_le) + '</span>' +
        (peut ? '<button type="button" data-id="' + o.id + '">Supprimer</button>' : '') + '</div><p class="o-txt">' + echapper(o.texte) + '</p></li>';
    }).join('') : '<li><span class="o-meta">Aucune observation pour le moment.</span></li>';
  }
  function chargerObs() {
    if (!client) return;
    api('/api/observations?code_client=' + encodeURIComponent(client.code)).then(function (l) { obs = l; afficherObs(); }).catch(function () {});
  }
  $('obsAdd').addEventListener('click', function () {
    var btn = this, t = $('obsTexte').value.trim(); $('obsError').textContent = '';
    if (t.length < 2) { $('obsError').textContent = "Écrivez l'observation."; return; }
    btn.disabled = true;
    api('/api/observations', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code_client: client.code, texte: t }) })
      .then(function (l) { obs = l; $('obsTexte').value = ''; afficherObs(); if (window.smToast) smToast('Observation ajoutée.'); })
      .catch(function (err) { $('obsError').textContent = window.smMessage ? smMessage(err) : err.message; })
      .finally(function () { btn.disabled = false; });
  });
  $('obsList').addEventListener('click', function (e) {
    var b = e.target.closest('button'); if (!b) return;
    if (!window.confirm('Supprimer cette observation ?')) return;
    api('/api/observations/' + encodeURIComponent(b.dataset.id), { method: 'DELETE' })
      .then(function (l) { obs = l; afficherObs(); })
      .catch(function (err) { alert(window.smMessage ? smMessage(err) : err.message); });
  });

  /* ---------- Contrat du conducteur ---------- */
  var typeAffiche = null, estAdmin = false;
  function renderContrat() {
    if (!client || !window.smContrat) return;
    var enregistre = smContrat.typeDe(client), t = typeAffiche || enregistre;
    $('contratNo').textContent = client.code;
    document.querySelectorAll('#ficheTypeRow button').forEach(function (b) {
      b.classList.toggle('on', b.dataset.type === t); b.setAttribute('aria-pressed', b.dataset.type === t);
    });
    var sans = !client.type_contrat;
    $('contratNote').textContent = t === enregistre
      ? (sans ? 'Aucun type n’a été enregistré pour ce conducteur : le contrat JOURNÉE PAYÉE est affiché par défaut.' : 'Contrat enregistré pour ce conducteur.')
      : 'Aperçu : ce n’est pas le type enregistré pour ce conducteur (' + smContrat.TYPES[enregistre].label + ').';
    $('contratSave').style.display = estAdmin && (t !== enregistre || sans) ? '' : 'none';
    $('freqBloc').style.display = estAdmin ? '' : 'none';
    document.querySelectorAll('#ficheFreqRow button').forEach(function (b) { b.classList.toggle('on', b.dataset.freq === freq()); b.setAttribute('aria-pressed', b.dataset.freq === freq()); });
    $('contratFeuille').innerHTML = smContrat.corps(client, t);
  }
  $('ficheTypeRow').addEventListener('click', function (e) {
    var b = e.target.closest('button'); if (!b) return;
    typeAffiche = b.dataset.type; renderContrat();
  });
  $('ficheFreqRow').addEventListener('click', function (e) {
    var b = e.target.closest('button'); if (!b || b.dataset.freq === freq()) return;
    var nom = { jour: 'par jour', semaine: 'par semaine', mois: 'par mois' }[b.dataset.freq];
    if (!window.confirm('Faire payer ' + client.nom + ' ' + nom + ' ?\n\nLe montant de base (' + fcfa(client.montant_journalier_effectif) + ') devient le montant d\'une période. Les paiements déjà saisis ne sont pas modifiés.')) return;
    api('/api/clients/' + client.id, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ frequence: b.dataset.freq }) })
      .then(function (c) {
        client.frequence = c.frequence; afficherKpis(false); renderContrat();
        if (window.smToast) smToast('Paiement ' + nom + ' enregistré.');
      })
      .catch(function (err) { alert(window.smMessage ? smMessage(err) : 'Enregistrement impossible.'); });
  });
  $('contratDl').addEventListener('click', function () { smContrat.telecharger(client, typeAffiche || smContrat.typeDe(client)); });
  $('contratPrint').addEventListener('click', function () { smContrat.imprimer(client, typeAffiche || smContrat.typeDe(client)); });
  $('contratSave').addEventListener('click', function () {
    var t = typeAffiche || smContrat.typeDe(client), btn = this; btn.disabled = true;
    api('/api/clients/' + client.id, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type_contrat: t }) })
      .then(function (c) { client.type_contrat = c.type_contrat; typeAffiche = null; renderContrat(); if (window.smToast) smToast('Type de contrat enregistré.'); })
      .catch(function (err) { alert(window.smMessage ? smMessage(err) : 'Enregistrement impossible.'); })
      .finally(function () { btn.disabled = false; });
  });
  window.addEventListener('resize', placerPastille);

  // Vidange : enregistrer le paiement (le décompte de 14 jours repart de cette date) ou l'annuler
  function majVidange(d, message) {
    vid = d; MONTANT_VID = d.montant; $('vidMontant').textContent = fcfa(MONTANT_VID);
    afficherVidange(); afficherKpis(false);
    if (message && window.smToast) smToast(message);
  }
  $('vidPayBtn').addEventListener('click', function () {
    var btn = this, date = $('vidDate').value; $('vidError').textContent = ''; btn.disabled = true;
    api('/api/vidanges', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code_client: client.code, date: date || undefined }) })
      .then(function (d) { majVidange(d, 'Vidange payée : ' + fcfa(d.montant) + '. Prochaine vidange le ' + dFR(d.prochaine) + '.'); })
      .catch(function (err) { $('vidError').textContent = window.smMessage ? smMessage(err) : err.message; })
      .finally(function () { btn.disabled = false; });
  });
  $('vidHist').addEventListener('click', function (e) {
    var b = e.target.closest('button'); if (!b) return;
    if (!window.confirm('Annuler la vidange payée le ' + dFR(b.dataset.date) + ' ? Le décompte repartira de la vidange précédente.')) return;
    api('/api/vidanges/' + encodeURIComponent(b.dataset.id), { method: 'DELETE' })
      .then(function (d) { majVidange(d, 'Vidange annulée.'); })
      .catch(function (err) { alert(window.smMessage ? smMessage(err) : err.message); });
  });

  /* ---------- Modale : montant remis ---------- */
  var modal = $('amountModal'), ctx = null;
  // Ce qui manque sur les jours du contrat AVANT la date donnée (le surplus sert d'abord à les régler)
  function arrieresAvant(dateIso) {
    var debut = ((client.date_debut || client.date_creation) || '').slice(0, 10), fin = (client.date_fin || '').slice(0, 10), cible = client.montant_journalier_effectif, t = 0;
    for (var k = debut, n = 0; debut && k < dateIso && (!fin || k <= fin) && n < 4000; k = addJ(k, 1), n++) {
      var r = paiements[k]; if (!(r && r.paye)) t += Math.max(0, cible - (r ? Math.min(r.montant, cible) : 0));
    }
    return t;
  }
  function ouvrirModal(cell) {
    var existant = paiements[cell.dataset.date], cible = client.montant_journalier_effectif;
    var a = cell.dataset.date.split('-').map(Number);
    ctx = { cell: cell, date: cell.dataset.date, cible: cible };
    $('modalCibleLabel').textContent = 'Objectif du jour';
    $('modalDate').textContent = client.nom + ' — ' + a[2] + ' ' + MOIS_FR[a[1] - 1] + ' ' + a[0];
    $('modalCible').textContent = cible.toLocaleString('fr-FR') + ' F';
    $('amountInput').value = existant ? existant.montant : cible;
    smMoyenSet(existant ? existant.moyen : null);
    smNumeroSet(existant ? existant.numero_momo : null);
    smAvanceContexte({ actif: true, arrieres: arrieresAvant(cell.dataset.date), date: cell.dataset.date,
      note: existant && existant.regle_le && existant.regle_le < cell.dataset.date ? 'Ce jour est déjà payé d\'avance (versé le ' + jjmm(existant.regle_le) + ').' : '' });
    $('modalError').classList.remove('show'); $('amountInput').removeAttribute('data-invalid');
    modal.classList.add('show');
    setTimeout(function () { $('amountInput').focus(); $('amountInput').select(); }, 60);
  }
  // Paiement par semaine / mois : le versement se rattache à la période qui contient la date choisie.
  function ouvrirModalPeriode(p, dateIso) {
    var existant = paiements[dateIso], due = dueDe(p);
    var autres = sommePeriode(p) - (existant ? existant.montant : 0), reste = Math.max(0, due - autres);
    var a = dateIso.split('-').map(Number);
    ctx = { cell: null, date: dateIso, cible: due, complet: reste, periode: p };
    $('modalDate').textContent = client.nom + ' — ' + a[2] + ' ' + MOIS_FR[a[1] - 1] + ' ' + a[0] + (autres > 0 ? ' · déjà versé les autres jours de la période : ' + fcfa(autres) : '');
    $('modalCibleLabel').textContent = 'Montant de la ' + NOM_PERIODE[freq()];
    $('modalCible').textContent = due.toLocaleString('fr-FR') + ' F';
    $('amountInput').value = existant ? existant.montant : reste;
    smMoyenSet(existant ? existant.moyen : null);
    smNumeroSet(existant ? existant.numero_momo : null);
    smAvanceContexte({ actif: false, note: dateIso > iso(aujourdhui()) ? 'Paiement d\'avance : cette période n\'a pas encore commencé.' : '' });
    $('modalError').classList.remove('show'); $('amountInput').removeAttribute('data-invalid');
    modal.classList.add('show');
    setTimeout(function () { $('amountInput').focus(); $('amountInput').select(); }, 60);
  }
  function fermerModal() { modal.classList.remove('show'); ctx = null; }
  $('quickFullBtn').addEventListener('click', function () { $('amountInput').value = ctx ? (ctx.complet != null ? ctx.complet : ctx.cible) : 0; $('amountInput').focus(); });
  $('quickZeroBtn').addEventListener('click', function () { $('amountInput').value = 0; $('amountInput').focus(); });
  $('modalCancelBtn').addEventListener('click', fermerModal);
  modal.addEventListener('click', function (e) { if (e.target === modal) fermerModal(); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && modal.classList.contains('show')) fermerModal(); });
  $('amountInput').addEventListener('keydown', function (e) { if (e.key === 'Enter') enregistrer(); });

  function enregistrer() {
    if (!ctx) return;
    var c = ctx, montant = Math.round(Number($('amountInput').value));
    if (!isFinite(montant) || montant < 0) {
      $('amountInput').setAttribute('data-invalid', 'true');
      $('modalError').textContent = 'Entrez un montant valide.'; $('modalError').classList.add('show'); return;
    }
    var errNum = smNumeroErreur(montant);
    if (errNum) { $('modalError').textContent = errNum; $('modalError').classList.add('show'); return; }
    $('modalSaveBtn').disabled = true;
    api('/api/paiements', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code_client: client.code, date: c.date, montant: montant, moyen: smMoyenGet(), numero_momo: smNumeroGet() || undefined }) })
      .then(function (p) {
        paiements[c.date] = p;
        (p.ajustements || []).concat(p.avances || []).forEach(function (a) { paiements[a.date] = Object.assign({}, paiements[a.date] || {}, a); });
        if (c.cell) {
          majCellule(c.cell, p);
          if ((p.ajustements && p.ajustements.length) || (p.avances && p.avances.length)) renderCalendar();
          c.cell.classList.remove('just-toggled'); void c.cell.offsetWidth; c.cell.classList.add('just-toggled');
          totaux();
        } else {
          renderPeriodesRedevance();
        }
        afficherKpis(true);
        if (p.paye && window.smCelebrate) window.smCelebrate($('modalSaveBtn'));
        if ((p.reporte || (p.avances && p.avances.length)) && window.smToast) window.smToast(smReportMessage(p));
        else if (p.periode && window.smToast) window.smToast(p.periode.complete ? 'Période complète : ' + fcfa(p.periode.verse) + ' versés.' : 'Il reste ' + fcfa(p.periode.cible - p.periode.verse) + ' à payer pour cette période.');
        fermerModal();
      })
      .catch(function (err) { $('modalError').textContent = window.smMessage ? window.smMessage(err) : err.message; $('modalError').classList.add('show'); })
      .finally(function () { $('modalSaveBtn').disabled = false; });
  }
  $('modalSaveBtn').addEventListener('click', enregistrer);

  /* ---------- Chargement d'un conducteur ---------- */
  function erreurRecherche(msg) {
    $('rechError').textContent = msg; $('rechError').classList.add('show'); $('codeInput').setAttribute('data-invalid', 'true');
  }
  function charger(code) {
    var norm = normaliser(code); if (!norm) return;
    $('rechError').classList.remove('show'); $('codeInput').removeAttribute('data-invalid');
    var bouton = $('rechForm').querySelector('button'); bouton.disabled = true;

    Promise.all([configPrete, api('/api/clients/' + encodeURIComponent(norm))]).then(function (r) {
      client = r[1];
      // tout l'historique des paiements et des vidanges, en deux requêtes
      return Promise.all([api('/api/paiements?code_client=' + encodeURIComponent(client.code)), api('/api/vidanges?code_client=' + encodeURIComponent(client.code)),
        api('/api/clients/' + encodeURIComponent(client.code) + '/signatures').catch(function () { return {}; })]);
    }).then(function (r) {
      client.signature_conducteur = r[2].signature_conducteur || null; client.signature_temoin = r[2].signature_temoin || null;
      paiements = {}; r[0].forEach(function (p) { paiements[p.date] = p; });
      chargerObs();
      vid = r[1]; MONTANT_VID = vid.montant; $('vidMontant').textContent = fcfa(MONTANT_VID);
      $('vidDate').value = vid.aujourdhui; $('vidDate').max = vid.aujourdhui; $('vidError').textContent = '';

      $('dAvatar').textContent = initials(client.nom); $('dAvatar').className = 'avatar ' + avatarClass(client.nom);
      $('dName').textContent = client.nom; $('dCode').textContent = client.code;

      var auj = aujourdhui(); viewY = auj.getFullYear(); viewM = auj.getMonth();
      $('vide').style.display = 'none';
      var vue = $('ficheView'); vue.style.display = 'block';
      vue.classList.remove('sm-view-in'); void vue.offsetWidth; vue.classList.add('sm-view-in');
      typeAffiche = null;
      basculer('vidange'); afficherVidange(); afficherKpis(true);
      $('codeInput').value = client.code;
      history.replaceState(null, '', '?code=' + encodeURIComponent(client.code));
      document.title = client.nom + ' – Vidange & Redevance – Soft Moto';
    }).catch(function (err) {
      $('ficheView').style.display = 'none'; $('vide').style.display = '';
      erreurRecherche(window.smMessage ? window.smMessage(err) : err.message);
    }).finally(function () { bouton.disabled = false; });
  }

  $('rechForm').addEventListener('submit', function (e) { e.preventDefault(); charger($('codeInput').value); });
  $('codeInput').addEventListener('input', function () { $('rechError').classList.remove('show'); $('codeInput').removeAttribute('data-invalid'); });

  var codeUrl = new URLSearchParams(window.location.search).get('code');
  if (codeUrl) { $('codeInput').value = codeUrl; charger(codeUrl); } else { $('codeInput').focus(); }
})();
