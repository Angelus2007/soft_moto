/* Vérifie que la page est bien servie par le serveur Soft Moto et traduit l'erreur « Failed to fetch ». */
(function () {
  var local = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname) || location.protocol === 'file:';
  var LONG = local
    ? "Cette page ne parvient pas à joindre le serveur Soft Moto. Lancez « npm start » dans le dossier du projet, " +
      "puis ouvrez le site depuis http://localhost:3000 (sans double-cliquer sur le fichier et sans Live Server)."
    : "Impossible de joindre le serveur. Vérifiez votre connexion internet puis actualisez la page. " +
      "Si le site vient de se réveiller, patientez environ une minute et réessayez.";
  var COURT = local
    ? "Serveur injoignable. Vérifiez que « npm start » tourne et que vous êtes sur http://localhost:3000."
    : "Connexion au serveur impossible. Vérifiez votre connexion internet puis réessayez dans un instant.";

  window.smMessage = function (err) {
    var m = err && err.message;
    return (m === 'Failed to fetch' || m === 'NetworkError when attempting to fetch resource.' || m === 'Load failed') ? COURT : (m || 'Erreur.');
  };

  function banner() {
    if (document.getElementById('smServeurBanner')) return;
    var d = document.createElement('div');
    d.id = 'smServeurBanner';
    d.setAttribute('role', 'alert');
    d.style.cssText = 'position:sticky;top:0;z-index:1000;background:#FDE7E5;color:#B42318;border-bottom:1.5px solid #B42318;' +
      'padding:10px 16px;font:500 14px/1.45 Inter,system-ui,sans-serif;text-align:center;';
    d.textContent = LONG;
    document.body.insertBefore(d, document.body.firstChild);
  }

  function probe() {
    fetch('/api/moi', { credentials: 'same-origin' }).then(function (r) {
      if ((r.headers.get('content-type') || '').indexOf('application/json') === -1) banner();
    }).catch(banner);
  }
  if (document.body) probe(); else document.addEventListener('DOMContentLoaded', probe);
})();
