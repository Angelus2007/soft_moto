'use strict';
/*
 * Copie les données d'un fichier SQLite Soft Moto (softmoto.db) vers PostgreSQL.
 *
 *   DATABASE_URL=postgresql://utilisateur:motdepasse@hote:5432/softmoto  node migrer-vers-postgres.js [chemin/softmoto.db]
 *   (ou :  npm run migrer -- chemin/softmoto.db)
 *
 * À lancer UNE FOIS, avant le premier démarrage du serveur sur PostgreSQL (sinon le serveur crée déjà
 * un administrateur). Aucune donnée du fichier SQLite n'est modifiée ni supprimée (gardez-le comme sauvegarde ;
 * si des fichiers softmoto.db-wal / softmoto.db-shm existent, ils doivent rester à côté). Les sessions ne sont pas copiées :
 * tout le monde devra simplement se reconnecter.
 */
const fs = require('fs');
const path = require('path');

if (!/^postgres(ql)?:\/\//i.test(process.env.DATABASE_URL || '')) {
  console.error('DATABASE_URL est absente ou invalide.\nExemple : DATABASE_URL=postgresql://softmoto:motdepasse@localhost:5432/softmoto npm run migrer');
  process.exit(1);
}
const db = require('./db');
const creerSchema = require('./schema');

const args = process.argv.slice(2);
const forcer = args.includes('--forcer');
const source = args.find((a) => !a.startsWith('--')) || process.env.DB_PATH || path.join(__dirname, 'softmoto.db');
if (!fs.existsSync(source)) { console.error(`Fichier SQLite introuvable : ${source}`); process.exit(1); }

let lite;
try { const D = require('better-sqlite3'); const d = new D(source); lite = { all: (s, p) => d.prepare(s).all(...(p || [])) }; }
catch (e) { const { DatabaseSync } = require('node:sqlite'); const d = new DatabaseSync(source); lite = { all: (s, p) => d.prepare(s).all(...(p || [])) }; }

const TABLES = ['comptes', 'clients', 'paiements', 'versements', 'connexions', 'parametres']; // « sessions » volontairement non copiée
const AVEC_ID = ['comptes', 'clients', 'paiements', 'versements', 'connexions'];

(async () => {
  const tablesSource = lite.all("SELECT name FROM sqlite_master WHERE type = 'table'").map((r) => r.name);
  if (!tablesSource.includes('comptes') || !tablesSource.includes('clients')) {
    console.error('Ce fichier SQLite est trop ancien. Lancez d\'abord le serveur une fois sans DATABASE_URL (npm start) pour le mettre à jour, puis relancez la migration.');
    process.exit(1);
  }
  const colsClients = lite.all('PRAGMA table_info(clients)').map((c) => c.name);
  if (!colsClients.includes('code')) { console.error('Mettez d\'abord à jour le fichier SQLite en lançant le serveur une fois sans DATABASE_URL (npm start).'); process.exit(1); }

  await creerSchema(db);
  const dejaLa = (await db.get('SELECT COUNT(*) AS n FROM comptes')).n + (await db.get('SELECT COUNT(*) AS n FROM clients')).n;
  if (dejaLa > 0 && !forcer) {
    console.error('La base PostgreSQL contient déjà des données (comptes ou conducteurs). Migration annulée pour ne rien écraser.\nUtilisez une base vide, ou ajoutez --forcer pour ajouter seulement ce qui manque.');
    process.exit(1);
  }

  const bilan = [];
  for (const table of TABLES) {
    if (!tablesSource.includes(table)) { bilan.push([table, 0, 0]); continue; }
    const colsSource = lite.all(`PRAGMA table_info(${table})`).map((c) => c.name);
    const colsCible = await db.colonnes(table);
    const cols = colsSource.filter((c) => colsCible.includes(c));
    const lignes = lite.all(`SELECT ${cols.join(', ')} FROM ${table}`);
    const sql = `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')}) ON CONFLICT DO NOTHING`;
    await db.tx(async (tx) => { for (const l of lignes) await tx.run(sql, cols.map((c) => (l[c] === undefined ? null : l[c]))); });
    bilan.push([table, lignes.length, (await db.get(`SELECT COUNT(*) AS n FROM ${table}`)).n]);
  }

  // Les numéros automatiques repartent après le plus grand identifiant copié.
  for (const table of AVEC_ID) {
    await db.get(`SELECT setval(pg_get_serial_sequence('${table}', 'id'), (SELECT COALESCE(MAX(id), 0) + 1 FROM ${table}), false)`);
  }

  // Contrôle : mêmes totaux dans les deux bases.
  const somSource = lite.all('SELECT COALESCE(SUM(montant), 0) AS t FROM paiements')[0].t;
  const somCible = (await db.get('SELECT COALESCE(SUM(montant), 0) AS t FROM paiements')).t;

  console.log('\nTable        SQLite  ->  PostgreSQL');
  bilan.forEach(([t, a, b]) => console.log(`${t.padEnd(12)} ${String(a).padStart(6)}  ->  ${String(b).padStart(6)}${a === b ? '' : '   ⚠ différent'}`));
  console.log(`\nTotal des montants de paiements : ${somSource} -> ${somCible}${somSource === somCible ? '  ✔' : '   ⚠ DIFFÉRENT'}`);
  const ok = bilan.every(([, a, b]) => a === b) && somSource === somCible;
  console.log(ok ? '\nMigration terminée sans écart. Vous pouvez démarrer le serveur : npm start' : '\nMigration terminée AVEC des écarts : vérifiez les lignes marquées ci-dessus.');
  await db.fermer();
  process.exit(ok ? 0 : 2);
})().catch((e) => { console.error('Migration impossible :', e.message); process.exit(1); });
