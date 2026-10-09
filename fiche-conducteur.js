/* Soft Moto — fiche conducteur : VIDANGE (24 cases de 14 jours) + REDEVANCE (paiements jour par jour). */
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
    var admin = moi.role === 'admin'; estAdmin = admin;
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
  var client = null, paiements = {}, periodes = [], periodeChoisie = -1, viewY = 0, viewM = 0;

  // Un jour compte dans le suivi entre l'inscription (ou début de contrat) et la fin du contrat, jusqu'à aujourd'hui.
  function dansSuivi(d, auj) {
    var k = iso(d);
    var debut = ((client.date_debut || client.date_creation) || '').slice(0, 10);
    var fin = (client.date_fin || '').slice(0, 10);
    return d <= auj && (!debut || k >= debut) && (!fin || k <= fin);
  }

  /* ---------- VIDANGE : 24 périodes de 14 jours ---------- */
  function construirePeriodes() {
    var auj = aujourdhui(), annee = auj.getFullYear();
    periodes = [];
    for (var i = 0; i < 24; i++) {
      var debut = new Date(annee, 0, 1 + i * 14), fin = new Date(annee, 0, 1 + i * 14 + 13);
      var ecoules = 0, payes = 0, montant = 0;
      for (var j = 0; j < 14; j++) {
        var d = new Date(annee, 0, 1 + i * 14 + j), p = paiements[iso(d)];
        if (p) montant += p.montant;
        if (!dansSuivi(d, auj)) continue;
        ecoules++;
        if (p && p.paye) payes++;
      }
      var etat = debut > auj ? 'future' : 'none';
      if (ecoules > 0) etat = payes === ecoules ? 'paid' : payes === 0 ? 'unpaid' : 'part';
      periodes.push({ i: i, debut: debut, fin: fin, ecoules: ecoules, payes: payes, montant: montant, etat: etat, actuelle: auj >= debut && auj <= fin });
    }
  }

  function afficherPeriodes(cascade) {
    var libelle = { paid: 'Tout payé', part: 'Partiel', unpaid: 'Non payé', future: 'À venir', none: 'Hors contrat' };
    $('driverPeriods').innerHTML = periodes.map(function (p) {
      var inactif = p.ecoules === 0;
      return '<button type="button" class="period-box st-' + p.etat + (p.actuelle ? ' current' : '') + (p.i === periodeChoisie ? ' selected' : '') + '"' +
        ' data-i="' + p.i + '"' + (inactif ? ' disabled' : '') +
        ' aria-label="Période ' + (p.i + 1) + ', du ' + court(p.debut) + ' au ' + court(p.fin) + ' : ' + libelle[p.etat] + '">' +
        '<span class="p-num">N°' + (p.i + 1) + '</span>' +
        '<span class="p-range">' + court(p.debut) + ' – ' + court(p.fin) + '</span>' +
        '<span class="p-state">' + (inactif ? '—' : p.payes + '/' + p.ecoules + ' j') + '</span></button>';
    }).join('');
    if (cascade && window.smStagger) window.smStagger($('driverPeriods'), 24);
  }

  function afficherKpis(anime) {
    var an = String(aujourdhui().getFullYear());
    var total = Object.keys(paiements).reduce(function (t, k) { return k.slice(0, 4) === an ? t + (paiements[k].montant || 0) : t; }, 0);
    var impayes = periodes.reduce(function (t, p) { return t + (p.ecoules - p.payes); }, 0);
    var reglees = periodes.filter(function (p) { return p.etat === 'paid'; }).length;
    var entier = function (n) { return String(Math.round(n)); };
    if (anime && window.smCountUp) {
      window.smCountUp($('kPaid'), total, { format: fcfa });
      window.smCountUp($('kUnpaid'), impayes, { format: entier });
      window.smCountUp($('kDone'), reglees, { format: function (n) { return Math.round(n) + ' / 24'; } });
    } else {
      $('kPaid').textContent = fcfa(total); $('kUnpaid').textContent = impayes; $('kDone').textContent = reglees + ' / 24';
    }
    requestAnimationFrame(function () { $('kBar').style.setProperty('--p', reglees / 24); });
  }

  /* ---------- REDEVANCE : calendrier du mois (partie caissière) ---------- */
  var calGrid = $('calGrid');
  function contenuJour(day, p) {
    var paye = !!(p && p.paye);
    return '<span class="num">' + day + '</span><span aria-hidden="true">' + (paye ? '✓' : '✗') + '</span>' +
      (p && p.montant > 0 ? '<span class="amt">' + p.montant.toLocaleString('fr-FR') + '</span>' : '') +
      (p && p.montant > 0 && p.moyen ? '<span class="mv" style="display:block;font-size:9.5px;font-weight:700;opacity:.9;line-height:1.1">' + ({ especes: 'ESP', momo: 'MOMO', momo_regulateur: 'RÉG' })[p.moyen] + '</span>' : '') +
      (p && p.regle_le ? '<span class="rg" style="display:block;font-size:9px;font-weight:600;opacity:.85;line-height:1.1">réglé le ' + p.regle_le.split('-').reverse().join('/') + '</span>' : '');
  }
  function majCellule(cell, p) {
    var day = Number(cell.dataset.date.split('-')[2]), paye = !!(p && p.paye);
    cell.classList.toggle('paid', paye); cell.classList.toggle('unpaid', !paye);
    cell.innerHTML = contenuJour(day, p);
    cell.setAttribute('aria-label', day + ' ' + MOIS_FR[viewM] + ' : ' + (paye ? 'payé, ' + p.montant.toLocaleString('fr-FR') + ' F' : 'non payé'));
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
    $('nextMonthBtn').disabled = moisCourant;
    $('prevMonthBtn').disabled = (y * 12 + m) <= minMois();
    calGrid.querySelectorAll('.cal-day, .cal-empty').forEach(function (el) { el.remove(); });

    var decalage = (new Date(y, m, 1).getDay() + 6) % 7; // 0 = lundi
    for (var e = 0; e < decalage; e++) { var vide = document.createElement('div'); vide.className = 'cal-empty'; calGrid.appendChild(vide); }
    var dernier = new Date(y, m + 1, 0).getDate();
    var per = periodeChoisie >= 0 ? periodes[periodeChoisie] : null;

    for (var day = 1; day <= dernier; day++) {
      var d = new Date(y, m, day), k = iso(d), p = paiements[k];
      var cell = document.createElement('button');
      cell.type = 'button'; cell.className = 'cal-day'; cell.dataset.date = k;
      if (d.getTime() === auj.getTime()) cell.classList.add('today');
      if (per && d >= per.debut && d <= per.fin) cell.classList.add('in-periode');
      if (!p && !dansSuivi(d, auj)) {
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

  /* ---------- Onglets ---------- */
  function placerPastille() {
    var actif = document.querySelector('.tabs button[aria-selected="true"]'), pill = $('tabPill');
    if (!actif) return;
    pill.style.width = actif.offsetWidth + 'px';
    pill.style.transform = 'translateX(' + (actif.offsetLeft - 4) + 'px)';
  }
  function basculer(nom) {
    var vid = nom === 'vidange', red = nom === 'redevance', con = nom === 'contrat';
    $('tabVidange').setAttribute('aria-selected', vid); $('tabRedevance').setAttribute('aria-selected', red); $('tabContrat').setAttribute('aria-selected', con);
    $('panelVidange').classList.toggle('show', vid); $('panelRedevance').classList.toggle('show', red); $('panelContrat').classList.toggle('show', con);
    placerPastille();
    if (red) renderCalendar();
    if (con) renderContrat();
  }
  $('tabVidange').addEventListener('click', function () { basculer('vidange'); });
  $('tabRedevance').addEventListener('click', function () { basculer('redevance'); });
  $('tabContrat').addEventListener('click', function () { basculer('contrat'); });

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
    $('contratFeuille').innerHTML = smContrat.corps(client, t);
  }
  $('ficheTypeRow').addEventListener('click', function (e) {
    var b = e.target.closest('button'); if (!b) return;
    typeAffiche = b.dataset.type; renderContrat();
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

  // Un clic sur une case de vidange ouvre la redevance sur cette période
  function majChip() {
    var p = periodeChoisie >= 0 ? periodes[periodeChoisie] : null;
    $('chipPeriode').classList.toggle('show', !!p);
    if (p) $('chipText').textContent = 'Période N°' + (p.i + 1) + ' : du ' + court(p.debut) + ' au ' + court(p.fin) + ' · ' + fcfa(p.montant) + ' versés';
  }
  $('driverPeriods').addEventListener('click', function (e) {
    var b = e.target.closest('.period-box'); if (!b || b.disabled) return;
    periodeChoisie = Number(b.dataset.i);
    var p = periodes[periodeChoisie];
    var auj = aujourdhui(), fin = p.fin > auj ? auj : p.fin;
    viewY = p.debut.getFullYear(); viewM = p.debut.getMonth();
    if (new Date(viewY, viewM + 1, 0) < p.debut) { viewM += 1; }
    afficherPeriodes(false); majChip(); basculer('redevance');
  });
  $('chipClear').addEventListener('click', function () { periodeChoisie = -1; majChip(); afficherPeriodes(false); renderCalendar(); });

  /* ---------- Modale : montant remis ---------- */
  var modal = $('amountModal'), ctx = null;
  function ouvrirModal(cell) {
    var existant = paiements[cell.dataset.date], cible = client.montant_journalier_effectif;
    var a = cell.dataset.date.split('-').map(Number);
    ctx = { cell: cell, date: cell.dataset.date, cible: cible };
    $('modalDate').textContent = client.nom + ' — ' + a[2] + ' ' + MOIS_FR[a[1] - 1] + ' ' + a[0];
    $('modalCible').textContent = cible.toLocaleString('fr-FR') + ' F';
    $('amountInput').value = existant ? existant.montant : cible;
    smMoyenSet(existant ? existant.moyen : null);
    smNumeroSet(existant ? existant.numero_momo : null);
    $('modalError').classList.remove('show'); $('amountInput').removeAttribute('data-invalid');
    modal.classList.add('show');
    setTimeout(function () { $('amountInput').focus(); $('amountInput').select(); }, 60);
  }
  function fermerModal() { modal.classList.remove('show'); ctx = null; }
  $('quickFullBtn').addEventListener('click', function () { $('amountInput').value = ctx ? ctx.cible : 0; $('amountInput').focus(); });
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
        (p.ajustements || []).forEach(function (a) { paiements[a.date] = Object.assign({}, paiements[a.date] || {}, a); });
        majCellule(c.cell, p);
        if (p.ajustements && p.ajustements.length) renderCalendar();
        c.cell.classList.remove('just-toggled'); void c.cell.offsetWidth; c.cell.classList.add('just-toggled');
        totaux(); construirePeriodes(); afficherPeriodes(false); majChip(); afficherKpis(true);
        if (p.paye && window.smCelebrate) window.smCelebrate($('modalSaveBtn'));
        if (p.reporte && window.smToast) window.smToast(fcfa(p.reporte) + ' de surplus ont comblé ' + p.ajustements.length + (p.ajustements.length > 1 ? ' jours impayés.' : ' jour impayé.'));
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
      return api('/api/paiements?code_client=' + encodeURIComponent(client.code)); // tout l'historique, en une requête
    }).then(function (rows) {
      paiements = {}; rows.forEach(function (p) { paiements[p.date] = p; });

      $('dAvatar').textContent = initials(client.nom); $('dAvatar').className = 'avatar ' + avatarClass(client.nom);
      $('dName').textContent = client.nom; $('dCode').textContent = client.code;

      var auj = aujourdhui(); viewY = auj.getFullYear(); viewM = auj.getMonth(); periodeChoisie = -1; majChip();
      construirePeriodes();
      $('vide').style.display = 'none';
      var vue = $('ficheView'); vue.style.display = 'block';
      vue.classList.remove('sm-view-in'); void vue.offsetWidth; vue.classList.add('sm-view-in');
      typeAffiche = null;
      basculer('vidange'); afficherPeriodes(true); afficherKpis(true);
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
