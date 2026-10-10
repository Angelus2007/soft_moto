/* Soft Moto – contrats (Journée payée / Droit d'usage)
 * Les pointillés des contrats sont remplacés par les informations saisies dans le formulaire du conducteur.
 * API : window.smContrat = { TYPES, typeDe(client), corps(client, type), telecharger(client, type), imprimer(client, type) }
 */
(function () {
  var TYPES = {
    journee_payee: { label: 'JOURNÉE PAYÉE', fichier: 'JOURNEE_PAYEE' },
    droit_usage: { label: 'DROIT D’USAGE', fichier: 'DROIT_USAGE' }
  };

  var PROPRIETAIRE = { nom: 'Etienne COCOU', nomInverse: 'COCOU Etienne', tel: '00229 01 67 28 64 83', telCourt: '+229 01 67 28 64 83' };
  var POINTILLES = '………………………';

  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; });
  }
  // Valeur saisie : en gras ; sinon on garde les pointillés du contrat d'origine.
  function v(valeur, pointilles) {
    var t = valeur === null || valeur === undefined ? '' : String(valeur).trim();
    return t ? '<b class="v">' + esc(t) + '</b>' : (pointilles || POINTILLES);
  }
  function dateFR(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '');
    return m ? m[3] + '/' + m[2] + '/' + m[1] : '';
  }
  function dureeMois(debut, fin) {
    if (!debut || !fin) return '';
    var a = new Date(debut.slice(0, 10) + 'T00:00:00Z'), b = new Date(fin.slice(0, 10) + 'T00:00:00Z');
    var n = Math.round((b - a) / 86400000 / 30.4375);
    return n > 0 ? String(n) : '';
  }

  /* ---------- Nombre en lettres (français) ---------- */
  var U = ['zéro', 'un', 'deux', 'trois', 'quatre', 'cinq', 'six', 'sept', 'huit', 'neuf', 'dix', 'onze', 'douze', 'treize', 'quatorze', 'quinze', 'seize', 'dix-sept', 'dix-huit', 'dix-neuf'];
  var D = ['', '', 'vingt', 'trente', 'quarante', 'cinquante', 'soixante'];
  function sous100(n, fin) {
    if (n < 20) return U[n];
    var t = Math.floor(n / 10), u = n % 10;
    if (t < 7) return u === 0 ? D[t] : (u === 1 ? D[t] + ' et un' : D[t] + '-' + U[u]);
    if (t === 7) return u === 1 ? 'soixante et onze' : 'soixante-' + U[10 + u];
    if (n === 80) return fin ? 'quatre-vingts' : 'quatre-vingt';
    return 'quatre-vingt-' + U[n - 80];
  }
  function sous1000(n, fin) {
    var h = Math.floor(n / 100), r = n % 100;
    if (h === 0) return sous100(r, fin);
    if (h === 1) return 'cent' + (r ? ' ' + sous100(r, fin) : '');
    return U[h] + ' cent' + (r ? ' ' + sous100(r, fin) : (fin ? 's' : ''));
  }
  function enLettres(n) {
    n = Math.round(Number(n));
    if (!isFinite(n) || n < 0) return '';
    if (n === 0) return 'zéro';
    var out = [], m = Math.floor(n / 1000000), k = Math.floor((n % 1000000) / 1000), r = n % 1000;
    if (m) out.push(sous1000(m, false) + ' million' + (m > 1 ? 's' : ''));
    if (k) out.push(k === 1 ? 'mille' : sous1000(k, false) + ' mille');
    if (r) out.push(sous1000(r, true));
    return out.join(' ');
  }

  function typeDe(client) {
    return client && TYPES[client.type_contrat] ? client.type_contrat : 'journee_payee';
  }

  /* ---------- Contrat « Journée payée » ---------- */
  function journeePayee(c) {
    var montant = c.montant_journalier_effectif || c.montant_journalier;
    return '' +
      '<h1>CONTRAT - Journée payée No ' + v(c.code, '.....................') + '</h1>' +
      '<p>Je soussigné ' + PROPRIETAIRE.nom + ', Tél : ' + PROPRIETAIRE.tel + ', transmet ce jour la moto de marque ' + v(c.marque || 'TVS', '..') +
      ' immatriculé sous le numéro ' + v(c.immatriculation, '.........................') + ' pour une période de pré-contrat valable pour quatorze (14) jours.</p>' +
      '<p>Le contractant, ' + v(c.nom, '..........................') + ' Tél : ' + v(c.telephone, '............................') +
      ' ci-après désigné se doit de verser la somme de ' + (montant ? '<b class="v">' + esc(montant) + 'F</b>' : '..…..F') +
      ' par jour pendant la période de ' + v(dateFR(c.date_debut), '...................................') +
      ' au ' + v(dateFR(c.date_fin), '...................................') + '.</p>' +
      '<p>Ce contrat ayant été pris connaissance par ' + v(c.temoin_nom, '..............................................') +
      ', qui prend l’engagement d’être avaliseur des présentes clauses et devra verser le montant sus indiqué en cas de non respect des présentes clauses par le contractant.</p>' +
      '<p class="fait">Fait à Cotonou, le ' + v(dateFR(c.date_debut), '......................................') + '</p>' +
      '<table class="sign"><tr><td>Le propriétaire</td><td>Le contractant</td></tr>' +
      '<tr><td class="espace"></td><td class="espace"></td></tr>' +
      '<tr><td>' + PROPRIETAIRE.nom + '</td><td>...............................................</td></tr></table>';
  }

  /* ---------- Contrat « Attribution de droit d'usage » ---------- */
  function droitUsage(c) {
    var montant = c.montant_journalier_effectif || c.montant_journalier;
    var mois = dureeMois(c.date_debut, c.date_fin);
    return '' +
      '<h1>CONTRAT D’ATTRIBUTION DE DROIT D’USAGE No ' + v(c.code, '…………') + '</h1>' +
      '<h3>Article 1 (OBJET)</h3>' +
      '<p>Il est procédé à la remise de la moto neuve de marque ' + v(c.marque || 'TVS', 'TVS') + ' portant la plaque ' + v(c.immatriculation, '………………….') +
      ' par ' + PROPRIETAIRE.nomInverse + ' (Propriétaire), Godomey Gare, Tél : ' + PROPRIETAIRE.telCourt + ' à ' + v(c.nom, '……………………………………………….') +
      ' (Conducteur) Téléphone ' + v(c.telephone, '……………………………………') + '</p>' +
      '<h3>Article 2 (USAGE)</h3>' +
      '<p>Cette moto est attribuée à usage professionnel à titre de taxi ou d’un autre selon la convenance du conducteur.</p>' +
      '<h3>Article 3 (PAIEMENT ET PÉRIODE)</h3>' +
      '<p>Le conducteur doit verser la somme de ' + (montant ? '<b class="v">' + esc(enLettres(montant)) + ' (' + esc(montant) + 'F cfa)</b>' : 'deux mille six cent (2600F cfa)') +
      ' par jours. La durée du contrat est de ' + v(mois, '……….') + ' mois à compter de ' + v(dateFR(c.date_debut), '……./……/26') +
      ' au ' + v(dateFR(c.date_fin), '………./………/27') + ' à l’issue de laquelle un certificat de propriété sera délivré au conducteur en cas bonne exécution du contrat et de paiement de solde de tout compte.</p>' +
      '<h3>Article 4 (MODE DE PAIEMENT)</h3>' +
      '<p>Le paiement se fera au secrétariat sis non loin du CEG FIYEGNON suivant un carnet de suivi.</p>' +
      '<h3>Article 5 (RESPONSABILITE)</h3>' +
      '<p>Le propriétaire a la responsabilité de se rendre disponible pour l’entretien (vidange, dent chaîne, patins, pneus et du moteur) de la moto pendant la période du présent contrat. Il est donc interdit que le contractant se charge lui-même de la vidange de la moto par ses propres moyens.</p>' +
      '<p>Le contractant se doit d’annoncer son indisponibilité (maladie, occasion spéciales, etc…) et de ramener la moto, afin que le propriétaire confie la moto pour une autre demande contre un contrat de journée payée sur la période d’attente de deux semaines au plus, à l’issue duquel le contractant perd la validité du contrat.</p>' +
      '<h3>Article 6 (AVALISEUR)</h3>' +
      '<p>Tout avaliseur a la responsabilité de poursuivre promptement les paiements quel que soit la nature de la survenance de n’importe quel risque ou événement à défaut de solder intégralement les paiements dus par le conducteur devant le commissariat territorialement compétent ou demeure l’avaliseur.</p>' +
      '<h3>Article 7 (HORRAIRES ET ZONES D’ACTIVITES)</h3>' +
      '<p>Le conducteur est tenu d’arrêter rigoureusement ses activités à 20 heures au plus tard.</p>' +
      '<p>Les déplacements du conducteur ne sont envisagés qu’entre Cotonou et Calavi. Le non-respect de cette disposition est au risque et péril du conducteur.</p>' +
      '<h3>Article 8 – I (SANCTIONS)</h3>' +
      '<p>Un retard de paiement implique une pénalité de trois cents (300) F cfa par mise de retard.</p>' +
      '<p>Le contractant devra se présenter le jour de la vidange (Chaque deux semaines) avant 18h sans quoi il sera soumis au paiement d’une pénalité de deux mille (2 000) F cfa par jour de retard non négociable limité à Sept (7) jours. Passé ce délai, le contrat sera purement et simplement résilié.</p>' +
      '<p>S’il s’avère qu’il y a eu un déplacement de rappel à l’ordre pour la cause, une pénalité de cinq mille (5 000) F cfa sera payée par le contractant pour chaque déplacement effectué.</p>' +
      '<p>Tous travaux de réparation de la moto de quelle nature qu’elle soit devra être effectuée à l’adresse désignée par le propriétaire, située au siège du lieu de paiement quotidien.</p>' +
      '<h3>Article 8 – II (RUPTURE DE CONTRAT)</h3>' +
      '<p>Un retard de paiement pour un montant total supérieur ou égal à quinze mille (15 000) Fcfa implique, la saisie de la moto par son propriétaire.</p>' +
      '<p>Par ailleurs, toute moto saisie et garée passe dans un contrat journée payée dès le lendemain au profit du suppléant intérimaire du contractant désigné par le propriétaire, pour la période de cessation du contractant et limitée à deux semaines en attendant qu’il procède au paiement de la totalité de la dette dans un délai de deux semaines au plus tard avant de rentrer à nouveau en possession de la moto.</p>' +
      '<p>Passé ce délai, le présent contrat sera simplement considéré comme définitivement résilié et rompu sans aucune contrepartie.</p>' +
      '<h3>Article 9 (BONNE EXECUTION DU CONTRAT ET AVANTAGES)</h3>' +
      '<p>La bonne exécution du présent contrat implique le paiement à temps dans le délai contractuel des sommes dues par le conducteur ou l’avaliseur donnant droit à la fin dudit contrat que le conducteur devient automatiquement le nouveau propriétaire de la moto après obtention d’un certificat de propriété énoncé à l’article 3 ci-dessus.</p>' +
      '<p>Le contrat sera considéré toujours valide en cas de solde restant dû par le contractant même après la date de fin réglementaire du présent contrat.</p>' +
      '<h3>Article 10 (ORIGINAL ET SIGNATURE)</h3>' +
      '<p>Le présent contrat est fait en trois (3) originaux, un pour chacune des parties a savoir le propriétaire, l’avaliseur et le conducteur. Elles ont bien lu, compris tous les articles, accepté et ont signé ledit contrat en reconnaissant chacune sa responsabilité à tous les niveaux dans l’exécution de cet engagement.</p>' +
      '<p class="fait">Cotonou le ' + v(dateFR(c.date_debut), '………/………/26') + '</p>' +
      '<table class="sign"><tr><td>Conducteur</td><td>Nom et signature (Avaliseur)</td></tr>' +
      '<tr><td>Tél ' + v(c.telephone, '………………………..') + '</td><td>' + v(c.temoin_nom, '') + (c.temoin_telephone ? ' — Tél ' + v(c.temoin_telephone) : '') + '</td></tr>' +
      '<tr><td class="espace"></td><td class="espace"></td></tr>' +
      '<tr><td>' + v(c.nom, '') + '</td><td></td></tr></table>' +
      '<table class="sign"><tr><td></td><td>' + PROPRIETAIRE.nomInverse + '<br>Propriétaire</td></tr></table>';
  }

  var CSS = '' +
    '.sm-contrat{font-family:"Bookman Old Style","Book Antiqua",Georgia,serif;font-size:12pt;line-height:1.45;color:#000;text-align:justify}' +
    '.sm-contrat h1{font-size:14pt;text-align:center;text-decoration:underline;margin:0 0 14pt}' +
    '.sm-contrat h3{font-size:12pt;font-style:italic;text-decoration:underline;margin:12pt 0 3pt}' +
    '.sm-contrat p{margin:0 0 7pt}' +
    '.sm-contrat .v{font-weight:700}' +
    '.sm-contrat .fait{margin-top:14pt}' +
    '.sm-contrat table.sign{width:100%;border-collapse:collapse;margin-top:6pt}' +
    '.sm-contrat table.sign td{width:50%;padding:2pt 0;vertical-align:top;text-align:left}' +
    '.sm-contrat table.sign td+td{text-align:right}' +
    '.sm-contrat table.sign td.espace{height:46pt}';

  function corps(client, type) {
    var t = TYPES[type] ? type : typeDe(client);
    return '<div class="sm-contrat">' + (t === 'droit_usage' ? droitUsage(client) : journeePayee(client)) + '</div>';
  }

  function documentComplet(client, type) {
    var t = TYPES[type] ? type : typeDe(client);
    return '<!DOCTYPE html><html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" lang="fr"><head><meta charset="utf-8">' +
      '<title>Contrat ' + TYPES[t].label + ' – ' + esc(client.nom || '') + '</title>' +
      '<!--[if gte mso 9]><xml><w:WordDocument><w:View>Print</w:View><w:Zoom>100</w:Zoom></w:WordDocument></xml><![endif]-->' +
      '<style>@page{size:A4;margin:2cm}body{margin:0}' + CSS + '</style></head><body>' + corps(client, t) + '</body></html>';
  }

  function nomFichier(client, type) {
    var t = TYPES[type] ? type : typeDe(client);
    var nom = String(client.nom || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
    return 'Contrat_' + TYPES[t].fichier + '_' + (client.code || 'SM') + (nom ? '_' + nom : '') + '.doc';
  }

  function telecharger(client, type) {
    var blob = new Blob(['\ufeff', documentComplet(client, type)], { type: 'application/msword;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = nomFichier(client, type);
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
  }

  function imprimer(client, type) {
    var w = window.open('', '_blank');
    if (!w) { alert('Autorisez les fenêtres pop-up pour imprimer le contrat.'); return; }
    w.document.open(); w.document.write(documentComplet(client, type)); w.document.close();
    w.focus(); setTimeout(function () { w.print(); }, 400);
  }

  // Style d'aperçu à l'écran (feuille blanche)
  var st = document.createElement('style');
  st.textContent = CSS + '.sm-feuille{background:#fff;border:1.5px solid var(--border,#DDE3EC);border-radius:12px;padding:32px 36px;max-height:620px;overflow:auto;box-shadow:inset 0 0 0 1px rgba(15,23,42,.02)}@media(max-width:640px){.sm-feuille{padding:18px 16px}.sm-contrat{font-size:11pt}}';
  document.head.appendChild(st);

  window.smContrat = { TYPES: TYPES, typeDe: typeDe, corps: corps, telecharger: telecharger, imprimer: imprimer, enLettres: enLettres, dureeMois: dureeMois };
})();
