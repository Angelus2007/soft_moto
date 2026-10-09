'use strict';
/* Création des tables et mises à jour d'une base plus ancienne (PostgreSQL ou SQLite). */
module.exports = async function creerSchema(db) {
  const { pk, bigint } = db.types;

  await db.exec(`
CREATE TABLE IF NOT EXISTS comptes (
  id ${pk},
  nom TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  telephone TEXT,
  mot_de_passe TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin','caissiere')),
  statut TEXT NOT NULL DEFAULT 'en_attente' CHECK (statut IN ('en_attente','actif','suspendu')),
  date_creation TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS connexions (
  id ${pk},
  email TEXT,
  compte_id INTEGER,
  succes INTEGER NOT NULL,
  ip TEXT,
  date TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  compte_id INTEGER NOT NULL REFERENCES comptes(id) ON DELETE CASCADE,
  expire_le ${bigint} NOT NULL
);
CREATE TABLE IF NOT EXISTS clients (
  id ${pk},
  code TEXT,
  nom TEXT NOT NULL,
  telephone TEXT,
  adresse TEXT,
  statut TEXT NOT NULL DEFAULT 'actif',
  date_creation TEXT,
  prix_moto INTEGER,
  montant_journalier INTEGER,
  temoin_nom TEXT,
  temoin_telephone TEXT,
  temoin_adresse TEXT,
  type_contrat TEXT,
  immatriculation TEXT,
  marque TEXT,
  date_debut TEXT,
  date_fin TEXT
);
CREATE TABLE IF NOT EXISTS paiements (
  id ${pk},
  code_client TEXT NOT NULL,
  date TEXT NOT NULL,
  paye INTEGER NOT NULL,
  montant INTEGER NOT NULL DEFAULT 0,
  compte_id INTEGER,
  maj_le TEXT NOT NULL,
  moyen TEXT,
  regle_le TEXT,
  numero_momo TEXT,
  UNIQUE (code_client, date)
);
CREATE TABLE IF NOT EXISTS versements (
  id ${pk},
  code_client TEXT NOT NULL,
  jour_saisie TEXT NOT NULL,
  jour_concerne TEXT NOT NULL,
  montant INTEGER NOT NULL,
  moyen TEXT,
  compte_id INTEGER,
  cree_le TEXT NOT NULL,
  numero_momo TEXT
);
CREATE TABLE IF NOT EXISTS parametres (cle TEXT PRIMARY KEY, valeur TEXT NOT NULL);
`);

  // Mise à jour d'une base créée avec une ancienne version (colonnes ajoutées au fil des évolutions).
  const ajouts = {
    paiements: [['moyen', 'TEXT'], ['regle_le', 'TEXT'], ['numero_momo', 'TEXT']],
    versements: [['numero_momo', 'TEXT']],
    clients: [
      ['code', 'TEXT'], ['statut', "TEXT NOT NULL DEFAULT 'actif'"], ['date_creation', 'TEXT'], ['prix_moto', 'INTEGER'],
      ['montant_journalier', 'INTEGER'], ['temoin_nom', 'TEXT'], ['temoin_telephone', 'TEXT'], ['temoin_adresse', 'TEXT'],
      ['type_contrat', 'TEXT'], ['immatriculation', 'TEXT'], ['marque', 'TEXT'], ['date_debut', 'TEXT'], ['date_fin', 'TEXT']
    ]
  };
  for (const [table, cols] of Object.entries(ajouts)) {
    for (const [col, def] of cols) await db.ajouterColonne(table, col, def);
  }

  await db.exec(`
CREATE UNIQUE INDEX IF NOT EXISTS idx_clients_code ON clients (code);
CREATE INDEX IF NOT EXISTS idx_versements_jour ON versements (jour_saisie);
CREATE INDEX IF NOT EXISTS idx_paiements_date ON paiements (date);
CREATE INDEX IF NOT EXISTS idx_sessions_compte ON sessions (compte_id);
`);
};
