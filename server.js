'use strict';
const express = require('express');
const db = require('./db');
const creerSchema = require('./schema');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const path = require('path');

const PORT = process.env.PORT || 3000;

const app = express();
app.disable('x-powered-by');
app.use((req, res, next) => {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'same-origin'
  });
  next();
});
// Sur Render (ou si TRUST_PROXY est défini), le site est derrière un proxy : on lit la vraie adresse IP du visiteur
// (utilisée par la protection contre les essais de mot de passe).
if (process.env.RENDER || process.env.TRUST_PROXY) app.set('trust proxy', 1);
// 10 ko partout, sauf à l'enregistrement d'un conducteur (les images de signature sont envoyées en texte base64).
const jsonPetit = express.json({ limit: '10kb' }), jsonGrand = express.json({ limit: '1mb' });
app.use((req, res, next) => (/^\/api\/(clients|contrats)(\/|$)/.test(req.path) && (req.method === 'POST' || req.method === 'PATCH' || req.method === 'PUT') ? jsonGrand : jsonPetit)(req, res, next));

// Erreur « attendue » à renvoyer au navigateur (ex. depuis une transaction).
class ErreurHttp extends Error { constructor(statut, message) { super(message); this.statut = statut; } }
// Les routes sont asynchrones : toute erreur est transmise au gestionnaire d'erreurs au lieu de faire tomber le serveur.
const h = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch((e) => {
  if (e instanceof ErreurHttp) return res.status(e.statut).json({ erreur: e.message });
  if (/UNIQUE constraint failed|duplicate key/i.test(String(e && e.message))) return res.status(409).json({ erreur: 'Cet enregistrement existe déjà.' });
  next(e);
});
// Identifiant numérique d'une URL (null si invalide : la requête ne trouvera alors aucune ligne).
const idParam = (v) => { const n = Number(v); return Number.isInteger(n) && n > 0 && n < 2147483647 ? n : null; };

/* ------------------------------------------------------------------ */
/* Base de données (voir db.js et schema.js)                           */
/* ------------------------------------------------------------------ */
const now = () => new Date().toISOString();

const SEUIL_SAISIE = 15000; // article 8-II du contrat : retard >= 15 000 F => saisie possible
const TYPES_CONTRAT = ['journee_payee', 'droit_usage'];
const ETATS_MOTO = ['neuve', 'usagee']; // état de la moto à la remise
const STATUTS_CLIENT = ['actif', 'inactif', 'suspendu']; // « suspendu » = archivé (page Archives)
const MOYENS = { especes: 'Espèces', momo: 'MOMO', momo_regulateur: 'MOMO régularisation' };

/* --- Réglages modifiables depuis la page Paramètres (clé/valeur) --- */
// Le montant journalier par défaut est gardé en mémoire (cibleJourniere() est appelée partout) et relu toutes les 30 s.
let versementDefaut = 3500;
async function chargerVersementDefaut() {
  const r = await db.get("SELECT valeur FROM parametres WHERE cle = 'versement_journalier'");
  if (r) versementDefaut = Number(r.valeur) || 3500;
}
const getVersementDefaut = () => versementDefaut;
const setParametre = (cle, valeur) => db.run(
  'INSERT INTO parametres (cle, valeur) VALUES (?, ?) ON CONFLICT (cle) DO UPDATE SET valeur = excluded.valeur', [cle, valeur]);
async function setVersementDefaut(montant) { await setParametre('versement_journalier', String(montant)); versementDefaut = montant; }
const NUMEROS_MOMO_DEFAUT = ['+229 01 90 00 00 01', '+229 01 90 00 00 02', '+229 01 90 00 00 03']; // numéros fictifs, à remplacer dans Paramètres
async function getNumerosMomo() {
  const r = await db.get("SELECT valeur FROM parametres WHERE cle = 'numeros_momo'");
  try { const l = JSON.parse(r && r.valeur); if (Array.isArray(l) && l.length === 3) return l.map(String); } catch (e) { /* valeur absente ou invalide */ }
  return NUMEROS_MOMO_DEFAUT;
}
const setNumerosMomo = (liste) => setParametre('numeros_momo', JSON.stringify(liste));
/* --- Fréquence de paiement de la redevance : par jour (défaut), par semaine ou par mois ---
 * Le « montant de base » du conducteur est le montant à payer PAR PÉRIODE (jour, semaine ou mois). Les périodes
 * hebdomadaires et mensuelles partent de la date de début du contrat. */
const FREQUENCES = ['jour', 'semaine', 'mois'];
const frequenceDe = (c) => (c && FREQUENCES.includes(c.frequence) ? c.frequence : 'jour');
const MONTANT_VIDANGE = Number(process.env.VIDANGE_MONTANT) || 100; // F CFA par vidange
const DELAI_VIDANGE = 14; // jours : le décompte part du jour où le conducteur a payé sa vidange
const iso10 = (d) => d.toISOString().slice(0, 10);
const addJours = (s, n) => { const d = new Date(s + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return iso10(d); };
const diffJours = (a, b) => Math.round((new Date(b + 'T00:00:00Z') - new Date(a + 'T00:00:00Z')) / 86400000);
// Début du k-ième mois du contrat (même quantième que le début, ramené à la fin du mois si besoin : 31 -> 30, 28…).
function debutMois(debut, k) {
  const [y, m, j] = debut.split('-').map(Number);
  const total = (m - 1) + k;
  const an = y + Math.floor(total / 12), mo = ((total % 12) + 12) % 12;
  const dernier = new Date(Date.UTC(an, mo + 1, 0)).getUTCDate();
  return `${an}-${String(mo + 1).padStart(2, '0')}-${String(Math.min(j, dernier)).padStart(2, '0')}`;
}
// Périodes (semaines ou mois) du contrat commencées au plus tard le jour `jusqua` : { index, debut, fin, jours, joursPleins }.
// La dernière période est raccourcie si le contrat se termine avant.
function periodesDe(client, jusqua) {
  const freq = frequenceDe(client);
  const debut = ((client.date_debut || client.date_creation) || '').slice(0, 10);
  if (freq === 'jour' || !dateValide(debut)) return [];
  const finContrat = (client.date_fin || '').slice(0, 10);
  const out = [];
  for (let k = 0; k < 1500; k++) {
    const d = freq === 'semaine' ? addJours(debut, 7 * k) : debutMois(debut, k);
    if (d > jusqua || (finContrat && d > finContrat)) break;
    const suivant = freq === 'semaine' ? addJours(debut, 7 * (k + 1)) : debutMois(debut, k + 1);
    const finPleine = addJours(suivant, -1);
    const fin = finContrat && finContrat < finPleine ? finContrat : finPleine;
    out.push({ index: k, debut: d, fin, jours: diffJours(d, fin) + 1, joursPleins: diffJours(d, finPleine) + 1 });
  }
  return out;
}
// Période qui contient la date donnée (null si la date est hors contrat).
function periodeDe(client, dateIso) {
  const l = periodesDe(client, dateIso);
  const p = l[l.length - 1];
  return p && dateIso >= p.debut && dateIso <= p.fin ? p : null;
}
// Montant dû pour une période (au prorata si la dernière période est raccourcie par la fin du contrat).
const dueDe = (p, cible) => (p.jours < p.joursPleins ? Math.round(cible * p.jours / p.joursPleins) : cible);
const sommeJours = (mapJours, debut, fin) => { let t = 0; for (let k = debut; k <= fin; k = addJours(k, 1)) { const r = mapJours && mapJours.get(k); if (r) t += r.montant; } return t; };
// Équivalent par jour (pour estimer la durée restante d'un financement).
const parJour = (c, montant) => montant / ({ jour: 1, semaine: 7, mois: 30.4375 })[frequenceDe(c)];

// Montant dû sur toute la durée du contrat : montant de base × nombre de périodes (jours, semaines ou mois),
// la dernière période étant calculée au prorata si le contrat s'arrête avant sa fin. null si les dates ou le montant manquent.
function montantDuContrat(montant, frequence, debut, fin) {
  if (!montant || !dateValide(debut || '') || !dateValide(fin || '') || fin < debut) return null;
  const c = { frequence, date_debut: debut, date_fin: fin };
  if (frequenceDe(c) === 'jour') return montant * (diffJours(debut, fin) + 1);
  return periodesDe(c, fin).reduce((t, p) => t + dueDe(p, montant), 0);
}

function cibleJourniere(client) {
  // Montant que la caissière doit collecter CHAQUE JOUR pour ce conducteur :
  // son montant de base journalier (saisi à la création, modifiable ensuite),
  // sinon le montant journalier par défaut. À ne JAMAIS confondre avec
  // prix_moto, qui est le prix TOTAL de la moto (remboursé sur plusieurs mois).
  return (client && client.montant_journalier) || getVersementDefaut();
}

async function genererCode() {
  let code;
  do {
    code = 'SM-' + String(crypto.randomInt(0, 1000000)).padStart(6, '0');
  } while (await db.get('SELECT 1 FROM clients WHERE code = ?', [code]));
  return code;
}

/* Démarrage : tables, migrations, premier administrateur, réglages par défaut. */
async function demarrer() {
  await creerSchema(db);

  // Anciens conducteurs créés sans code
  for (const r of await db.all('SELECT id FROM clients WHERE code IS NULL')) {
    await db.run('UPDATE clients SET code = ?, date_creation = COALESCE(date_creation, ?) WHERE id = ?', [await genererCode(), now(), r.id]);
  }

  /* --- Migration (SQLite) : l'ancienne table `users` stockait les mots de passe en clair --- */
  if (db.dialect === 'sqlite' && await db.tableExiste('users')) {
    const anciens = await db.all('SELECT email, password FROM users');
    await db.tx(async (tx) => {
      for (const u of anciens) {
        const hash = /^\$2[aby]\$/.test(u.password) ? u.password : bcrypt.hashSync(u.password, 10);
        await tx.run(`INSERT OR IGNORE INTO comptes (nom, email, mot_de_passe, role, statut, date_creation)
                    VALUES ('Admin Soft Moto', ?, ?, 'admin', 'actif', ?)`, [u.email.toLowerCase(), hash, now()]);
      }
      await tx.exec('DROP TABLE users');
    });
    console.log(`Migration : ${anciens.length} compte(s) déplacé(s) vers "comptes" avec mot de passe haché.`);
  }

  /* --- Premier administrateur --- */
  if (!(await db.get("SELECT 1 FROM comptes WHERE role='admin'"))) {
    const email = (process.env.ADMIN_EMAIL || 'admin@softmoto.bj').toLowerCase();
    const enLigne = process.env.NODE_ENV === 'production' || !!process.env.RENDER;
    // Site en ligne sans ADMIN_PASSWORD : mot de passe aléatoire (affiché une seule fois dans les journaux), jamais « admin123 ».
    const motDePasse = process.env.ADMIN_PASSWORD || (enLigne ? crypto.randomBytes(9).toString('base64url') : 'admin123');
    await db.run(`INSERT INTO comptes (nom, email, mot_de_passe, role, statut, date_creation)
                VALUES ('Admin Soft Moto', ?, ?, 'admin', 'actif', ?)`, [email, bcrypt.hashSync(motDePasse, 10), now()]);
    console.log(`Administrateur créé : ${email} / ${motDePasse}  (changez ce mot de passe dès la première connexion)`);
  }

  /* --- Montant journalier par défaut --- */
  await db.run("INSERT INTO parametres (cle, valeur) VALUES ('versement_journalier', ?) ON CONFLICT (cle) DO NOTHING",
    [String(Number(process.env.VERSEMENT_JOURNALIER) || 3500)]);
  await chargerVersementDefaut();
  setInterval(() => chargerVersementDefaut().catch(() => {}), 30000).unref();

  /* --- Conducteurs de démonstration : SQLite par défaut (désactivable : SEED_DEMO=0) ; PostgreSQL seulement si SEED_DEMO=1 --- */
  const veutDemo = process.env.SEED_DEMO === '1' || (db.dialect === 'sqlite' && process.env.SEED_DEMO !== '0');
  if (veutDemo && (await db.get('SELECT COUNT(*) AS n FROM clients')).n === 0) {
    const demo = [
      ['SM-274819', 'Comlan Adjovi', '+229 97 12 34 56', '2026-01-14', 'actif', 650000],
      ['SM-118234', 'Nadège Houngbo', '+229 96 45 12 78', '2026-02-02', 'actif', 650000],
      ['SM-093761', 'Idrissou Baba', '+229 61 88 23 09', '2026-02-19', 'actif', 600000],
      ['SM-205567', 'Fifamè Dossou', '+229 95 67 44 21', '2026-03-03', 'actif', 650000],
      ['SM-341920', 'Espoir Kaki', '+229 90 11 56 33', '2026-03-21', 'inactif', 600000],
      ['SM-158802', 'Rachidatou Alassane', '+229 94 22 09 61', '2026-04-08', 'actif', null],
      ['SM-227145', 'Bio Sourou', '+229 62 39 77 14', '2026-05-17', 'actif', null],
      ['SM-076433', 'Gountiéto Yarou', '+229 91 05 88 42', '2026-05-29', 'actif', null],
      ['SM-402187', 'Sègbédji Tossou', '+229 97 74 20 15', '2026-07-11', 'actif', null],
      ['SM-315508', 'Aïchatou Moumouni', '+229 66 18 90 27', '2026-08-30', 'inactif', null]
    ];
    await db.tx(async (tx) => {
      for (const [c, n, t, d, st, p] of demo) {
        await tx.run('INSERT INTO clients (code, nom, telephone, date_creation, statut, prix_moto) VALUES (?,?,?,?,?,?)',
          [c, n, t, d + 'T08:00:00.000Z', st, p]);
      }
    });
  }
}

/* ------------------------------------------------------------------ */
/* Sessions (cookie HttpOnly) et rôles                                 */
/* ------------------------------------------------------------------ */
const COOKIE = 'sm_session';
const DUREE_COURTE = 12 * 3600 * 1000;        // 12 h
const DUREE_LONGUE = 30 * 24 * 3600 * 1000;   // 30 jours (« Se souvenir de moi »)
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

function lireCookies(header) {
  const out = {};
  (header || '').split(';').forEach((p) => {
    const i = p.indexOf('=');
    if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
  });
  return out;
}

function poserCookie(res, valeur, maxAgeMs) {
  let c = `${COOKIE}=${valeur}; HttpOnly; SameSite=Lax; Path=/`;
  if (maxAgeMs !== undefined) c += `; Max-Age=${Math.floor(maxAgeMs / 1000)}`;
  if (process.env.NODE_ENV === 'production' || process.env.RENDER) c += '; Secure';
  res.append('Set-Cookie', c);
}

app.use(h(async (req, res, next) => {
  const token = lireCookies(req.headers.cookie)[COOKIE];
  if (token) {
    const u = await db.get(`SELECT c.id, c.nom, c.email, c.role, c.statut
                          FROM sessions s JOIN comptes c ON c.id = s.compte_id
                          WHERE s.token_hash = ? AND s.expire_le > ?`, [sha256(token), Date.now()]);
    if (u && u.statut === 'actif') req.user = u;
  }
  next();
}));

const exigerRole = (...roles) => (req, res, next) => {
  if (!req.user) return res.status(401).json({ erreur: 'Connexion requise.' });
  if (!roles.includes(req.user.role)) return res.status(403).json({ erreur: 'Accès refusé.' });
  next();
};

/* Anti force brute : 5 échecs par IP + e-mail → blocage 15 min */
const echecs = new Map();
function estBloque(cle) {
  const e = echecs.get(cle);
  if (!e) return false;
  if (e.jusqua <= Date.now()) { echecs.delete(cle); return false; }
  return e.n >= 5;
}
function noterEchec(cle) {
  const e = echecs.get(cle) || { n: 0 };
  e.n += 1;
  e.jusqua = Date.now() + 15 * 60 * 1000;
  echecs.set(cle, e);
}

const HASH_BIDON = bcrypt.hashSync('mot-de-passe-bidon', 10);
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const FUSEAU = process.env.FUSEAU || 'Africa/Porto-Novo';
const texte = (v, max) => String(v == null ? '' : v).trim().slice(0, max);
const dateValide = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(new Date(s + 'T00:00:00Z'));
// Nombre entier optionnel : null si vide, false si présent mais invalide, sinon la valeur arrondie.
function nombreOptionnel(v, min, max) {
  if (v === undefined || v === null || v === '') return null;
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n >= min && n <= max ? n : false;
}

/* ------------------------------------------------------------------ */
/* Authentification                                                    */
/* ------------------------------------------------------------------ */
app.post('/api/inscription', h(async (req, res) => {
  const nom = texte(req.body.nom, 100);
  const email = texte(req.body.email, 254).toLowerCase();
  const mdp = String(req.body.motDePasse || req.body.password || '');

  if (nom.length < 2) return res.status(400).json({ erreur: 'Entrez votre nom complet.' });
  if (!EMAIL_RE.test(email)) return res.status(400).json({ erreur: 'Cette adresse e-mail ne semble pas valide.' });
  if (mdp.length < 8 || mdp.length > 72) return res.status(400).json({ erreur: 'Le mot de passe doit contenir entre 8 et 72 caractères.' });
  if (await db.get('SELECT 1 FROM comptes WHERE email = ?', [email])) {
    return res.status(409).json({ erreur: 'Cette adresse e-mail est déjà utilisée.' });
  }

  const id = await db.insertId(`INSERT INTO comptes (nom, email, mot_de_passe, role, statut, date_creation)
                        VALUES (?, ?, ?, 'caissiere', 'en_attente', ?)`, [nom, email, bcrypt.hashSync(mdp, 10), now()]);
  res.status(201).json({ success: true, id });
}));

async function connexion(req, res) {
  const email = texte(req.body.email, 254).toLowerCase();
  const mdp = String(req.body.motDePasse || req.body.password || '');
  const cle = req.ip + '|' + email;
  const journal = (compte, ok) => db.run(
    'INSERT INTO connexions (email, compte_id, succes, ip, date) VALUES (?,?,?,?,?)',
    [email, compte ? compte.id : null, ok ? 1 : 0, req.ip, now()]);

  if (!email || !mdp) return res.status(400).json({ erreur: 'Entrez votre e-mail et votre mot de passe.' });
  if (estBloque(cle)) {
    return res.status(429).json({ erreur: 'Trop de tentatives. Réessayez dans 15 minutes.' });
  }

  const compte = await db.get('SELECT * FROM comptes WHERE email = ?', [email]);
  const ok = bcrypt.compareSync(mdp, compte ? compte.mot_de_passe : HASH_BIDON);
  if (!compte || !ok) {
    noterEchec(cle);
    await journal(compte, false);
    return res.status(401).json({ erreur: 'E-mail ou mot de passe incorrect.' });
  }
  if (compte.statut === 'en_attente') {
    await journal(compte, false);
    return res.status(403).json({ erreur: "Votre compte attend la validation d'un administrateur." });
  }
  if (compte.statut === 'suspendu') {
    await journal(compte, false);
    return res.status(403).json({ erreur: 'Votre accès est suspendu. Contactez un administrateur.' });
  }

  echecs.delete(cle);
  await journal(compte, true);

  const duree = req.body.remember ? DUREE_LONGUE : DUREE_COURTE;
  const token = crypto.randomBytes(32).toString('hex');
  await db.run('DELETE FROM sessions WHERE expire_le < ?', [Date.now()]);
  await db.run('INSERT INTO sessions (token_hash, compte_id, expire_le) VALUES (?,?,?)',
    [sha256(token), compte.id, Date.now() + duree]);
  poserCookie(res, token, req.body.remember ? duree : undefined);

  res.json({ success: true, compte: { id: compte.id, email: compte.email, nom: compte.nom, role: compte.role } });
}
app.post(['/api/connexion', '/api/login'], h(connexion));

app.post('/api/deconnexion', h(async (req, res) => {
  const token = lireCookies(req.headers.cookie)[COOKIE];
  if (token) await db.run('DELETE FROM sessions WHERE token_hash = ?', [sha256(token)]);
  poserCookie(res, '', 0);
  res.json({ success: true });
}));

app.get('/api/moi', exigerRole('admin', 'caissiere'), (req, res) => res.json(req.user));

app.patch('/api/moi/mot-de-passe', exigerRole('admin', 'caissiere'), h(async (req, res) => {
  const actuel = String(req.body.motDePasseActuel || '');
  const nouveau = String(req.body.nouveauMotDePasse || '');
  const compte = await db.get('SELECT * FROM comptes WHERE id = ?', [req.user.id]);
  if (!bcrypt.compareSync(actuel, compte.mot_de_passe)) {
    return res.status(401).json({ erreur: 'Mot de passe actuel incorrect.' });
  }
  if (nouveau.length < 8 || nouveau.length > 72) {
    return res.status(400).json({ erreur: 'Le nouveau mot de passe doit contenir entre 8 et 72 caractères.' });
  }
  await db.run('UPDATE comptes SET mot_de_passe = ? WHERE id = ?', [bcrypt.hashSync(nouveau, 10), compte.id]);
  const tokenActuel = lireCookies(req.headers.cookie)[COOKIE];
  await db.run('DELETE FROM sessions WHERE compte_id = ? AND token_hash != ?', [compte.id, sha256(tokenActuel || '')]);
  res.json({ success: true });
}));

app.get('/api/config', exigerRole('admin', 'caissiere'), h(async (req, res) => res.json({ versement_journalier: getVersementDefaut(), fuseau: FUSEAU, numeros_momo: await getNumerosMomo() })));

app.patch('/api/config', exigerRole('admin'), h(async (req, res) => {
  if (req.body.versement_journalier === undefined && req.body.numeros_momo === undefined) {
    return res.status(400).json({ erreur: 'Aucune modification fournie.' });
  }
  if (req.body.versement_journalier !== undefined) {
    const montant = Math.round(Number(req.body.versement_journalier));
    if (!Number.isFinite(montant) || montant <= 0 || montant > 1000000) {
      return res.status(400).json({ erreur: 'Montant journalier par défaut invalide.' });
    }
    await setVersementDefaut(montant);
  }
  if (req.body.numeros_momo !== undefined) {
    const l = Array.isArray(req.body.numeros_momo) ? req.body.numeros_momo.map((n) => texte(n, 30)) : [];
    if (l.length !== 3 || l.some((n) => !n)) return res.status(400).json({ erreur: 'Entrez les trois numéros Mobile Money.' });
    if (new Set(l).size !== 3) return res.status(400).json({ erreur: 'Les trois numéros doivent être différents.' });
    await setNumerosMomo(l);
  }
  res.json({ versement_journalier: getVersementDefaut(), numeros_momo: await getNumerosMomo() });
}));

/* ------------------------------------------------------------------ */
/* Comptes (admin)                                                     */
/* ------------------------------------------------------------------ */
const COLS_COMPTE = 'id, nom, email, telephone, role, statut, date_creation';
const STATUTS = ['en_attente', 'actif', 'suspendu'];

app.get('/api/comptes', exigerRole('admin'), h(async (req, res) => {
  const where = [];
  const args = [];
  if (['admin', 'caissiere'].includes(req.query.role)) { where.push('role = ?'); args.push(req.query.role); }
  if (STATUTS.includes(req.query.statut)) { where.push('statut = ?'); args.push(req.query.statut); }
  const sql = `SELECT ${COLS_COMPTE} FROM comptes ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY date_creation DESC`;
  res.json(await db.all(sql, args));
}));

app.post('/api/comptes', exigerRole('admin'), h(async (req, res) => {
  const nom = texte(req.body.nom, 100);
  const email = texte(req.body.email, 254).toLowerCase();
  const telephone = texte(req.body.telephone, 30) || null;
  if (nom.length < 2) return res.status(400).json({ erreur: 'Entrez le nom de la caissière.' });
  if (!EMAIL_RE.test(email)) return res.status(400).json({ erreur: 'Adresse e-mail invalide.' });
  if (await db.get('SELECT 1 FROM comptes WHERE email = ?', [email])) {
    return res.status(409).json({ erreur: 'Cette adresse e-mail est déjà utilisée.' });
  }
  const temporaire = crypto.randomBytes(6).toString('base64url');
  const id = await db.insertId(`INSERT INTO comptes (nom, email, telephone, mot_de_passe, role, statut, date_creation)
                        VALUES (?, ?, ?, ?, 'caissiere', 'actif', ?)`, [nom, email, telephone, bcrypt.hashSync(temporaire, 10), now()]);
  res.status(201).json({ success: true, id, motDePasseTemporaire: temporaire });
}));

app.patch('/api/comptes/:id', exigerRole('admin'), h(async (req, res) => {
  const statut = req.body.statut;
  if (!STATUTS.includes(statut)) return res.status(400).json({ erreur: 'Statut invalide.' });
  const cible = await db.get('SELECT id, role FROM comptes WHERE id = ?', [idParam(req.params.id)]);
  if (!cible) return res.status(404).json({ erreur: 'Compte introuvable.' });
  if (cible.role === 'admin') return res.status(403).json({ erreur: "Le statut d'un administrateur ne peut pas être modifié." });

  await db.run('UPDATE comptes SET statut = ? WHERE id = ?', [statut, cible.id]);
  if (statut !== 'actif') await db.run('DELETE FROM sessions WHERE compte_id = ?', [cible.id]);
  res.json(await db.get(`SELECT ${COLS_COMPTE} FROM comptes WHERE id = ?`, [cible.id]));
}));

app.delete('/api/comptes/:id', exigerRole('admin'), h(async (req, res) => {
  const cible = await db.get('SELECT id, role FROM comptes WHERE id = ?', [idParam(req.params.id)]);
  if (!cible) return res.status(404).json({ erreur: 'Compte introuvable.' });
  if (cible.role === 'admin') return res.status(403).json({ erreur: 'Un administrateur ne peut pas être supprimé.' });
  await db.run('DELETE FROM comptes WHERE id = ?', [cible.id]);
  res.json({ success: true });
}));

/* ------------------------------------------------------------------ */
/* Clients (conducteurs)                                               */
/* ------------------------------------------------------------------ */
// Signature : image (data URL png/jpeg/webp, 400 000 caractères au maximum) ; chaîne vide ou null = pas de signature.
const SIGNATURE_MAX = 400000;
function signatureValide(v) {
  if (v === undefined || v === null || v === '') return null;
  if (typeof v !== 'string' || v.length > SIGNATURE_MAX || !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(v)) return false;
  return v;
}
const COLS_CLIENT = 'id, code, nom, telephone, adresse, temoin_nom, temoin_telephone, temoin_adresse, ' +
  'date_debut, date_fin, statut, date_creation, prix_moto, montant_journalier, type_contrat, immatriculation, marque, frequence, etat_moto, visiteur, date_archivage, ' +
  '(CASE WHEN signature_conducteur IS NULL THEN 0 ELSE 1 END) AS a_signature_conducteur, (CASE WHEN signature_temoin IS NULL THEN 0 ELSE 1 END) AS a_signature_temoin';
const avecCible = (c) => c && { ...c, frequence: frequenceDe(c), montant_journalier_effectif: cibleJourniere(c) };

app.get('/api/clients', exigerRole('admin', 'caissiere'), h(async (req, res) => {
  const archives = req.query.archives === '1';
  if (archives && req.user.role !== 'admin') return res.status(403).json({ erreur: 'Accès refusé.' });
  res.json((await db.all(`SELECT ${COLS_CLIENT} FROM clients WHERE statut ${archives ? '=' : '<>'} 'suspendu' ORDER BY date_creation DESC, id DESC`)).map(avecCible));
}));

// Images de signature d'un conducteur (séparées de la fiche : elles sont lourdes).
app.get('/api/clients/:code/signatures', exigerRole('admin', 'caissiere'), h(async (req, res) => {
  const c = await db.get('SELECT signature_conducteur, signature_temoin FROM clients WHERE code = ?', [req.params.code.trim().toUpperCase()]);
  if (!c) return res.status(404).json({ erreur: 'Aucun conducteur avec ce code.' });
  res.json({ signature_conducteur: c.signature_conducteur || null, signature_temoin: c.signature_temoin || null });
}));

app.get('/api/clients/:code', exigerRole('admin', 'caissiere'), h(async (req, res) => {
  const saisie = req.params.code.trim().toUpperCase();
  const plaque = saisie.replace(/[\s.\-_]/g, ''); // « EP 1234 RB », « EP-1234-RB » et « EP1234RB » désignent la même plaque
  const c = await db.get(`SELECT ${COLS_CLIENT} FROM clients
      WHERE code = ? OR (? <> '' AND immatriculation IS NOT NULL
            AND REPLACE(REPLACE(REPLACE(REPLACE(UPPER(immatriculation), ' ', ''), '-', ''), '.', ''), '_', '') = ?)
      ORDER BY CASE WHEN code = ? THEN 0 ELSE 1 END LIMIT 1`,
    [saisie, plaque.length >= 3 ? plaque : '', plaque, saisie]);
  if (!c) return res.status(404).json({ erreur: 'Aucun conducteur avec ce code ou cette plaque.' });
  const sv = sursisVisiteur(c, jourLocal(new Date()));
  res.json({ ...avecCible(c), visiteur_precontrat: sv.visiteur, sursis: sv.sursis, jour_precontrat: sv.jour });
}));

app.post('/api/clients', exigerRole('admin'), h(async (req, res) => {
  const code = texte(req.body.code, 20).toUpperCase().replace(/\s+/g, '');
  const nom = texte(req.body.nom, 100);
  const adresse = texte(req.body.adresse, 200);
  const telephone = texte(req.body.telephone, 30);
  const temoinNom = texte(req.body.temoin_nom, 100);
  const temoinTelephone = texte(req.body.temoin_telephone, 30);
  const temoinAdresse = texte(req.body.temoin_adresse, 200);
  const dateDebut = texte(req.body.date_debut, 10);
  const dateFin = texte(req.body.date_fin, 10);
  const typeContrat = texte(req.body.type_contrat, 20) || 'journee_payee';
  const immatriculation = texte(req.body.immatriculation, 30) || null;
  const marque = texte(req.body.marque, 40) || 'TVS';
  const frequence = texte(req.body.frequence, 10) || 'jour';
  const etatMoto = texte(req.body.etat_moto, 10);
  const visiteur = texte(req.body.visiteur, 100) || null;
  const sigConducteur = signatureValide(req.body.signature_conducteur), sigTemoin = signatureValide(req.body.signature_temoin);
  if (sigConducteur === false || sigTemoin === false) return res.status(400).json({ erreur: 'Image de signature invalide (png, jpeg ou webp, 300 ko environ au maximum).' });

  if (!ETATS_MOTO.includes(etatMoto)) return res.status(400).json({ erreur: "Choisissez l'état de la moto (neuve ou usagée)." });
  if (!FREQUENCES.includes(frequence)) return res.status(400).json({ erreur: 'Fréquence de paiement invalide (jour, semaine ou mois).' });
  if (!TYPES_CONTRAT.includes(typeContrat)) return res.status(400).json({ erreur: 'Type de contrat invalide.' });
  if (!code) return res.status(400).json({ erreur: 'Entrez le code du conducteur.' });
  if (!/^[A-Z0-9][A-Z0-9_-]{1,19}$/.test(code)) return res.status(400).json({ erreur: 'Le code ne peut contenir que des lettres, des chiffres, « - » ou « _ » (2 à 20 caractères).' });
  if (nom.length < 2) return res.status(400).json({ erreur: 'Entrez le nom et prénoms du conducteur.' });
  if (!telephone) return res.status(400).json({ erreur: 'Entrez le téléphone du conducteur.' });
  if (!adresse) return res.status(400).json({ erreur: "Entrez l'adresse du conducteur." });
  if (temoinNom.length < 2) return res.status(400).json({ erreur: 'Entrez le nom et prénoms du témoin.' });
  if (!temoinTelephone) return res.status(400).json({ erreur: 'Entrez le téléphone du témoin.' });
  if (!temoinAdresse) return res.status(400).json({ erreur: "Entrez l'adresse du témoin." });
  if (!dateValide(dateDebut)) return res.status(400).json({ erreur: 'Entrez une date de début valide.' });
  if (!dateValide(dateFin)) return res.status(400).json({ erreur: 'Entrez une date de fin valide.' });
  if (dateFin < dateDebut) return res.status(400).json({ erreur: 'La date de fin doit être après la date de début.' });

  // Montant de base JOURNALIER : ce que la caissière doit collecter chaque jour — obligatoire.
  const montantJournalier = nombreOptionnel(req.body.montant_journalier, 1, 1000000);
  if (montantJournalier === false) return res.status(400).json({ erreur: 'Montant de base journalier invalide.' });
  if (montantJournalier === null) return res.status(400).json({ erreur: 'Entrez le montant de base journalier.' });
  // Prix de la moto : montant TOTAL que le conducteur doit rembourser au fil du temps — optionnel.
  // Montant dû : calculé d'après le montant de base, la fréquence et la période du contrat.
  const prix = montantDuContrat(montantJournalier, frequence, dateDebut, dateFin);

  if (await db.get('SELECT 1 FROM clients WHERE code = ?', [code])) return res.status(409).json({ erreur: 'Ce code est déjà utilisé par un autre conducteur.' });
  const id = await db.insertId(`INSERT INTO clients
      (code, nom, telephone, adresse, temoin_nom, temoin_telephone, temoin_adresse, date_debut, date_fin,
       statut, date_creation, prix_moto, montant_journalier, type_contrat, immatriculation, marque, frequence, etat_moto, visiteur, signature_conducteur, signature_temoin)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [code, nom, telephone, adresse, temoinNom, temoinTelephone, temoinAdresse, dateDebut, dateFin,
      'actif', now(), prix, montantJournalier, typeContrat, immatriculation, marque, frequence, etatMoto, visiteur, sigConducteur, sigTemoin]);
  res.status(201).json(avecCible(await db.get(`SELECT ${COLS_CLIENT} FROM clients WHERE id = ?`, [id])));
}));

app.patch('/api/clients/:id', exigerRole('admin'), h(async (req, res) => {
  const existant = await db.get('SELECT * FROM clients WHERE id = ?', [idParam(req.params.id)]);
  if (!existant) return res.status(404).json({ erreur: 'Conducteur introuvable.' });

  const champs = {};
  if (req.body.code !== undefined) {
    // L'admin peut corriger le code ; les paiements et vidanges déjà saisis suivent le nouveau code.
    const code = texte(req.body.code, 20).toUpperCase().replace(/\s+/g, '');
    if (!/^[A-Z0-9][A-Z0-9_-]{1,19}$/.test(code)) return res.status(400).json({ erreur: 'Le code ne peut contenir que des lettres, des chiffres, « - » ou « _ » (2 à 20 caractères).' });
    if (code !== existant.code) {
      if (await db.get('SELECT 1 FROM clients WHERE code = ? AND id <> ?', [code, existant.id])) return res.status(409).json({ erreur: 'Ce code est déjà utilisé par un autre conducteur.' });
      champs.code = code;
    }
  }
  if (req.body.nom !== undefined) {
    const nom = texte(req.body.nom, 100);
    if (nom.length < 2) return res.status(400).json({ erreur: 'Entrez le nom du conducteur.' });
    champs.nom = nom;
  }
  if (req.body.telephone !== undefined) champs.telephone = texte(req.body.telephone, 30) || null;
  if (req.body.adresse !== undefined) champs.adresse = texte(req.body.adresse, 200) || null;
  if (req.body.temoin_nom !== undefined) champs.temoin_nom = texte(req.body.temoin_nom, 100) || null;
  if (req.body.temoin_telephone !== undefined) champs.temoin_telephone = texte(req.body.temoin_telephone, 30) || null;
  if (req.body.temoin_adresse !== undefined) champs.temoin_adresse = texte(req.body.temoin_adresse, 200) || null;
  if (req.body.date_debut !== undefined) {
    const d = texte(req.body.date_debut, 10);
    if (d && !dateValide(d)) return res.status(400).json({ erreur: 'Date de début invalide.' });
    champs.date_debut = d || null;
  }
  if (req.body.date_fin !== undefined) {
    const d = texte(req.body.date_fin, 10);
    if (d && !dateValide(d)) return res.status(400).json({ erreur: 'Date de fin invalide.' });
    champs.date_fin = d || null;
  }
  if (req.body.type_contrat !== undefined) {
    const t = texte(req.body.type_contrat, 20);
    if (!TYPES_CONTRAT.includes(t)) return res.status(400).json({ erreur: 'Type de contrat invalide.' });
    champs.type_contrat = t;
  }
  if (req.body.immatriculation !== undefined) champs.immatriculation = texte(req.body.immatriculation, 30) || null;
  if (req.body.marque !== undefined) champs.marque = texte(req.body.marque, 40) || 'TVS';
  if (req.body.frequence !== undefined) {
    const f = texte(req.body.frequence, 10);
    if (!FREQUENCES.includes(f)) return res.status(400).json({ erreur: 'Fréquence de paiement invalide (jour, semaine ou mois).' });
    champs.frequence = f;
  }
  if (req.body.etat_moto !== undefined) {
    const e = texte(req.body.etat_moto, 10);
    if (!ETATS_MOTO.includes(e)) return res.status(400).json({ erreur: "État de la moto invalide (neuve ou usagée)." });
    champs.etat_moto = e;
  }
  if (req.body.visiteur !== undefined) champs.visiteur = texte(req.body.visiteur, 100) || null;
  for (const k of ['signature_conducteur', 'signature_temoin']) {
    if (req.body[k] === undefined) continue;
    const sg = signatureValide(req.body[k]);
    if (sg === false) return res.status(400).json({ erreur: 'Image de signature invalide (png, jpeg ou webp, 300 ko environ au maximum).' });
    champs[k] = sg; // null = signature retirée
  }
  if (req.body.statut !== undefined) {
    if (!STATUTS_CLIENT.includes(req.body.statut)) return res.status(400).json({ erreur: 'Statut invalide.' });
    champs.statut = req.body.statut;
    // Suspendu = archivé : on garde la date ; en réactivant, le conducteur quitte les archives.
    champs.date_archivage = req.body.statut === 'suspendu' ? (existant.date_archivage || now()) : null;
  }
  if (req.body.prix_moto !== undefined) {
    const prix = nombreOptionnel(req.body.prix_moto, 1, 100000000);
    if (prix === false) return res.status(400).json({ erreur: 'Montant de base invalide.' });
    champs.prix_moto = prix;
  }
  if (req.body.montant_journalier !== undefined) {
    const m = nombreOptionnel(req.body.montant_journalier, 1, 1000000);
    if (m === false) return res.status(400).json({ erreur: 'Montant journalier invalide.' });
    champs.montant_journalier = m;
  }
  // Le montant dû suit le montant de base, la fréquence et les dates (une modification manuelle seule du montant reste possible).
  if (['montant_journalier', 'frequence', 'date_debut', 'date_fin'].some((k) => k in champs)) {
    const m = 'montant_journalier' in champs ? champs.montant_journalier : existant.montant_journalier;
    const f = 'frequence' in champs ? champs.frequence : existant.frequence;
    const d = 'date_debut' in champs ? champs.date_debut : existant.date_debut;
    const e = 'date_fin' in champs ? champs.date_fin : existant.date_fin;
    const du = montantDuContrat(m, f, (d || '').slice(0, 10), (e || '').slice(0, 10));
    if (du !== null) champs.prix_moto = du;
  }
  const cles = Object.keys(champs);
  if (!cles.length) return res.status(400).json({ erreur: 'Aucune modification fournie.' });

  await db.tx(async (tx) => {
    await tx.run(`UPDATE clients SET ${cles.map((c) => c + ' = ?').join(', ')} WHERE id = ?`, [...cles.map((c) => champs[c]), existant.id]);
    if (champs.code) {
      for (const t of ['paiements', 'versements', 'vidange_paiements', 'vidanges', 'observations']) await tx.run(`UPDATE ${t} SET code_client = ? WHERE code_client = ?`, [champs.code, existant.code]);
    }
  });
  res.json(avecCible(await db.get(`SELECT ${COLS_CLIENT} FROM clients WHERE id = ?`, [existant.id])));
}));

// Archives : conducteurs suspendus, avec ce qu'ils ont versé.
app.get('/api/archives', exigerRole('admin'), h(async (req, res) => {
  res.json(await db.all(`SELECT c.id, c.code, c.nom, c.telephone, c.adresse, c.immatriculation, c.marque, c.etat_moto, c.date_creation, c.date_archivage,
      c.prix_moto, c.montant_journalier, c.frequence, COALESCE(SUM(p.montant), 0) AS verse
    FROM clients c LEFT JOIN paiements p ON p.code_client = c.code
    WHERE c.statut = 'suspendu' GROUP BY c.id ORDER BY c.date_archivage DESC, c.id DESC`));
}));

/* ------------------------------------------------------------------ */
/* Paiements                                                           */
/* ------------------------------------------------------------------ */

app.get('/api/paiements', exigerRole('admin', 'caissiere'), h(async (req, res) => {
  const code = texte(req.query.code_client, 20).toUpperCase();
  const mois = texte(req.query.mois, 7);
  if (!code) return res.status(400).json({ erreur: 'code_client requis.' });
  if (mois && !/^\d{4}-\d{2}$/.test(mois)) return res.status(400).json({ erreur: 'mois doit être au format AAAA-MM.' });
  const rows = mois
    ? await db.all('SELECT * FROM paiements WHERE code_client = ? AND date LIKE ? ORDER BY date', [code, mois + '-%'])
    : await db.all('SELECT * FROM paiements WHERE code_client = ? ORDER BY date', [code]);
  res.json(rows.map((p) => ({ ...p, paye: !!p.paye })));
}));

app.post('/api/paiements', exigerRole('admin', 'caissiere'), h(async (req, res) => {
  const code = texte(req.body.code_client, 20).toUpperCase();
  const date = texte(req.body.date, 10);
  const montant = Math.round(Number(req.body.montant));

  const client = await db.get('SELECT montant_journalier, date_debut, date_fin, date_creation, frequence, statut FROM clients WHERE code = ?', [code]);
  if (!client) return res.status(404).json({ erreur: 'Aucun conducteur avec ce code.' });
  if (client.statut === 'suspendu') return res.status(409).json({ erreur: 'Ce conducteur est suspendu (archivé) : réactivez-le avant d\'enregistrer un paiement.' });
  if (!dateValide(date)) return res.status(400).json({ erreur: 'date doit être au format AAAA-MM-JJ.' });
  if (!Number.isFinite(montant) || montant < 0 || montant > 10000000) return res.status(400).json({ erreur: 'Montant invalide.' });

  const cible = cibleJourniere(client);
  const freq = frequenceDe(client);
  // Paiement par semaine ou par mois : le versement se rattache à la période du contrat qui contient la date choisie.
  const periodeCible = freq === 'jour' ? null : periodeDe(client, date);
  if (freq !== 'jour' && !periodeCible) return res.status(400).json({ erreur: 'Cette date est en dehors de la durée du contrat du conducteur.' });
  const jourSaisie = jourLocal(new Date());
  const ajustements = []; // jours antérieurs comblés grâce au surplus
  const avances = [];     // jours À VENIR payés d'avance grâce au surplus restant
  let reporte = 0;        // total du surplus utilisé pour combler les jours impayés
  let avance = 0;         // total du surplus utilisé pour payer des jours d'avance
  let paiement, periodeInfo = null;

  // Tout se fait dans une transaction, avec un verrou sur le conducteur : deux saisies simultanées ne se mélangent pas.
  await db.tx(async (tx) => {
    await tx.lock('clients', 'code', code);

    const ancien = await tx.get('SELECT moyen, montant, numero_momo FROM paiements WHERE code_client = ? AND date = ?', [code, date]);
    let moyen = texte(req.body.moyen, 20);
    if (!moyen) moyen = (ancien && ancien.moyen) || 'especes'; // champ absent : on garde l'existant
    if (!MOYENS[moyen]) throw new ErreurHttp(400, 'Moyen de paiement invalide (especes, momo ou momo_regulateur — « MOMO régularisation »).');
    // Numéro MOMO ayant reçu le transfert : seulement pour MOMO / MOMO régularisation ; champ absent => on garde l'existant.
    let numero = null;
    if (moyen !== 'especes') {
      numero = texte(req.body.numero_momo, 30) || null;
      if (!numero && ancien && ancien.moyen === moyen) numero = ancien.numero_momo || null;
    }

    const upsert = (c, d, paye, m, moy, regle, num) => tx.run(`INSERT INTO paiements (code_client, date, paye, montant, compte_id, maj_le, moyen, regle_le, numero_momo)
              VALUES (?,?,?,?,?,?,?,?,?)
              ON CONFLICT (code_client, date) DO UPDATE
              SET paye = excluded.paye, montant = excluded.montant, compte_id = excluded.compte_id, maj_le = excluded.maj_le, moyen = excluded.moyen, regle_le = excluded.regle_le, numero_momo = excluded.numero_momo`,
      [c, d, paye, m, req.user.id, now(), moy, regle, num]);
    const journal = (jourConcerne, mt, moy, num) => tx.run(
      'INSERT INTO versements (code_client, jour_saisie, jour_concerne, montant, moyen, compte_id, cree_le, numero_momo) VALUES (?,?,?,?,?,?,?,?)',
      [code, jourSaisie, jourConcerne, mt, moy, req.user.id, now(), num]);

    let garde = montant; // ce qui reste inscrit sur le jour saisi
    const surplus = montant - cible;

    if (surplus > 0 && cible > 0 && freq === 'jour') {
      // Jours suivis AVANT la date saisie, du plus ancien au plus récent.
      const debut = ((client.date_debut || client.date_creation) || '').slice(0, 10);
      const fin = (client.date_fin || '').slice(0, 10);
      const existants = {};
      (await tx.all('SELECT date, montant, moyen, numero_momo FROM paiements WHERE code_client = ? AND date < ?', [code, date]))
        .forEach((r) => { existants[r.date] = { montant: r.montant, moyen: r.moyen, numero: r.numero_momo }; });

      // Borne basse : début du contrat, sinon le plus ancien paiement connu.
      let borne = debut;
      if (!borne) borne = Object.keys(existants).sort()[0] || date;

      let reste = surplus;
      const jour = new Date(borne + 'T00:00:00Z');
      const limite = new Date(date + 'T00:00:00Z');
      while (jour < limite && reste > 0) {
        const k = jour.toISOString().slice(0, 10);
        if (!fin || k <= fin) {
          const ex = existants[k] || { montant: 0, moyen: null };
          const dejaVerse = ex.montant;
          const manque = cible - dejaVerse;
          if (manque > 0) {
            const apport = Math.min(manque, reste);
            const nouveau = dejaVerse + apport;
            const garder = dejaVerse > 0 && ex.moyen; // un jour déjà entamé garde son moyen (et son numéro)
            const moyenJour = garder ? ex.moyen : moyen;
            const numeroJour = garder ? (ex.numero || null) : numero;
            const regleLeJour = nouveau >= cible ? date : null; // jour complété : on retient la date réelle du règlement
            await upsert(code, k, nouveau >= cible ? 1 : 0, nouveau, moyenJour, regleLeJour, numeroJour);
            await journal(k, apport, moyen, numero);
            ajustements.push({ date: k, montant: nouveau, paye: nouveau >= cible, cible, moyen: moyenJour, regle_le: regleLeJour, numero_momo: numeroJour });
            reste -= apport;
          }
        }
        jour.setUTCDate(jour.getUTCDate() + 1);
      }
      reporte = surplus - reste;

      // Plus aucun jour impayé avant : ce qui reste paie les jours SUIVANTS, d'avance (jusqu'à la fin du contrat, 120 jours au plus).
      // Les jours déjà entièrement payés sont sautés.
      if (reste > 0) {
        const avantAvance = reste;
        const plafond = addJours(date, 120);
        const dernier = fin && fin < plafond ? fin : plafond;
        const futurs = {};
        (await tx.all('SELECT date, montant, moyen, numero_momo FROM paiements WHERE code_client = ? AND date > ? AND date <= ?', [code, date, dernier]))
          .forEach((r) => { futurs[r.date] = { montant: r.montant, moyen: r.moyen, numero: r.numero_momo }; });
        for (let k = addJours(date, 1); k <= dernier && reste > 0; k = addJours(k, 1)) {
          if (debut && k < debut) continue;
          const ex = futurs[k] || { montant: 0, moyen: null };
          const manque = cible - ex.montant;
          if (manque <= 0) continue;
          const apport = Math.min(manque, reste);
          const nouveau = ex.montant + apport;
          const garder = ex.montant > 0 && ex.moyen;
          const moyenJour = garder ? ex.moyen : moyen;
          const numeroJour = garder ? (ex.numero || null) : numero;
          const regleLeJour = nouveau >= cible ? date : null; // payé d'avance : on retient la date réelle du versement
          await upsert(code, k, nouveau >= cible ? 1 : 0, nouveau, moyenJour, regleLeJour, numeroJour);
          await journal(k, apport, moyen, numero);
          avances.push({ date: k, montant: nouveau, paye: nouveau >= cible, cible, moyen: moyenJour, regle_le: regleLeJour, numero_momo: numeroJour });
          reste -= apport;
        }
        avance = avantAvance - reste;
      }
      garde = montant - reporte - avance;
    }

    // Par jour : « payé » = le montant du jour est atteint. Par semaine / mois : « payé » = de l'argent a été versé ce jour-là ;
    // c'est la somme de la période qui dit si la période est complète.
    const payeJour = freq === 'jour' ? (garde >= cible && garde > 0 ? 1 : 0) : (garde > 0 ? 1 : 0);
    await upsert(code, date, payeJour, garde, garde > 0 ? moyen : null, null, garde > 0 ? numero : null);
    // Journal : ce qui change réellement dans la caisse. Si le moyen ou le numéro d'un versement existant change,
    // on retire le montant de l'ancien moyen et on l'ajoute au nouveau.
    const deplace = ancien && ancien.montant > 0 && ancien.moyen &&
      (garde === 0 || ancien.moyen !== moyen || (ancien.numero_momo || null) !== (numero || null));
    if (deplace) {
      await journal(date, -ancien.montant, ancien.moyen, ancien.numero_momo);
      if (garde > 0) await journal(date, garde, moyen, numero);
    } else {
      const delta = garde - (ancien ? ancien.montant : 0);
      if (delta !== 0) await journal(date, delta, moyen, numero);
    }

    paiement = await tx.get('SELECT * FROM paiements WHERE code_client = ? AND date = ?', [code, date]);
    if (periodeCible) {
      const verse = (await tx.get('SELECT COALESCE(SUM(montant), 0) AS t FROM paiements WHERE code_client = ? AND date >= ? AND date <= ?',
        [code, periodeCible.debut, periodeCible.fin])).t;
      const du = dueDe(periodeCible, cible);
      periodeInfo = { debut: periodeCible.debut, fin: periodeCible.fin, verse, cible: du, complete: verse >= du };
    }
  });

  res.json({ ...paiement, paye: periodeInfo ? periodeInfo.complete : !!paiement.paye, cible: periodeInfo ? periodeInfo.cible : cible, frequence: freq, periode: periodeInfo, reporte, avance, ajustements, avances });
}));

// Annule le paiement enregistré pour un jour : le jour redevient « non payé ». L'opération reste tracée dans le journal des
// versements par une ligne négative (au nom de la personne qui annule), pour que les totaux et le point de chacun restent justes.
// L'administrateur peut annuler n'importe quel paiement ; une caissière seulement ceux enregistrés aujourd'hui.
app.delete('/api/paiements', exigerRole('admin', 'caissiere'), h(async (req, res) => {
  const code = texte(req.query.code_client, 20).toUpperCase();
  const date = texte(req.query.date, 10);
  if (!dateValide(date)) return res.status(400).json({ erreur: 'date doit être au format AAAA-MM-JJ.' });
  const client = await db.get('SELECT statut FROM clients WHERE code = ?', [code]);
  if (!client) return res.status(404).json({ erreur: 'Aucun conducteur avec ce code.' });
  if (client.statut === 'suspendu') return res.status(409).json({ erreur: 'Ce conducteur est suspendu (archivé) : réactivez-le avant de modifier ses paiements.' });
  const aujourdhui = jourLocal(new Date());
  let annule = null;
  await db.tx(async (tx) => {
    await tx.lock('clients', 'code', code);
    const p = await tx.get('SELECT montant, moyen, numero_momo, maj_le FROM paiements WHERE code_client = ? AND date = ?', [code, date]);
    if (!p) throw new ErreurHttp(404, 'Aucun paiement enregistré à cette date.');
    if (req.user.role !== 'admin' && jourLocal(new Date(p.maj_le)) !== aujourdhui) {
      throw new ErreurHttp(403, "Ce paiement a été enregistré un autre jour : seul l'administrateur peut l'annuler.");
    }
    if (p.montant > 0) {
      await tx.run('INSERT INTO versements (code_client, jour_saisie, jour_concerne, montant, moyen, compte_id, cree_le, numero_momo) VALUES (?,?,?,?,?,?,?,?)',
        [code, aujourdhui, date, -p.montant, p.moyen, req.user.id, now(), p.numero_momo || null]);
    }
    await tx.run('DELETE FROM paiements WHERE code_client = ? AND date = ?', [code, date]);
    annule = { date, montant: p.montant, moyen: p.moyen };
  });
  res.json({ annule: true, ...annule });
}));

/* ------------------------------------------------------------------ */
/* Vidange : 100 F par vidange. Le décompte de 14 jours commence le jour où le conducteur a payé. */
/* ------------------------------------------------------------------ */
async function etatVidange(code) {
  const lignes = await db.all('SELECT id, date_paiement, montant, maj_le FROM vidange_paiements WHERE code_client = ? ORDER BY date_paiement DESC, id DESC', [code]);
  const aujourdhui = jourLocal(new Date());
  const derniere = lignes.length ? lignes[0].date_paiement : null;
  const prochaine = derniere ? addJours(derniere, DELAI_VIDANGE) : null;
  // jours_restants > 0 : à venir ; 0 : à faire aujourd'hui ; < 0 : en retard
  const joursRestants = prochaine ? diffJours(aujourdhui, prochaine) : null;
  return {
    montant: MONTANT_VIDANGE, delai: DELAI_VIDANGE, aujourdhui,
    derniere, prochaine, jours_restants: joursRestants,
    statut: !derniere ? 'jamais' : joursRestants < 0 ? 'retard' : joursRestants === 0 ? 'aujourdhui' : 'ok',
    lignes: lignes.map((l) => ({ ...l, prochaine: addJours(l.date_paiement, DELAI_VIDANGE) }))
  };
}

app.get('/api/vidanges', exigerRole('admin', 'caissiere'), h(async (req, res) => {
  res.json(await etatVidange(texte(req.query.code_client, 20).toUpperCase()));
}));

// Enregistre une vidange payée (par défaut aujourd'hui) : le décompte de 14 jours repart de cette date.
app.post('/api/vidanges', exigerRole('admin', 'caissiere'), h(async (req, res) => {
  const code = texte(req.body.code_client, 20).toUpperCase();
  const aujourdhui = jourLocal(new Date());
  const date = req.body.date ? texte(req.body.date, 10) : aujourdhui;
  const client = await db.get('SELECT statut FROM clients WHERE code = ?', [code]);
  if (!client) return res.status(404).json({ erreur: 'Aucun conducteur avec ce code.' });
  if (client.statut === 'suspendu') return res.status(409).json({ erreur: 'Ce conducteur est suspendu (archivé).' });
  if (!dateValide(date)) return res.status(400).json({ erreur: 'Date de vidange invalide.' });
  if (date > aujourdhui) return res.status(400).json({ erreur: 'La date de la vidange ne peut pas être dans le futur.' });
  if (await db.get('SELECT 1 FROM vidange_paiements WHERE code_client = ? AND date_paiement = ?', [code, date])) {
    return res.status(409).json({ erreur: 'Une vidange est déjà enregistrée pour ce conducteur à cette date.' });
  }
  await db.run('INSERT INTO vidange_paiements (code_client, date_paiement, montant, compte_id, maj_le) VALUES (?,?,?,?,?)',
    [code, date, MONTANT_VIDANGE, req.user.id, now()]);
  res.status(201).json(await etatVidange(code));
}));

/* ------------------------------------------------------------------ */
/* Mes notes : notes personnelles, visibles seulement par leur auteur    */
/* ------------------------------------------------------------------ */
const NOTE_SQL = `SELECT n.id, n.code_client, c.nom AS conducteur, n.texte, n.cree_le, n.maj_le
  FROM notes n LEFT JOIN clients c ON c.code = n.code_client`;

async function codeNote(brut) { // code de conducteur facultatif : doit exister
  const code = texte(brut, 20).toUpperCase();
  if (!code) return { code: null };
  if (!(await db.get('SELECT 1 FROM clients WHERE code = ?', [code]))) return { erreur: 'Aucun conducteur avec ce code : laissez vide ou corrigez le code.' };
  return { code };
}

app.get('/api/notes', exigerRole('admin', 'caissiere'), h(async (req, res) => {
  const q = texte(req.query.q, 60).toLowerCase();
  const params = [req.user.id];
  let filtre = '';
  if (q) { filtre = ' AND (LOWER(n.texte) LIKE ? OR LOWER(COALESCE(n.code_client, \'\')) LIKE ? OR LOWER(COALESCE(c.nom, \'\')) LIKE ?)'; params.push('%' + q + '%', '%' + q + '%', '%' + q + '%'); }
  res.json(await db.all(`${NOTE_SQL} WHERE n.compte_id = ?${filtre} ORDER BY n.maj_le DESC, n.id DESC LIMIT 500`, params));
}));

app.post('/api/notes', exigerRole('admin', 'caissiere'), h(async (req, res) => {
  const t = texte(req.body.texte, 4000);
  if (!t) return res.status(400).json({ erreur: 'Écrivez votre note.' });
  const c = await codeNote(req.body.code_client);
  if (c.erreur) return res.status(400).json({ erreur: c.erreur });
  const id = await db.insertId('INSERT INTO notes (compte_id, code_client, texte, cree_le, maj_le) VALUES (?,?,?,?,?)', [req.user.id, c.code, t, now(), now()]);
  res.status(201).json(await db.get(`${NOTE_SQL} WHERE n.id = ?`, [id]));
}));

// Seul l'auteur peut modifier ou supprimer sa note (l'administrateur ne lit pas les notes des autres comptes).
app.patch('/api/notes/:id', exigerRole('admin', 'caissiere'), h(async (req, res) => {
  const id = idParam(req.params.id);
  const n = await db.get('SELECT id FROM notes WHERE id = ? AND compte_id = ?', [id, req.user.id]);
  if (!n) return res.status(404).json({ erreur: 'Note introuvable.' });
  const champs = {};
  if (req.body.texte !== undefined) {
    const t = texte(req.body.texte, 4000);
    if (!t) return res.status(400).json({ erreur: 'La note ne peut pas être vide.' });
    champs.texte = t;
  }
  if (req.body.code_client !== undefined) {
    const c = await codeNote(req.body.code_client);
    if (c.erreur) return res.status(400).json({ erreur: c.erreur });
    champs.code_client = c.code;
  }
  const cles = Object.keys(champs);
  if (!cles.length) return res.status(400).json({ erreur: 'Aucune modification fournie.' });
  champs.maj_le = now(); cles.push('maj_le');
  await db.run(`UPDATE notes SET ${cles.map((k) => k + ' = ?').join(', ')} WHERE id = ?`, [...cles.map((k) => champs[k]), id]);
  res.json(await db.get(`${NOTE_SQL} WHERE n.id = ?`, [id]));
}));

app.delete('/api/notes/:id', exigerRole('admin', 'caissiere'), h(async (req, res) => {
  const r = await db.run('DELETE FROM notes WHERE id = ? AND compte_id = ?', [idParam(req.params.id), req.user.id]);
  if (!r.changes) return res.status(404).json({ erreur: 'Note introuvable.' });
  res.json({ ok: true });
}));

/* ------------------------------------------------------------------ */
/* Textes (clauses) des contrats, modifiables par l'administrateur       */
/* ------------------------------------------------------------------ */
// On ne stocke que les textes personnalisés (parametres : contrat_journee_payee, contrat_droit_usage).
// Sans texte personnalisé, la page utilise le texte d'origine fourni par contrat.js.
app.get('/api/contrats', exigerRole('admin', 'caissiere'), h(async (req, res) => {
  const out = {};
  for (const t of TYPES_CONTRAT) {
    const r = await db.get('SELECT valeur FROM parametres WHERE cle = ?', ['contrat_' + t]);
    out[t] = r ? r.valeur : null;
  }
  res.json(out);
}));

// Corps : { texte } ; un texte vide rétablit le texte d'origine.
app.put('/api/contrats/:type', exigerRole('admin'), h(async (req, res) => {
  const type = req.params.type;
  if (!TYPES_CONTRAT.includes(type)) return res.status(404).json({ erreur: 'Type de contrat inconnu.' });
  const t = typeof req.body.texte === 'string' ? req.body.texte.replace(/\r\n/g, '\n').trim() : '';
  if (t.length > 30000) return res.status(400).json({ erreur: 'Le texte du contrat est trop long (30 000 caractères au maximum).' });
  if (!t) {
    await db.run('DELETE FROM parametres WHERE cle = ?', ['contrat_' + type]);
    return res.json({ type, texte: null });
  }
  await setParametre('contrat_' + type, t);
  res.json({ type, texte: t });
}));

/* ------------------------------------------------------------------ */
/* Demandes des conducteurs : début d'un contrat ou achat d'une moto     */
/* ------------------------------------------------------------------ */
const TYPES_DEMANDE = ['contrat', 'achat'];            // début de contrat / achat d'une moto
const STATUTS_DEMANDE = ['en_attente', 'acceptee', 'refusee'];
const COLS_DEMANDE = 'id, nom, telephone, adresse, type, type_contrat, moto_souhaitee, message, statut, reponse, code_client, compte_id, cree_le, traitee_le';

// Liste (administrateur) : ?statut=en_attente|acceptee|refusee ; sans filtre, toutes les demandes. En attente d'abord.
app.get('/api/demandes', exigerRole('admin'), h(async (req, res) => {
  const filtre = STATUTS_DEMANDE.includes(req.query.statut);
  res.json(await db.all(`SELECT ${COLS_DEMANDE} FROM demandes ${filtre ? 'WHERE statut = ?' : ''}
    ORDER BY CASE WHEN statut = 'en_attente' THEN 0 ELSE 1 END, cree_le DESC, id DESC`, filtre ? [req.query.statut] : []));
}));

app.get('/api/demandes/:id', exigerRole('admin'), h(async (req, res) => {
  const d = await db.get(`SELECT ${COLS_DEMANDE} FROM demandes WHERE id = ?`, [idParam(req.params.id)]);
  if (!d) return res.status(404).json({ erreur: 'Demande introuvable.' });
  res.json(d);
}));

// Enregistrer une demande (administrateur ou caissière)
app.post('/api/demandes', exigerRole('admin', 'caissiere'), h(async (req, res) => {
  const nom = texte(req.body.nom, 100), telephone = texte(req.body.telephone, 30), adresse = texte(req.body.adresse, 200);
  const type = texte(req.body.type, 10);
  const typeContrat = texte(req.body.type_contrat, 20) || null;
  const moto = texte(req.body.moto_souhaitee, 100) || null;
  const message = texte(req.body.message, 1000) || null;
  if (nom.length < 2) return res.status(400).json({ erreur: 'Entrez le nom du demandeur.' });
  if (!telephone) return res.status(400).json({ erreur: 'Entrez le numéro de téléphone du demandeur.' });
  if (!TYPES_DEMANDE.includes(type)) return res.status(400).json({ erreur: "Choisissez le type de demande (début de contrat ou achat d'une moto)." });
  if (typeContrat && !TYPES_CONTRAT.includes(typeContrat)) return res.status(400).json({ erreur: 'Type de contrat invalide.' });
  const id = await db.insertId('INSERT INTO demandes (nom, telephone, adresse, type, type_contrat, moto_souhaitee, message, statut, compte_id, cree_le) VALUES (?,?,?,?,?,?,?,?,?,?)',
    [nom, telephone, adresse || null, type, typeContrat, moto, message, 'en_attente', req.user.id, now()]);
  res.status(201).json(await db.get(`SELECT ${COLS_DEMANDE} FROM demandes WHERE id = ?`, [id]));
}));

// Traiter une demande : accepter (avec le code du conducteur créé), refuser (avec un motif facultatif) ou la remettre en attente
app.patch('/api/demandes/:id', exigerRole('admin'), h(async (req, res) => {
  const d = await db.get(`SELECT ${COLS_DEMANDE} FROM demandes WHERE id = ?`, [idParam(req.params.id)]);
  if (!d) return res.status(404).json({ erreur: 'Demande introuvable.' });
  const champs = {};
  if (req.body.statut !== undefined) {
    if (!STATUTS_DEMANDE.includes(req.body.statut)) return res.status(400).json({ erreur: 'Statut invalide.' });
    champs.statut = req.body.statut;
    champs.traitee_le = req.body.statut === 'en_attente' ? null : now();
  }
  if (req.body.reponse !== undefined) champs.reponse = texte(req.body.reponse, 500) || null;
  if (req.body.code_client !== undefined) {
    const code = texte(req.body.code_client, 20).toUpperCase();
    if (code && !(await db.get('SELECT 1 FROM clients WHERE code = ?', [code]))) return res.status(400).json({ erreur: 'Aucun conducteur avec ce code.' });
    champs.code_client = code || null;
  }
  const cles = Object.keys(champs);
  if (!cles.length) return res.status(400).json({ erreur: 'Aucune modification fournie.' });
  await db.run(`UPDATE demandes SET ${cles.map((c) => c + ' = ?').join(', ')} WHERE id = ?`, [...cles.map((c) => champs[c]), d.id]);
  res.json(await db.get(`SELECT ${COLS_DEMANDE} FROM demandes WHERE id = ?`, [d.id]));
}));

app.delete('/api/demandes/:id', exigerRole('admin'), h(async (req, res) => {
  const d = await db.get('SELECT id FROM demandes WHERE id = ?', [idParam(req.params.id)]);
  if (!d) return res.status(404).json({ erreur: 'Demande introuvable.' });
  await db.run('DELETE FROM demandes WHERE id = ?', [d.id]);
  res.json({ ok: true });
}));

/* ------------------------------------------------------------------ */
/* Observations (commentaires) sur chaque conducteur                   */
/* ------------------------------------------------------------------ */
app.get('/api/observations', exigerRole('admin', 'caissiere'), h(async (req, res) => {
  const code = texte(req.query.code_client, 20).toUpperCase();
  res.json(await db.all('SELECT id, texte, compte_id, auteur, cree_le FROM observations WHERE code_client = ? ORDER BY cree_le DESC, id DESC', [code]));
}));

app.post('/api/observations', exigerRole('admin', 'caissiere'), h(async (req, res) => {
  const code = texte(req.body.code_client, 20).toUpperCase();
  const t = texte(req.body.texte, 1000);
  if (t.length < 2) return res.status(400).json({ erreur: "Écrivez l'observation (2 caractères au minimum)." });
  if (!(await db.get('SELECT 1 FROM clients WHERE code = ?', [code]))) return res.status(404).json({ erreur: 'Aucun conducteur avec ce code.' });
  await db.run('INSERT INTO observations (code_client, texte, compte_id, auteur, cree_le) VALUES (?,?,?,?,?)', [code, t, req.user.id, req.user.nom, now()]);
  res.status(201).json(await db.all('SELECT id, texte, compte_id, auteur, cree_le FROM observations WHERE code_client = ? ORDER BY cree_le DESC, id DESC', [code]));
}));

// L'administrateur peut supprimer toute observation ; une caissière seulement les siennes.
app.delete('/api/observations/:id', exigerRole('admin', 'caissiere'), h(async (req, res) => {
  const o = await db.get('SELECT id, code_client, compte_id FROM observations WHERE id = ?', [idParam(req.params.id)]);
  if (!o) return res.status(404).json({ erreur: 'Observation introuvable.' });
  if (req.user.role !== 'admin' && o.compte_id !== req.user.id) return res.status(403).json({ erreur: 'Vous ne pouvez supprimer que vos propres observations.' });
  await db.run('DELETE FROM observations WHERE id = ?', [o.id]);
  res.json(await db.all('SELECT id, texte, compte_id, auteur, cree_le FROM observations WHERE code_client = ? ORDER BY cree_le DESC, id DESC', [o.code_client]));
}));

// Admin : conducteurs actifs dont la vidange est en retard (14 jours écoulés depuis la dernière vidange payée).
// Export Excel (CSV) : /api/vidanges/retards?format=csv
app.get('/api/vidanges/retards', exigerRole('admin'), h(async (req, res) => {
  const aujourdhui = jourLocal(new Date());
  const rows = await db.all(`SELECT c.code, c.nom, c.telephone, c.adresse, c.immatriculation, c.temoin_nom, c.temoin_telephone,
      MAX(v.date_paiement) AS derniere, COUNT(v.id) AS nb
    FROM clients c LEFT JOIN vidange_paiements v ON v.code_client = c.code
    WHERE c.statut = 'actif' GROUP BY c.id`);
  const retards = [];
  let jamais = 0;
  for (const r of rows) {
    if (!r.derniere) { jamais++; continue; }
    const due = addJours(r.derniere, DELAI_VIDANGE);
    const retard = diffJours(due, aujourdhui); // > 0 : jours de retard
    if (retard > 0) retards.push({ code: r.code, nom: r.nom, telephone: r.telephone, adresse: r.adresse, immatriculation: r.immatriculation,
      temoin_nom: r.temoin_nom, temoin_telephone: r.temoin_telephone, derniere: r.derniere, due, jours_retard: retard, nb_vidanges: r.nb });
  }
  retards.sort((a, b) => b.jours_retard - a.jours_retard || (a.nom > b.nom ? 1 : -1));

  if (req.query.format === 'csv') {
    const entetes = ['Code', 'Conducteur', 'Téléphone', 'Adresse', 'Plaque', 'Dernière vidange payée', 'Vidange due le', 'Jours de retard', 'Témoin', 'Téléphone du témoin'];
    const lignes = retards.map((c) => [c.code, c.nom, csvTel(c.telephone), c.adresse || '', c.immatriculation || '', c.derniere, c.due, c.jours_retard,
      c.temoin_nom || '', csvTel(c.temoin_telephone)].map(csvEchappe).join(';'));
    res.set('Content-Type', 'text/csv; charset=utf-8');
    res.set('Content-Disposition', `attachment; filename="vidanges_en_retard_${aujourdhui}.csv"`);
    return res.send('\uFEFF' + [entetes.join(';'), ...lignes].join('\r\n'));
  }
  res.json({ date: aujourdhui, delai: DELAI_VIDANGE, sans_vidange: jamais, conducteurs: retards });
}));

// Annule une vidange saisie par erreur : le décompte repart de la vidange précédente.
app.delete('/api/vidanges/:id', exigerRole('admin', 'caissiere'), h(async (req, res) => {
  const v = await db.get('SELECT id, code_client FROM vidange_paiements WHERE id = ?', [idParam(req.params.id)]);
  if (!v) return res.status(404).json({ erreur: 'Vidange introuvable.' });
  await db.run('DELETE FROM vidange_paiements WHERE id = ?', [v.id]);
  res.json(await etatVidange(v.code_client));
}));

/* ------------------------------------------------------------------ */
/* Tableau de bord (admin)                                             */
/* ------------------------------------------------------------------ */
const jourLocal = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: FUSEAU }).format(d);
const heureLocale = (iso) => new Intl.DateTimeFormat('fr-FR', { timeZone: FUSEAU, hour: '2-digit', minute: '2-digit' }).format(new Date(iso));

// Fiabilité : part des jours payés depuis l'inscription (plafonné à 30 jours). null si l'historique est trop court (< 3 jours).
// Les jours payés des 30 derniers jours de TOUS les conducteurs sont lus en une seule requête.
const borne30jours = () => jourLocal(new Date(Date.now() - 29 * 86400000));
async function joursPayes30j() {
  const parCode = new Map();
  for (const r of await db.all('SELECT code_client, date FROM paiements WHERE paye = 1 AND date >= ? AND date <= ?', [borne30jours(), jourLocal(new Date())])) {
    if (!parCode.has(r.code_client)) parCode.set(r.code_client, []);
    parCode.get(r.code_client).push(r.date);
  }
  return parCode;
}
function fiabilite30j(parCode, code, dateCreationIso) {
  const aujourdhui = jourLocal(new Date());
  const borne30j = borne30jours();
  const inscription = dateCreationIso ? dateCreationIso.slice(0, 10) : borne30j;
  const debut = inscription > borne30j ? inscription : borne30j;
  const joursHistorique = Math.round((new Date(aujourdhui) - new Date(debut)) / 86400000) + 1;
  if (joursHistorique < 3) return { pourcentage: null, jours_historique: joursHistorique };
  const payes = (parCode.get(code) || []).filter((d) => d >= debut).length;
  return { pourcentage: Math.round((payes / joursHistorique) * 100), jours_historique: joursHistorique };
}

// « Visiteurs » = conducteurs en contrat « Journée payée » (pré-contrat de 14 jours). Pendant les 13 premiers jours, les jours non payés
// ne sont PAS comptés comme impayés (sursis) ; le 14e jour, ce qui reste non payé devient « impayé ».
const JOURS_SURSIS = 13;
function sursisVisiteur(c, aujourdhui) {
  if (!c || c.type_contrat !== 'journee_payee') return { visiteur: false, sursis: false, jour: null };
  const debut = ((c.date_debut || c.date_creation) || '').slice(0, 10);
  if (!dateValide(debut)) return { visiteur: true, sursis: false, jour: null };
  const jour = diffJours(debut, aujourdhui) + 1; // le jour de début est le jour 1
  return { visiteur: true, sursis: jour <= JOURS_SURSIS, jour };
}

// Jours impayés CUMULÉS (strictement avant aujourd'hui) : jours suivis (début du contrat -> veille, borné par la fin)
// sans paiement complet. Montant dû = ce qui manque sur ces jours.
async function bilansImpayes(aujourdhui, clients) {
  const veille = new Date(aujourdhui + 'T00:00:00Z'); veille.setUTCDate(veille.getUTCDate() - 1);
  const veilleStr = veille.toISOString().slice(0, 10);
  const parCode = new Map();
  (await db.all('SELECT code_client, date, paye, montant FROM paiements WHERE date <= ?', [veilleStr])).forEach((p) => {
    if (!parCode.has(p.code_client)) parCode.set(p.code_client, new Map());
    parCode.get(p.code_client).set(p.date, p);
  });
  const out = new Map();
  for (const c of clients) {
    const debut = ((c.date_debut || c.date_creation) || '').slice(0, 10);
    let fin = (c.date_fin || '').slice(0, 10);
    if (!fin || fin > veilleStr) fin = veilleStr;
    const cible = cibleJourniere(c);
    const jours = parCode.get(c.code) || new Map();
    let n = 0, du = 0, depuis = null, serie = 0, nbPeriodes = 0;
    if (frequenceDe(c) !== 'jour') {
      // Par semaine / mois : une période terminée est impayée si la somme versée pendant la période n'atteint pas le montant dû.
      // Les jours impayés comptent alors tous les jours de ces périodes (les seuils 2, 3, 4… jours restent comparables).
      for (const p of periodesDe(c, veilleStr).filter((x) => x.fin <= veilleStr)) {
        const verse = sommeJours(jours, p.debut, p.fin), dueP = dueDe(p, cible);
        if (verse < dueP) { n += p.jours; du += dueP - verse; nbPeriodes++; if (!depuis) depuis = p.debut; serie += p.jours; } else serie = 0;
      }
    } else if (dateValide(debut) && dateValide(fin)) {
      const j = new Date(debut + 'T00:00:00Z'); const limite = new Date(fin + 'T00:00:00Z');
      while (j <= limite) {
        const k = j.toISOString().slice(0, 10);
        const p = jours.get(k);
        if (p && p.paye) serie = 0;
        else { n++; du += Math.max(0, cible - (p ? Math.min(p.montant, cible) : 0)); if (!depuis) depuis = k; serie++; }
        j.setUTCDate(j.getUTCDate() + 1);
      }
    }
    const sv = sursisVisiteur(c, aujourdhui);
    if (sv.sursis) {
      // Sursis : rien n'est compté comme impayé pour l'instant (on garde le détail « en attente » pour l'affichage).
      out.set(c.code, { jours_impayes: 0, montant_du: 0, depuis: null, consecutifs: 0, periodes_impayees: 0, frequence: frequenceDe(c),
        visiteur: true, sursis: true, jour_precontrat: sv.jour, jours_en_attente: n, montant_en_attente: du });
    } else {
      out.set(c.code, { jours_impayes: n, montant_du: du, depuis, consecutifs: serie, periodes_impayees: nbPeriodes, frequence: frequenceDe(c),
        visiteur: sv.visiteur, sursis: false, jour_precontrat: sv.jour, jours_en_attente: 0, montant_en_attente: 0 });
    }
  }
  return out;
}

// Tout ce qui a été REÇU un jour donné (journal des versements) : par conducteur, avec moyen(s) et
// les anciens jours éventuellement régularisés grâce au surplus. Reprend aussi les paiements saisis
// avant la mise en place du journal.
async function versementsDuJour(dateStr) {
  const ledger = await db.all(`SELECT v.code_client AS code, c.nom AS nom, SUM(v.montant) AS total, MAX(v.cree_le) AS dernier,
        ${db.groupConcat('v.moyen')} AS moyens, ${db.groupConcat('v.numero_momo')} AS numeros
      FROM versements v LEFT JOIN clients c ON c.code = v.code_client
      WHERE v.jour_saisie = ? GROUP BY v.code_client, c.nom`, [dateStr]);
  const codesJournal = new Set(ledger.map((r) => r.code));
  const regs = await db.all(`SELECT code_client AS code, jour_concerne AS date, SUM(montant) AS montant FROM versements
      WHERE jour_saisie = ? AND jour_concerne <> jour_saisie GROUP BY code_client, jour_concerne HAVING SUM(montant) > 0`, [dateStr]);
  const duJour = new Map((await db.all('SELECT * FROM paiements WHERE date = ?', [dateStr])).map((p) => [p.code_client, p]));
  const anciens = (await db.all(`SELECT p.code_client AS code, c.nom AS nom, p.montant AS total, p.maj_le AS dernier, p.moyen AS moyens, p.numero_momo AS numeros
      FROM paiements p LEFT JOIN clients c ON c.code = p.code_client WHERE p.date = ? AND p.montant > 0`, [dateStr]))
    .filter((r) => !codesJournal.has(r.code) && jourLocal(new Date(r.dernier)) === dateStr);

  const payes = ledger.concat(anciens).filter((r) => r.total > 0).map((r) => {
    const p = duJour.get(r.code);
    return {
      code: r.code, nom: r.nom || 'Conducteur supprimé', montant: r.total,
      moyens: (r.moyens || '').split(',').filter(Boolean), numeros: (r.numeros || '').split(',').filter(Boolean), heure: heureLocale(r.dernier),
      complet: !!(p && p.paye), regularisations: regs.filter((g) => g.code === r.code && g.date < dateStr).map((g) => ({ date: g.date, montant: g.montant })),
      avances: regs.filter((g) => g.code === r.code && g.date > dateStr).map((g) => ({ date: g.date, montant: g.montant })).sort((a, b) => (a.date > b.date ? 1 : -1)),
      _t: r.dernier
    };
  }).sort((x, y) => (y._t > x._t ? 1 : -1)).map(({ _t, ...r }) => r);

  const parMoyen = { especes: 0, momo: 0, momo_regulateur: 0, non_precise: 0 };
  (await db.all('SELECT moyen, SUM(montant) AS t FROM versements WHERE jour_saisie = ? GROUP BY moyen', [dateStr]))
    .forEach((r) => { parMoyen[MOYENS[r.moyen] ? r.moyen : 'non_precise'] += r.t; });
  anciens.forEach((r) => { parMoyen[MOYENS[r.moyens] ? r.moyens : 'non_precise'] += r.total; });
  // Total reçu par numéro Mobile Money (pour rapprocher avec les relevés MOMO).
  const parNumero = {};
  (await db.all('SELECT numero_momo AS n, SUM(montant) AS t FROM versements WHERE jour_saisie = ? AND numero_momo IS NOT NULL GROUP BY numero_momo', [dateStr]))
    .forEach((r) => { if (r.t > 0) parNumero[r.n] = r.t; });
  anciens.forEach((r) => { if (r.numeros) parNumero[r.numeros] = (parNumero[r.numeros] || 0) + r.total; });
  // Vidanges payées ce jour-là : comptées à part de la redevance.
  const vid = await db.get('SELECT COUNT(*) AS n, COALESCE(SUM(montant), 0) AS t FROM vidange_paiements WHERE date_paiement = ?', [dateStr]);
  return { payes, totaux: { encaisse: payes.reduce((t, r) => t + r.montant, 0), nb_payeurs: payes.length, par_moyen: parMoyen, par_numero: parNumero,
    vidanges_nb: vid.n, vidanges_total: vid.t } };
}

// Collecte du jour pour un conducteur actif donné (utilisé par le tableau de bord et la tournée caissière).
async function calculerCollectesDuJour(dateStr, defaut) {
  const actifs = await db.all("SELECT code, nom, telephone, date_creation, date_debut, date_fin, montant_journalier, frequence, type_contrat FROM clients WHERE statut = 'actif'");
  const duJour = new Map((await db.all('SELECT * FROM paiements WHERE date = ?', [dateStr])).map((p) => [p.code_client, p]));
  const bilans = await bilansImpayes(dateStr, actifs);
  const payes30 = await joursPayes30j();
  const collectes = [];
  for (const c of actifs) {
    const p = duJour.get(c.code);
    const freq = frequenceDe(c);
    let cible = c.montant_journalier || defaut;
    let statut = 'attente', reste = cible, verse = null, per = null;
    if (freq === 'jour') {
      if (p) statut = p.paye ? 'paye' : (p.montant > 0 ? 'partiel' : 'retard');
    } else {
      // Par semaine / mois : la situation du jour dépend de la période en cours (somme versée depuis son début).
      per = periodeDe(c, dateStr);
      if (per) {
        cible = dueDe(per, cible);
        verse = (await db.get('SELECT COALESCE(SUM(montant), 0) AS t FROM paiements WHERE code_client = ? AND date >= ? AND date <= ?', [c.code, per.debut, per.fin])).t;
        statut = verse >= cible ? 'paye' : (verse > 0 ? 'partiel' : (p ? 'retard' : 'attente'));
        reste = Math.max(0, cible - (verse - (p ? p.montant : 0))); // montant à saisir aujourd'hui pour compléter la période
      }
    }
    const fiab = freq === 'jour' ? fiabilite30j(payes30, c.code, c.date_creation) : { pourcentage: null, jours_historique: 0 };
    const b = bilans.get(c.code);
    // Visiteur en sursis : pas d'« impayé » (statut neutre « attente ») tant que le 14e jour n'est pas arrivé.
    if (b.sursis && statut !== 'paye' && statut !== 'partiel') statut = 'attente';
    collectes.push({
      code: c.code, nom: c.nom, statut, montant: p ? p.montant : 0, moyen: p ? p.moyen : null, numero_momo: p ? p.numero_momo : null, cible, heure: p ? heureLocale(p.maj_le) : null,
      frequence: freq, reste, verse_periode: verse, periode_debut: per ? per.debut : null, periode_fin: per ? per.fin : null, regle_le: p ? p.regle_le : null,
      fiabilite: fiab.pourcentage, fiabilite_jours: fiab.jours_historique,
      jours_impayes: b.jours_impayes, montant_du: b.montant_du,
      sursis: b.sursis, jour_precontrat: b.jour_precontrat, jours_en_attente: b.jours_en_attente, montant_en_attente: b.montant_en_attente
    });
  }
  const rang = { paye: 0, partiel: 0, retard: 1, attente: 2 };
  collectes.sort((a, b) => rang[a.statut] - rang[b.statut] || (a.fiabilite ?? 101) - (b.fiabilite ?? 101) || a.nom.localeCompare(b.nom));
  return collectes;
}

app.get('/api/tableau-de-bord', exigerRole('admin'), h(async (req, res) => {
  const maintenant = new Date();
  const aujourdhui = jourLocal(maintenant);
  const jour = (n) => jourLocal(new Date(maintenant.getTime() - n * 86400000));
  const somme = async (d) => (await db.get('SELECT COALESCE(SUM(montant), 0) AS t FROM paiements WHERE date = ? AND paye = 1', [d])).t;
  const defaut = getVersementDefaut();

  const total = (await db.get('SELECT COUNT(*) AS n FROM clients')).n;
  const conducteursActifs = (await db.get("SELECT COUNT(*) AS n FROM clients WHERE statut = 'actif'")).n;
  const collectes = await calculerCollectesDuJour(aujourdhui, defaut);

  const financements = (await db.all(`
    SELECT c.code, c.nom, c.prix_moto AS prix, c.montant_journalier, c.frequence,
           COALESCE(SUM(CASE WHEN p.paye = 1 THEN p.montant END), 0) AS verse
    FROM clients c LEFT JOIN paiements p ON p.code_client = c.code
    WHERE c.prix_moto > 0 GROUP BY c.id`))
    .map((f) => ({
      code: f.code, nom: f.nom, prix: f.prix, verse: f.verse,
      pct: Math.min(100, Math.floor((f.verse / f.prix) * 100)),
      jours_restants: Math.max(0, Math.ceil((f.prix - f.verse) / parJour(f, f.montant_journalier || defaut)))
    }))
    .sort((a, b) => b.pct - a.pct);

  res.json({
    date: aujourdhui,
    versement_journalier: defaut,
    collecte_aujourdhui: await somme(aujourdhui),
    collecte_hier: await somme(jour(1)),
    conducteurs_actifs: conducteursActifs,
    conducteurs_total: total,
    attendus: conducteursActifs,
    payes: collectes.filter((c) => c.statut === 'paye' || c.statut === 'partiel').length,
    motos_financees: financements.filter((f) => f.verse >= f.prix).length,
    collectes,
    jour: await versementsDuJour(aujourdhui),
    sept_jours: await Promise.all(Array.from({ length: 7 }, async (_, i) => { const d = jour(6 - i); return { date: d, total: await somme(d) }; })),
    financements: financements.slice(0, 8)
  });
}));

/* ------------------------------------------------------------------ */
/* Tournée du jour (caissière) — tous les conducteurs actifs, statut du jour */
/* ------------------------------------------------------------------ */
app.get('/api/tournee', exigerRole('admin', 'caissiere'), h(async (req, res) => {
  const aujourdhui = jourLocal(new Date());
  const collectes = await calculerCollectesDuJour(aujourdhui, getVersementDefaut());
  const jour = await versementsDuJour(aujourdhui);
  res.json({
    date: aujourdhui,
    tournee: collectes.map((c) => ({
      code: c.code, nom: c.nom, cible: c.cible, montant: c.montant, moyen: c.moyen, numero_momo: c.numero_momo,
      frequence: c.frequence, reste: c.reste, verse_periode: c.verse_periode, periode_debut: c.periode_debut, periode_fin: c.periode_fin, regle_le: c.regle_le,
      paye: c.statut === 'paye', statut: c.statut, heure: c.heure, fiabilite: c.fiabilite, fiabilite_jours: c.fiabilite_jours,
      jours_impayes: c.jours_impayes, montant_du: c.montant_du,
      sursis: c.sursis, jour_precontrat: c.jour_precontrat, jours_en_attente: c.jours_en_attente, montant_en_attente: c.montant_en_attente
    })),
    payes: jour.payes,
    totaux: { ...jour.totaux, nb_impayes: collectes.filter((c) => c.statut !== 'paye' && !c.sursis).length }
  });
}));

/* Point personnel : ce que CETTE caissière a encaissé (le journal des versements retient qui a saisi quoi).
 * L'admin peut consulter celui d'une caissière avec ?compte_id=… */
app.get('/api/mon-point', exigerRole('admin', 'caissiere'), h(async (req, res) => {
  let compteId = req.user.id, nom = req.user.nom;
  if (req.user.role === 'admin' && req.query.compte_id) {
    const c = await db.get("SELECT id, nom FROM comptes WHERE id = ? AND role = 'caissiere'", [idParam(req.query.compte_id)]);
    if (!c) return res.status(404).json({ erreur: 'Caissière introuvable.' });
    compteId = c.id; nom = c.nom;
  }
  const aujourdhui = jourLocal(new Date());
  const jour = dateValide(String(req.query.date || '')) ? String(req.query.date) : aujourdhui;
  const mois = jour.slice(0, 7);

  const parMoyen = { especes: 0, momo: 0, momo_regulateur: 0, non_precise: 0 };
  (await db.all('SELECT moyen, SUM(montant) AS t FROM versements WHERE compte_id = ? AND jour_saisie = ? GROUP BY moyen', [compteId, jour]))
    .forEach((r) => { parMoyen[MOYENS[r.moyen] ? r.moyen : 'non_precise'] += r.t; });
  const lignes = await db.all(`SELECT v.code_client AS code, c.nom AS nom, SUM(v.montant) AS montant, MAX(v.cree_le) AS dernier,
        ${db.groupConcat('v.moyen')} AS moyens
      FROM versements v LEFT JOIN clients c ON c.code = v.code_client
      WHERE v.compte_id = ? AND v.jour_saisie = ? GROUP BY v.code_client, c.nom HAVING SUM(v.montant) <> 0`, [compteId, jour]);
  const vid = await db.get('SELECT COUNT(*) AS n, COALESCE(SUM(montant), 0) AS t FROM vidange_paiements WHERE compte_id = ? AND date_paiement = ?', [compteId, jour]);
  const moisTot = await db.get('SELECT COALESCE(SUM(montant), 0) AS t, COUNT(DISTINCT code_client) AS n FROM versements WHERE compte_id = ? AND jour_saisie LIKE ?', [compteId, mois + '-%']);
  const parJour = await db.all(`SELECT jour_saisie AS date, SUM(montant) AS total FROM versements
      WHERE compte_id = ? AND jour_saisie LIKE ? GROUP BY jour_saisie ORDER BY jour_saisie DESC`, [compteId, mois + '-%']);
  const total = Object.values(parMoyen).reduce((a, b) => a + b, 0);
  res.json({
    caissiere: nom, date: jour, aujourdhui,
    jour: {
      encaisse: total, par_moyen: parMoyen, nb_conducteurs: lignes.length, vidanges_nb: vid.n, vidanges_total: vid.t,
      lignes: lignes.map((l) => ({ code: l.code, nom: l.nom || 'Conducteur supprimé', montant: l.montant, moyens: (l.moyens || '').split(',').filter(Boolean), heure: heureLocale(l.dernier) }))
        .sort((a, b) => (a.heure < b.heure ? 1 : -1))
    },
    mois: { mois, encaisse: moisTot.t, nb_conducteurs: moisTot.n, jours: parJour.map((r) => ({ date: r.date, total: r.total })) }
  });
}));

// Admin : conducteurs actifs avec au moins N jours impayés cumulés (avant aujourd'hui).
app.get('/api/impayes', exigerRole('admin'), h(async (req, res) => {
  const min = Math.min(Math.max(parseInt(req.query.min, 10) || 2, 1), 60);
  const aujourdhui = jourLocal(new Date());
  const actifs = await db.all(`SELECT id, code, nom, telephone, adresse, immatriculation, temoin_nom, temoin_telephone, temoin_adresse,
      date_creation, date_debut, date_fin, montant_journalier, frequence, type_contrat FROM clients WHERE statut = 'actif'`);
  const bilans = await bilansImpayes(aujourdhui, actifs);
  const tous = actifs.map((c) => ({ id: c.id, code: c.code, nom: c.nom, telephone: c.telephone, adresse: c.adresse, immatriculation: c.immatriculation,
    temoin_nom: c.temoin_nom, temoin_telephone: c.temoin_telephone, temoin_adresse: c.temoin_adresse, ...bilans.get(c.code),
    saisie_possible: bilans.get(c.code).montant_du >= SEUIL_SAISIE })).filter((c) => c.jours_impayes >= 1);
  const compteurs = {};
  [1, 2, 3, 4, 5].forEach((n) => { compteurs[n] = tous.filter((c) => c.jours_impayes >= n).length; });
  const conducteurs = tous.filter((c) => c.jours_impayes >= min).sort((x, y) => y.jours_impayes - x.jours_impayes || y.montant_du - x.montant_du);

  // Export Excel (CSV) : /api/impayes?min=2&format=csv
  if (req.query.format === 'csv') {
    const entetes = ['Code', 'Conducteur', 'Téléphone', 'Adresse', 'Plaque', 'Paiement', 'Jours impayés', 'Montant dû (F CFA)', 'Impayés depuis',
      'Témoin', 'Téléphone du témoin', 'Adresse du témoin', 'Saisie possible'];
    const lignes = conducteurs.map((c) => [
      c.code, c.nom, csvTel(c.telephone), c.adresse || '', c.immatriculation || '', ({ jour: 'Par jour', semaine: 'Par semaine', mois: 'Par mois' })[c.frequence] || '',
      c.jours_impayes, c.montant_du, c.depuis || '',
      c.temoin_nom || '', csvTel(c.temoin_telephone), c.temoin_adresse || '', c.saisie_possible ? 'Oui' : 'Non'
    ].map(csvEchappe).join(';'));
    res.set('Content-Type', 'text/csv; charset=utf-8');
    res.set('Content-Disposition', `attachment; filename="impayes_${min}_jours_et_plus_${aujourdhui}.csv"`);
    return res.send('\uFEFF' + [entetes.join(';'), ...lignes].join('\r\n'));
  }

  res.json({ date: aujourdhui, min, seuil_saisie: SEUIL_SAISIE, compteurs, conducteurs });
}));

/* ------------------------------------------------------------------ */
/* Financement des motos (page « Motos & financement »)                */
/* ------------------------------------------------------------------ */
app.get('/api/financements', exigerRole('admin'), h(async (req, res) => {
  const defaut = getVersementDefaut();
  const rows = await db.all(`
    SELECT c.id, c.code, c.nom, c.statut, c.date_creation, c.prix_moto, c.montant_journalier, c.frequence,
           COALESCE(SUM(CASE WHEN p.paye = 1 THEN p.montant END), 0) AS verse
    FROM clients c LEFT JOIN paiements p ON p.code_client = c.code
    WHERE c.statut <> 'suspendu'
    GROUP BY c.id ORDER BY c.nom`);
  const payes30 = await joursPayes30j();

  res.json(rows.map((f) => {
    const cible = f.montant_journalier || defaut;
    const pct = f.prix_moto ? Math.min(100, Math.floor((f.verse / f.prix_moto) * 100)) : null;
    const jours_restants = f.prix_moto ? Math.max(0, Math.ceil((f.prix_moto - f.verse) / parJour(f, cible))) : null;
    const fiab = frequenceDe(f) === 'jour' ? fiabilite30j(payes30, f.code, f.date_creation) : { pourcentage: null, jours_historique: 0 };
    return { ...f, montant_journalier_effectif: cible, pct, jours_restants, fiabilite: fiab.pourcentage, fiabilite_jours: fiab.jours_historique };
  }));
}));

/* ------------------------------------------------------------------ */
/* Journal des collectes (page « Collectes journalières »)             */
/* ------------------------------------------------------------------ */
function csvEchappe(v) {
  const s = String(v == null ? '' : v);
  return /[",;\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
// Numéro de téléphone pour Excel : « +229 97… » serait pris pour une formule (#NOM?). ="…" force l'affichage du texte.
const csvTel = (v) => (v ? '="' + String(v).replace(/"/g, '') + '"' : '');

app.get('/api/collectes', exigerRole('admin'), h(async (req, res) => {
  const premierJourMois = jourLocal(new Date()).slice(0, 7) + '-01';
  const debut = dateValide(req.query.debut) ? req.query.debut : premierJourMois;
  const fin = dateValide(req.query.fin) ? req.query.fin : jourLocal(new Date());
  if (debut > fin) return res.status(400).json({ erreur: 'La date de début doit précéder la date de fin.' });

  const where = ['p.date BETWEEN ? AND ?'];
  const args = [debut, fin];
  const code = texte(req.query.code_client, 20).toUpperCase();
  if (code) { where.push('p.code_client = ?'); args.push(code); }

  const rows = await db.all(`
    SELECT p.date, p.code_client, c.nom AS client_nom, c.telephone AS client_telephone, c.adresse AS client_adresse,
           c.immatriculation, c.temoin_nom, c.temoin_telephone, p.montant, p.paye, p.maj_le, p.moyen, p.numero_momo,
           COALESCE(co.nom, 'Compte supprimé') AS caissiere_nom
    FROM paiements p
    LEFT JOIN clients c ON c.code = p.code_client
    LEFT JOIN comptes co ON co.id = p.compte_id
    WHERE ${where.join(' AND ')}
    ORDER BY p.date DESC, p.maj_le DESC
    LIMIT 5000`, args);

  if (req.query.format === 'csv') {
    const entetes = ['Date', 'Code', 'Conducteur', 'Téléphone', 'Adresse', 'Plaque', 'Témoin', 'Téléphone du témoin',
      'Montant (F CFA)', 'Moyen', 'Numéro MOMO', 'Statut', 'Caissière', 'Enregistré le'];
    const lignes = rows.map((r) => [
      r.date, r.code_client, r.client_nom || '', csvTel(r.client_telephone), r.client_adresse || '', r.immatriculation || '', r.temoin_nom || '', csvTel(r.temoin_telephone),
      r.montant, MOYENS[r.moyen] || '', r.numero_momo || '', r.paye ? 'Payé' : 'Impayé', r.caissiere_nom, r.maj_le
    ].map(csvEchappe).join(';'));
    const csv = '\uFEFF' + [entetes.join(';'), ...lignes].join('\r\n');
    res.set('Content-Type', 'text/csv; charset=utf-8');
    res.set('Content-Disposition', `attachment; filename="collectes_${debut}_${fin}.csv"`);
    return res.send(csv);
  }

  res.json({
    debut, fin,
    total_collecte: rows.reduce((s, r) => s + (r.paye ? r.montant : 0), 0),
    nb_versements: rows.filter((r) => r.paye).length,
    lignes: rows.map((r) => ({ ...r, paye: !!r.paye }))
  });
}));

/* ------------------------------------------------------------------ */
/* Pages statiques (uniquement le dossier public/) et erreurs          */
/* ------------------------------------------------------------------ */
// Contrôle de santé pour Render (sans connexion requise) : le site répond et la base aussi.
app.get('/healthz', async (req, res) => {
  try { await db.get('SELECT 1 AS ok'); res.json({ ok: true }); }
  catch (e) { console.error('healthz :', e.message); res.status(503).json({ ok: false }); }
});

app.use(express.static(path.join(__dirname, 'public'), { index: 'login.html' }));

app.use('/api', (req, res) => res.status(404).json({ erreur: 'Route introuvable.' }));
app.use((err, req, res, next) => {
  if (err.type === 'entity.parse.failed') return res.status(400).json({ erreur: 'Requête invalide.' });
  console.error(err);
  res.status(500).json({ erreur: 'Erreur interne du serveur.' });
});

let serveur = null;
demarrer()
  .then(() => {
    serveur = app.listen(PORT, '0.0.0.0', () => console.log(`Soft Moto : port ${PORT}  (base : ${db.dialect === 'postgres' ? 'PostgreSQL' : 'SQLite'})`));
  })
  .catch((e) => { console.error('Démarrage impossible :', e.message); process.exit(1); });

// Arrêt propre quand Render redémarre ou redéploie le site : on termine les requêtes en cours puis on ferme la base.
process.on('SIGTERM', () => {
  const fin = () => Promise.resolve(db.fermer()).finally(() => process.exit(0));
  setTimeout(() => process.exit(0), 10000).unref();
  if (serveur) serveur.close(fin); else fin();
});
process.on('unhandledRejection', (e) => console.error('Erreur non gérée :', e));
