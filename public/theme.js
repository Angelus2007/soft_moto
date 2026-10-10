/* Soft Moto — comportement visuel partagé (voir theme.css pour les styles).
   Onde tactile au clic sur les boutons principaux (.btn, button.submit). */
(function () {
  document.addEventListener('click', function (e) {
    var btn = e.target.closest('.btn, button.submit');
    if (!btn || btn.disabled) return;

    var rect = btn.getBoundingClientRect();
    var size = Math.max(rect.width, rect.height) * 1.6;
    var x = (e.clientX || rect.left + rect.width / 2) - rect.left - size / 2;
    var y = (e.clientY || rect.top + rect.height / 2) - rect.top - size / 2;

    var ripple = document.createElement('span');
    ripple.className = 'sm-ripple';
    ripple.style.width = ripple.style.height = size + 'px';
    ripple.style.left = x + 'px';
    ripple.style.top = y + 'px';

    btn.appendChild(ripple);
    ripple.addEventListener('animationend', function () { ripple.remove(); });
    setTimeout(function () { if (ripple.isConnected) ripple.remove(); }, 800); // filet de sécurité
  });
})();

/* ---------- Salutation selon l'heure de la journée ---------- */
window.smGreeting = function () {
  var h = new Date().getHours();
  if (h < 5) return 'Bonsoir';
  if (h < 12) return 'Bonjour';
  if (h < 18) return 'Bon après-midi';
  return 'Bonsoir';
};

/* ---------- Petite pluie de confettis pour célébrer un succès (paiement, jalon atteint) ----------
   N'a aucun effet si la personne a demandé moins d'animations (prefers-reduced-motion). */
window.smCelebrate = function (origin) {
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  var rect = (origin && origin.getBoundingClientRect) ? origin.getBoundingClientRect() : { left: window.innerWidth / 2, top: window.innerHeight / 3, width: 0, height: 0 };
  var cx = rect.left + rect.width / 2;
  var cy = rect.top + rect.height / 2;
  var colors = ['#00A000', '#C77D0A', '#1D4ED8', '#3B82F6', '#4338CA'];
  var n = 16;
  for (var i = 0; i < n; i++) {
    var piece = document.createElement('span');
    piece.className = 'sm-confetti-piece';
    var angle = (Math.random() * Math.PI) - Math.PI / 2 - Math.PI / 2 + (Math.random() * 0.6 - 0.3);
    var dist = 60 + Math.random() * 90;
    var x = Math.cos(angle) * dist + (Math.random() * 40 - 20);
    var y = Math.abs(Math.sin(angle) * dist) + 80 + Math.random() * 60;
    piece.style.left = cx + 'px';
    piece.style.top = cy + 'px';
    piece.style.background = colors[i % colors.length];
    piece.style.setProperty('--sm-x', x.toFixed(0) + 'px');
    piece.style.setProperty('--sm-y', y.toFixed(0) + 'px');
    piece.style.setProperty('--sm-rot', (180 + Math.random() * 360).toFixed(0) + 'deg');
    piece.style.setProperty('--sm-dur', (700 + Math.random() * 500).toFixed(0) + 'ms');
    piece.style.setProperty('--sm-delay', (Math.random() * 90).toFixed(0) + 'ms');
    document.body.appendChild(piece);
    (function (p) {
      p.addEventListener('animationend', function () { p.remove(); });
      setTimeout(function () { if (p.isConnected) p.remove(); }, 2000);
    })(piece);
  }
};

/* =====================================================================
   MOTION DESIGN — comportements communs (voir theme.css)
   ===================================================================== */
(function () {
  var reduit = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var root = document.documentElement;
  var BIEN_LISTE = 14; // au-delà, les lignes apparaissent ensemble pour ne pas faire attendre

  /* 1. Séquence d'entrée : active au chargement, retirée ensuite (pas de rejeu pendant le filtrage). */
  if (!reduit) {
    root.classList.add('sm-intro');
    setTimeout(function () { root.classList.remove('sm-intro'); }, 1800);
  }

  /* 2. Navigation : fondu de sortie pour les liens internes et pour les redirections du code (smGo). */
  window.smGo = function (url) {
    if (reduit) { window.location.href = url; return; }
    root.classList.add('sm-leaving');
    setTimeout(function () { window.location.href = url; }, 200);
  };
  document.addEventListener('click', function (e) {
    if (reduit || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    var a = e.target.closest('a[href]');
    if (!a || a.target === '_blank' || a.hasAttribute('download') || a.id === 'logoutLink') return;
    var href = a.getAttribute('href');
    if (!href || href.charAt(0) === '#' || /^(https?:|mailto:|tel:|javascript:)/i.test(href)) return;
    e.preventDefault();
    window.smGo(a.href);
  });
  window.addEventListener('pageshow', function (ev) { if (ev.persisted) root.classList.remove('sm-leaving'); });

  /* 3. Cascade manuelle : numérote les enfants d'un conteneur (--i) et relance l'animation. */
  window.smStagger = function (container, max) {
    if (!container || reduit) return;
    var kids = container.children, limit = max || 40;
    for (var i = 0; i < kids.length; i++) kids[i].style.setProperty('--i', Math.min(i, limit));
    container.classList.remove('sm-cascade');
    void container.offsetWidth;
    container.classList.add('sm-cascade');
  };

  /* 4. Compteur animé (appel explicite). opts : { duration, format(n) } */
  window.smCountUp = function (el, to, opts) {
    opts = opts || {};
    var fmt = opts.format || function (n) { return Math.round(n).toLocaleString('fr-FR'); };
    if (reduit || !isFinite(to)) { el.textContent = fmt(to); return; }
    var dur = opts.duration || 900, t0 = null;
    function step(t) {
      if (t0 === null) t0 = t;
      var p = Math.min(1, (t - t0) / dur), eased = 1 - Math.pow(1 - p, 3);
      el.textContent = fmt(to * eased);
      if (p < 1) requestAnimationFrame(step); else el.textContent = fmt(to);
    }
    requestAnimationFrame(step);
  };

  window.smFlash = function (el) {
    if (!el || reduit) return;
    el.classList.remove('sm-milestone'); void el.offsetWidth; el.classList.add('sm-milestone');
  };

  if (reduit) return; // tout ce qui suit observe la page pour animer : inutile si l'on a demandé moins de mouvement

  /* 5. Compteurs automatiques : tout chiffre-clé qui change de valeur « roule » jusqu'à sa nouvelle valeur. */
  var SEL_COMPTEURS = '.stat .value, .kpi .value, .summary-card .value, .total-box .t-amount';
  var RE_NOMBRE = /\d[\d\s\u00a0\u202f]*/;
  function nombreDe(txt) {
    if (/\d[.,]\d/.test(txt)) return null;               // décimales : on n'y touche pas
    var m = txt.match(RE_NOMBRE);
    if (!m) return null;
    return { n: Number(m[0].replace(/[\s\u00a0\u202f]/g, '')), avant: txt.slice(0, m.index), apres: txt.slice(m.index + m[0].length).replace(/^\s+(?=\S)/, ' ') , brut: m[0] };
  }
  function animerCompteur(el) {
    if (el.__smBusy) return;
    var txt = el.textContent, info = nombreDe(txt);
    if (!info || !isFinite(info.n)) { el.__smVal = null; return; }
    if (el.__smVal === info.n) return;
    var depuis = el.__smVal == null ? 0 : el.__smVal, vers = info.n;
    el.__smVal = vers;
    if (depuis === vers) return;
    var sepEspace = /\s|\u00a0|\u202f/.test(info.brut.trim());
    var t0 = null, dur = 850;
    el.__smBusy = true;
    function ecrire(v) {
      var r = Math.round(v);
      el.textContent = info.avant + (sepEspace ? r.toLocaleString('fr-FR') : String(r)) + info.apres;
    }
    (function step(t) {
      if (t0 === null) t0 = t;
      var p = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - p, 3);
      ecrire(depuis + (vers - depuis) * e);
      if (p < 1) requestAnimationFrame(step);
      else { el.textContent = txt; el.__smBusy = false; }
    })(performance.now());
  }

  /* 6. Observateur unique : cascades des listes, compteurs, bascule des vues de connexion. */
  var SEL_LIGNES = 'tbody > tr, .moto-row, .tournee-row, .financing-row, .cal-day, .tournee-list > *';
  var VUES = { loginView: 1, signupView: 1, signupFormView: 1, signupSuccessView: 1 };

  function cascadeAjoutes(rec) {
    // Une re-création complète (filtrage, saisie) remplace des nœuds : on ne rejoue pas l'animation.
    if (rec.removedNodes.length) return;
    var i = 0;
    for (var k = 0; k < rec.addedNodes.length; k++) {
      var n = rec.addedNodes[k];
      if (n.nodeType !== 1 || !n.matches(SEL_LIGNES)) continue;
      n.style.setProperty('--i', Math.min(i++, n.classList.contains('cal-day') ? 31 : BIEN_LISTE));
      n.classList.add('sm-in');
      n.addEventListener('animationend', function (ev) { if (ev.target === this && ev.animationName === 'sm-cell-in') this.classList.remove('sm-in'); });
    }
  }

  var memoVue = {};
  function surveiller() {
    document.querySelectorAll(SEL_COMPTEURS).forEach(animerCompteur);
    var mo = new MutationObserver(function (records) {
      var aVerifier = new Set();
      records.forEach(function (rec) {
        if (rec.type === 'childList') {
          cascadeAjoutes(rec);
          var cible = rec.target.nodeType === 1 ? rec.target : rec.target.parentElement;
          var c = cible && cible.closest && cible.closest(SEL_COMPTEURS);
          if (c) aVerifier.add(c);
        } else if (rec.type === 'characterData') {
          var p = rec.target.parentElement, c2 = p && p.closest(SEL_COMPTEURS);
          if (c2) aVerifier.add(c2);
        } else if (rec.type === 'attributes' && rec.target.id && VUES[rec.target.id]) {
          var shown = rec.target.style.display !== 'none';
          if (shown && memoVue[rec.target.id] === false) {
            rec.target.classList.remove('sm-view-in'); void rec.target.offsetWidth; rec.target.classList.add('sm-view-in');
          }
          memoVue[rec.target.id] = shown;
        }
      });
      aVerifier.forEach(animerCompteur);
    });
    Object.keys(VUES).forEach(function (id) {
      var v = document.getElementById(id);
      if (v) memoVue[id] = v.style.display !== 'none' && getComputedStyle(v).display !== 'none';
    });
    mo.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['style'] });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', surveiller); else surveiller();
})();

/* Petit message flottant : window.smToast('texte') */
(function () {
  window.smToast = function (texte) {
    var t = document.createElement('div');
    t.className = 'sm-toast'; t.setAttribute('role', 'status'); t.textContent = texte;
    document.body.appendChild(t);
    requestAnimationFrame(function () { t.classList.add('show'); });
    setTimeout(function () { t.classList.remove('show'); setTimeout(function () { t.remove(); }, 400); }, 4200);
  };
})();

/* Moyen de paiement : window.smMoyenSet(valeur) / window.smMoyenGet() / window.smMoyenLabel(valeur) */
(function () {
  var LABELS = { especes: 'Espèces', momo: 'MOMO', momo_regulateur: 'MOMO régulateur' };
  window.smMoyenLabel = function (v) { return LABELS[v] || ''; };
  window.smMoyenSet = function (v) {
    v = LABELS[v] ? v : 'especes';
    document.querySelectorAll('.moyen-row button').forEach(function (b) { b.classList.toggle('on', b.dataset.moyen === v); b.setAttribute('aria-pressed', b.dataset.moyen === v); });
    if (window.smNumeroMaj) window.smNumeroMaj();
  };
  window.smMoyenGet = function () {
    var on = document.querySelector('.moyen-row button.on');
    return on ? on.dataset.moyen : 'especes';
  };
  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('.moyen-row button');
    if (b) window.smMoyenSet(b.dataset.moyen);
  });
})();

/* ---------- Montant remis : flèches ▲ (× 2) et ▼ (÷ 2) ---------- */
(function () {
  function baseDuJour() {
    var el = document.getElementById('modalCible');
    return el ? (parseInt(el.textContent.replace(/\D/g, ''), 10) || 0) : 0;
  }
  function poser(inp, v) { inp.value = String(v); inp.dispatchEvent(new Event('input', { bubbles: true })); }
  function doubler(inp) {
    var v = Number(inp.value) || 0;
    poser(inp, v <= 0 ? (baseDuJour() || 100) : Math.min(10000000, Math.round(v * 2))); // à partir de 0 : on repart du montant de base
  }
  function diviser(inp) {
    var v = Number(inp.value) || 0;
    poser(inp, v <= 1 ? 0 : Math.round(v / 2));
  }
  window.smMontantDoubler = doubler; window.smMontantDiviser = diviser;

  function init() {
    var inp = document.getElementById('amountInput');
    if (!inp || inp.dataset.stepper) return;
    inp.dataset.stepper = '1';
    var wrap = document.createElement('span'); wrap.className = 'sm-stepper';
    inp.parentNode.insertBefore(wrap, inp); wrap.appendChild(inp);
    var box = document.createElement('span'); box.className = 'sm-steps';
    var fl = function (pts) { return '<svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="' + pts + '"/></svg>'; };
    box.innerHTML = '<button type="button" tabindex="-1" aria-label="Doubler le montant" title="Doubler le montant (× 2)">' + fl('1.5,6.5 5,3 8.5,6.5') + '</button>' +
                    '<button type="button" tabindex="-1" aria-label="Diviser le montant par 2" title="Diviser le montant par 2 (÷ 2)">' + fl('1.5,3.5 5,7 8.5,3.5') + '</button>';
    wrap.appendChild(box);
    var b = box.querySelectorAll('button');
    b[0].addEventListener('click', function () { doubler(inp); inp.focus(); });
    b[1].addEventListener('click', function () { diviser(inp); inp.focus(); });
    inp.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowUp') { e.preventDefault(); doubler(inp); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); diviser(inp); }
    });
    var row = wrap.parentNode;
    var hint = document.createElement('p'); hint.className = 'step-hint';
    hint.textContent = '▲ double le montant · ▼ le divise par 2';
    row.parentNode.insertBefore(hint, row.nextSibling);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();

/* ---------- Numéro Mobile Money (MOMO / MOMO régulateur) ---------- */
(function () {
  var DEFAUT = ['+229 01 90 00 00 01', '+229 01 90 00 00 02', '+229 01 90 00 00 03']; // fictifs : modifiables dans Paramètres
  var liste = DEFAUT.slice();
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function momoActif() { var m = window.smMoyenGet ? window.smMoyenGet() : 'especes'; return m === 'momo' || m === 'momo_regulateur'; }

  window.smNumeroGet = function () {
    var r = document.querySelector('#numeroList input:checked');
    return r ? r.value : '';
  };
  function rendre(garder) {
    var zone = document.getElementById('numeroList'); if (!zone) return;
    var choisi = garder === undefined ? window.smNumeroGet() : garder;
    var items = liste.slice();
    if (choisi && items.indexOf(choisi) < 0) items.push(choisi); // ancien numéro d'un versement déjà enregistré
    zone.innerHTML = items.map(function (n) {
      return '<label class="numero-opt"><input type="radio" name="numeroMomo" value="' + esc(n) + '"' + (n === choisi ? ' checked' : '') + '><span class="num">' + esc(n) + '</span></label>';
    }).join('');
  }
  window.smNumeroSet = function (v) { rendre(v || ''); };
  window.smNumeroMaj = function () {
    var box = document.getElementById('numeroBox'); if (box) box.style.display = momoActif() ? '' : 'none';
  };
  // Message d'erreur si MOMO est choisi, qu'un montant est remis et qu'aucun numéro n'est coché
  window.smNumeroErreur = function (montant) {
    return momoActif() && montant > 0 && !window.smNumeroGet() ? 'Cochez le numéro qui a reçu le transfert.' : '';
  };

  function init() {
    if (!document.getElementById('numeroList')) return;
    rendre(''); window.smNumeroMaj();
    fetch('/api/config', { credentials: 'same-origin' }).then(function (r) { return r.ok ? r.json() : null; }).then(function (c) {
      if (c && Array.isArray(c.numeros_momo) && c.numeros_momo.length) { liste = c.numeros_momo; rendre(); }
    }).catch(function () { /* on garde les numéros par défaut */ });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
