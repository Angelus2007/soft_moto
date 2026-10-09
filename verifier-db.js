'use strict';
/* Vérifie la connexion à la base : npm run verifier-db */
const db = require('./db');
const creerSchema = require('./schema');
(async () => {
  console.log('Type de base :', db.dialect === 'postgres' ? 'PostgreSQL' : 'SQLite (fichier local)');
  if (db.dialect === 'postgres') console.log('Serveur       :', (await db.get('SELECT version() AS v')).v);
  await creerSchema(db);
  for (const t of ['comptes', 'clients', 'paiements', 'versements']) console.log(t.padEnd(11), (await db.get(`SELECT COUNT(*) AS n FROM ${t}`)).n, 'ligne(s)');
  console.log('Connexion et tables : OK');
  await db.fermer();
})().catch((e) => { console.error('Connexion impossible :', e.message); process.exit(1); });
