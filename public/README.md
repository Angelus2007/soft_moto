# Soft Moto — serveur

Serveur Node.js + base de données **PostgreSQL** (libre et gratuite). Sans `DATABASE_URL`, le serveur utilise à la place un fichier SQLite local (`softmoto.db`) : pratique pour essayer sans rien installer.

## Démarrage rapide (essai en local, SQLite)

```bash
npm install
npm start
```

Ouvrir **http://localhost:3000** (redirige vers `login.html`).

## Passer à PostgreSQL

### 1. Créer la base

- **Sur ton ordinateur** : installe PostgreSQL (https://www.postgresql.org/download/), ou, avec Docker, lance `docker compose up -d` (le fichier `docker-compose.yml` crée une base `softmoto`, utilisateur `softmoto`, mot de passe `softmoto`).
- **En ligne (gratuit pour démarrer)** : Neon, Supabase, Railway ou Render proposent PostgreSQL ; tu obtiens une adresse de connexion du type `postgresql://utilisateur:motdepasse@hote:5432/nom`.

### 2. Dire au serveur d'utiliser PostgreSQL

Définis la variable `DATABASE_URL` avant de lancer le serveur :

```bash
# Linux / macOS
DATABASE_URL=postgresql://softmoto:softmoto@localhost:5432/softmoto npm start
# Windows PowerShell
$env:DATABASE_URL="postgresql://softmoto:softmoto@localhost:5432/softmoto"; npm start
```

(ou copie `.env.example` en `.env`, remplis-le puis `npm run start:env` ; chez un hébergeur, saisis les variables dans son tableau de bord.) Si l'hébergeur de la base l'exige (Neon, Supabase, Railway…), ajoute `DATABASE_SSL=true`.

Test de connexion : `npm run verifier-db`. Les tables sont créées automatiquement au premier démarrage.

### 3. Reprendre tes données actuelles (une seule fois)

Garde `softmoto.db` (avec ses éventuels fichiers `softmoto.db-wal` et `softmoto.db-shm`) à côté de `server.js`, puis, **avant le premier démarrage sur PostgreSQL** :

```bash
DATABASE_URL=postgresql://... npm run migrer
# ou avec un autre chemin :  npm run migrer -- /chemin/vers/softmoto.db
```

Le script copie comptes, conducteurs, paiements, versements, historique de connexions et paramètres, puis affiche un tableau de contrôle (nombre de lignes et total des montants dans les deux bases). Il refuse de s'exécuter si la base PostgreSQL contient déjà des données. Le fichier SQLite n'est pas supprimé : garde-le comme sauvegarde. Si le fichier est très ancien, lance d'abord `npm start` une fois sans `DATABASE_URL` pour le mettre à jour.

### Remarques

- Sur une base PostgreSQL vide, **aucun conducteur de démonstration** n'est créé (ajoute `SEED_DEMO=1` pour en avoir 10). Avec SQLite, ils sont créés sauf si `SEED_DEMO=0`.
- Sauvegardes : avec PostgreSQL, utilise `pg_dump "$DATABASE_URL" > sauvegarde.sql` (ou les sauvegardes automatiques de ton hébergeur) ; avec SQLite, copie `softmoto.db`.
- Le code d'accès à la base est dans `db.js` ; les tables et mises à jour dans `schema.js`.
- Si `better-sqlite3` n'a pas pu s'installer (c'est une dépendance facultative), le mode SQLite utilise le module intégré de Node 22 ; avec PostgreSQL, il n'est pas nécessaire.

## Premier démarrage

Au premier lancement, si aucun administrateur n'existe, il est créé avec le mot de passe **`admin123`** (identifiant : `admin@softmoto.bj`).
Variables optionnelles : `PORT`, `DATABASE_URL`, `DATABASE_SSL`, `ADMIN_EMAIL`, `ADMIN_PASSWORD` (change ce mot de passe par défaut), `SEED_DEMO`, `DB_PATH` (fichier SQLite), `VERSEMENT_JOURNALIER` (montant par défaut au tout premier démarrage — modifiable ensuite depuis Paramètres), `FUSEAU` (`Africa/Porto-Novo` par défaut).

**`admin123` est un mot de passe public, connu de quiconque lit ce fichier — changez-le dès la première connexion** depuis Paramètres → Changer mon mot de passe (ou définissez `ADMIN_PASSWORD` avant le tout premier démarrage). Si vous aviez déjà une base avec un autre mot de passe admin, il est conservé tel quel ; changez-le de la même façon.

## Si vous voyez « Failed to fetch »

Le navigateur n'arrive pas à joindre le serveur. Vérifiez dans l'ordre :

1. Le terminal affiche `Soft Moto : http://localhost:3000` et reste ouvert (sinon : `npm install` puis `npm start`).
2. L'adresse du navigateur commence par `http://localhost:3000/` — pas `file:///…` (double-clic sur le fichier) ni `127.0.0.1:5500` (Live Server).
3. Si le port 3000 est déjà pris, lancez `PORT=3001 npm start` (Windows PowerShell : `$env:PORT=3001; npm start`) et ouvrez `http://localhost:3001`.

Les pages affichent un bandeau rouge quand elles ne sont pas servies par le serveur.

## Habillage visuel

`public/theme.css` regroupe la palette d'avatars, les couleurs payé/impayé (vert/rouge purs) et les animations communes (calendrier, graphique, toasts, halo du logo, lueur d'ambiance, onde au clic) ; `public/theme.js` déclenche l'onde au clic sur les boutons. Les deux sont chargés par toutes les pages. Tout respecte `prefers-reduced-motion`.

## Structure

```
server.js        API + sessions
db.js            accès à la base (PostgreSQL ou SQLite)
schema.js        tables et mises à jour de la base
migrer-vers-postgres.js   copie softmoto.db (SQLite) vers PostgreSQL
verifier-db.js   test de connexion à la base
docker-compose.yml, .env.example   aides pour PostgreSQL en local / configuration
public/          seul dossier accessible depuis le navigateur
  login.html            connexion + création de compte caissière
  admin.html            tableau de bord (collecte du jour, 7 jours, aperçu financement)
  collectes.html        journal des versements sur une période, correction, export CSV
  motos.html            liste complète du financement, édition prix / cible / statut
  fiche-conducteur.html  fiche d'un conducteur : VIDANGE (décompte de 14 jours) + REDEVANCE (paiements)
  archives.html          conducteurs suspendus (archivés), réactivables
  fiche-conducteur.js    logique de la fiche
  employes.html         validation des comptes, suspension, ajout direct
  parametres.html       compte, mot de passe, montant journalier par défaut
  conducteurs.html      liste et création des conducteurs (codes SM-xxxxxx)
  caissiere.html        recherche d'un conducteur, calendrier de paiement du mois
  inscription-caissiere.html   redirection vers login.html?view=signup
```

## Fiche conducteur (Vidange & Redevance)

La recherche d'un code conducteur mène à `fiche-conducteur.html?code=SM-xxxxxx` :
- depuis `conducteurs.html` : taper le code (ou le nom) puis **Entrée**, ou cliquer le code dans la liste ;
- depuis `caissiere.html` : la recherche par code ouvre la même fiche.

La fiche a deux onglets :
- **Vidange** : le décompte de 14 jours commence le jour où le conducteur a payé sa vidange (100 F). Un bandeau indique « prochaine vidange dans N jours », « à faire aujourd'hui » ou « en retard de N jours », avec l'historique des vidanges payées (annulables).
- **Redevance** (partie caissière) : calendrier du mois, jour par jour (vert pur ✓ payé, rouge pur ✗ non payé). Un clic sur un jour ouvre la saisie du montant remis. Un clic sur une case de la Vidange ouvre la Redevance sur cette période.

Seuls les jours entre l'inscription (ou `date_debut`) et `date_fin` comptent dans le suivi. « Aujourd'hui » suit le fuseau du serveur (`FUSEAU`). Une caissière voit la fiche sans menu d'administration, avec un retour vers sa tournée.

L'ancienne page générale « Vidange & Redevance » (`vidange-redevance.html`) a été supprimée.

## Palette

Définie une seule fois dans `public/theme.css` (variables `:root`) : marine `#0B1B33`, gris froid `#F1F4F9`, bleu `#1D4ED8`, or discret `#C77D0A`. Les statuts sont réservés : **vert pur `#00A000` = payé, rouge pur `#E00000` = non payé**, en aplat plein ; aucune autre couleur du site ne s'en approche (les avatars évitent le vert et le rouge).

## Motion design (toutes les pages)

Un seul système, dans `public/theme.css` + `public/theme.js`, chargé par chaque page :
- **Entrée orchestrée** : menu, titre puis contenu apparaissent en séquence, une seule fois (`html.sm-intro`).
- **Navigation** : fondu entre pages (`smGo(url)` pour les redirections du code), trait animé sur le lien actif.
- **Données** : lignes de tableaux, tournée, jours du calendrier et cases en cascade au premier affichage (pas rejouées à chaque frappe de recherche) ; les chiffres-clés (`.stat/.kpi/.summary-card .value`, totaux caissière) « roulent » jusqu'à leur valeur ; barres de progression qui se remplissent.
- **Gestes** : survol des cartes et cases, onglet à pastille glissante, champ invalide qui tremble, boutons avec onde.
- **Modales** : entrée et sortie en fondu (classe `.show`, sans `display:none` brutal).
- **Connexion** : texte du panneau gauche, champs et bascule connexion/inscription animés.
Tout est coupé pour les personnes ayant activé « réduire les animations ».

## Ajouter un conducteur

Le formulaire (page Conducteurs) demande maintenant, en plus du nom et du téléphone :
- l'**adresse** du conducteur ;
- le **nom, le téléphone et l'adresse du témoin** (garant) ;
- la **date de début** et la **date de fin** du contrat ;
- le **montant de base journalier** (obligatoire) — c'est exactement le montant que la caissière doit collecter chaque jour auprès de ce conducteur ;
- le **prix de la moto** (optionnel) — le montant TOTAL que le conducteur doit rembourser au fil du temps ; sert uniquement au suivi du financement sur la page Motos & financement (barre de progression, jours restants). Il peut aussi être ajouté/modifié plus tard depuis cette page.

⚠️ Ces deux montants sont volontairement différents et ne doivent jamais être confondus : le montant de base journalier est petit (ex. 3 500 F) et sert au calendrier de paiement ; le prix de la moto est le total du crédit (ex. 650 000 F) et ne sert qu'au suivi global du remboursement.

Les autres champs sont obligatoires à la création. Ils peuvent être corrigés ensuite (sauf le témoin et les dates, pour l'instant) depuis la modale d'édition de la page Motos & financement.

## Collecte : montant libre et cible personnalisée

Depuis le calendrier de `caissiere.html` (ou en corrigeant une ligne dans `collectes.html`), la caissière saisit **le montant réellement remis** — il n'y a plus de montant fixe imposé par l'interface. Un jour est marqué :
- **payé (case verte, crochet ✓)** si le montant atteint la cible du jour pour ce conducteur ;
- **impayé (case rouge, croix ✗)** sinon, même si un montant partiel a été enregistré (visible dans le journal `collectes.html`).

La cible du jour est exactement le **montant de base journalier** saisi pour ce conducteur à sa création, sauf si l'admin lui a défini un **montant personnalisé** depuis `motos.html` — celui-ci est alors prioritaire. Les conducteurs sans montant de base journalier (anciens enregistrements) retombent sur le **montant journalier par défaut** réglable dans Paramètres. Ce calcul est totalement indépendant du prix de la moto.

## Sécurité mise en place

- Mots de passe hachés (bcrypt) ; session par cookie `HttpOnly` (12 h, ou 30 jours avec « Se souvenir de moi »).
- Chaque utilisateur peut changer son propre mot de passe (Paramètres → utile pour les caissières créées avec un mot de passe temporaire).
- Routes protégées par rôle : `admin` pour les comptes/conducteurs/réglages, `admin`+`caissière` pour la saisie des paiements.
- 5 échecs de connexion (même IP + e-mail) → blocage 15 minutes ; chaque tentative est journalisée (table `connexions`).
- Seul `public/` est servi : `softmoto.db`, `db.js` et `server.js` ne sont pas téléchargeables.
- Les pages échappent les données affichées (un nom du type `<script>` n'est plus exécuté).

## API

| Méthode | Route | Accès | Rôle |
|---|---|---|---|
| POST | `/api/inscription` | public | Créer un compte caissière (`en_attente`) |
| POST | `/api/connexion` | public | Connexion (`email`, `motDePasse`, `remember`) |
| POST | `/api/deconnexion` | connecté | Fermer la session |
| GET | `/api/moi` | connecté | Compte courant |
| PATCH | `/api/moi/mot-de-passe` | connecté | Changer son propre mot de passe |
| GET | `/api/config` | admin, caissière | Montant journalier par défaut + fuseau |
| PATCH | `/api/config` | admin | Modifier le montant journalier par défaut |
| GET | `/api/tableau-de-bord` | admin | Chiffres du jour, 7 derniers jours, aperçu financement |
| GET | `/api/collectes?debut=&fin=&code_client=` | admin | Journal des versements sur une période (`&format=csv` pour l'export) |
| GET | `/api/financements` | admin | Liste complète du financement, avec indice de fiabilité (30 j) |
| GET | `/api/tournee` | admin, caissière | Conducteurs actifs et statut du jour, triés par urgence |
| GET | `/api/comptes?role=&statut=` | admin | Lister les comptes |
| POST | `/api/comptes` | admin | Ajout direct (renvoie un mot de passe temporaire) |
| PATCH | `/api/comptes/:id` | admin | Changer le statut |
| DELETE | `/api/comptes/:id` | admin | Refuser / supprimer une caissière |
| GET | `/api/clients`, `/api/clients/:code` | admin, caissière | Conducteurs |
| POST | `/api/clients` | admin | Créer un conducteur — nom, téléphone, adresse, témoin (nom/téléphone/adresse), dates de début/fin et montant de base journalier sont requis ; le prix de la moto est optionnel ; le code est généré par le serveur |
| PATCH | `/api/clients/:id` | admin | Modifier nom/téléphone/statut/prix de la moto/montant journalier personnalisé |
| GET | `/api/paiements?code_client=&mois=AAAA-MM` | admin, caissière | Paiements d'un conducteur |
| POST | `/api/paiements` | admin, caissière | `{code_client, date, montant}` — le statut payé/impayé est calculé automatiquement |

## Ma tournée du jour (caissière)

`caissiere.html` s'ouvre désormais sur la liste de tous les conducteurs actifs et leur statut du jour (payé / non collecté), triée en mettant les impayés et les conducteurs les moins fiables en premier. Cliquer une ligne ouvre directement la saisie du montant pour aujourd'hui — plus besoin de connaître le code par cœur pour chaque conducteur. La recherche par code reste disponible juste en dessous pour consulter l'historique complet d'un conducteur précis.

## Indice de fiabilité

Calculé pour chaque conducteur comme la part de jours payés sur les 30 derniers jours (ou depuis son inscription si plus récente). Affiché sur `motos.html` et dans la tournée de `caissiere.html` — masqué (« historique court ») tant qu'il y a moins de 3 jours d'ancienneté pour éviter un pourcentage trompeur.

## Encore à faire

- Pour la mise en ligne : HTTPS + `NODE_ENV=production` (cookie `Secure`), sauvegardes régulières de la base (voir « Passer à PostgreSQL »).
- La fiabilité n'est pas encore affichée sur `conducteurs.html` ni `collectes.html`.
- Le témoin et les dates de contrat ne sont pas encore modifiables après la création (seuls prix, montant journalier et statut le sont, depuis Motos & financement).

## Surplus de versement (report automatique)

Quand un conducteur remet plus que son montant journalier (ex. 4 000 F pour une cible de 2 000 F), le surplus est
reporté automatiquement sur les jours impayés ou partiels **précédents**, du plus ancien au plus récent :

- les cases rouges comblées passent au vert (ou restent ambre/partielles si le surplus ne suffit pas, il est alors complété par un prochain surplus) ;
- le jour saisi garde sa cible ; s'il ne reste aucun jour à combler, le surplus reste inscrit sur ce jour ;
- seuls les jours suivis sont concernés (entre le début et la fin du contrat) ;
- le calcul est fait côté serveur (`POST /api/paiements`, champs `reporte` et `ajustements` dans la réponse) et la fiche conducteur / l'espace caissière se mettent à jour avec un message de confirmation.

## Moyen de paiement

Chaque versement enregistre aussi son moyen : **Espèces**, **MOMO** ou **MOMO régularisation** (choix dans la fenêtre de saisie du montant, espèces par défaut).

- stocké dans la colonne `paiements.moyen` (ajoutée automatiquement au démarrage, les anciens versements restent sans moyen) ;
- affiché dans le calendrier de la fiche conducteur (ESP / MOMO / RÉG), dans le tableau des collectes et dans l'export CSV ;
- si le champ `moyen` est absent de la requête `POST /api/paiements`, le moyen déjà enregistré est conservé ;
- quand un surplus comble un ancien jour déjà entamé, ce jour garde son moyen d'origine.

## Date de règlement d'un jour comblé

Quand un jour impayé est comblé par le surplus d'un autre jour, la colonne `paiements.regle_le` garde la date réelle où l'argent a été remis. Elle s'affiche sous le crochet vert (« réglé le JJ/MM/AAAA ») dans le calendrier de la fiche conducteur et de l'espace caissière. Un jour encore partiel n'a pas de date de règlement tant qu'il n'est pas complété.

## Contrats (Journée payée / Droit d'usage)

Deux modèles de contrat sont intégrés (`public/contrat.js`). Les pointillés sont remplacés par les informations du formulaire du conducteur ; le **numéro du contrat est le code du conducteur** (SM-xxxxxx), généré avec lui.

| Dans le contrat | Champ du formulaire |
|---|---|
| No | code généré (SM-xxxxxx) |
| Conducteur / contractant, téléphone | Nom et prénoms, Téléphone |
| Avaliseur | Témoin (nom, téléphone) |
| Marque, plaque | Marque de la moto (TVS par défaut), Immatriculation |
| Somme par jour (aussi en lettres pour le droit d'usage) | Montant de base journalier |
| Période, durée en mois, date de signature | Date de début, Date de fin |

- Formulaire d'ajout : bouton **TYPE DE CONTRAT** (Contrat JOURNÉE PAYÉE / Contrat DROIT D'USAGE), obligatoire.
- À la création, la confirmation propose **Télécharger le contrat**.
- Fiche conducteur (page de paiement) : onglet **Contrat** avec le contrat rempli, le bouton TYPE DE CONTRAT pour voir l'autre modèle, **Télécharger (Word .doc)** et **Imprimer / PDF**. L'administrateur peut enregistrer un autre type pour le conducteur.
- Nouvelles colonnes `clients.type_contrat`, `immatriculation`, `marque`, ajoutées automatiquement au démarrage. Les conducteurs existants affichent par défaut le contrat JOURNÉE PAYÉE.
- Pour modifier le texte des contrats : `public/contrat.js`.

## Liste du jour et impayés cumulés

**Liste du jour** (espace caissière « Liste du jour » et tableau de bord admin) : tout ce qui a été reçu aujourd'hui, avec le moyen (Espèces / MOMO / MOMO régularisation), l'heure, le total reçu et sa répartition par moyen. Pastilles **Payés / Impayés / Tous**. Les impayés du jour montrent aussi les jours impayés cumulés et le montant dû. La caissière peut toujours cliquer une ligne pour enregistrer ou corriger un versement.

- Un **journal des versements** (table `versements`, créée automatiquement) enregistre l'argent réellement reçu chaque jour, surplus compris : 6 000 F remis pour une redevance de 2 000 F s'affichent « 6 000 F » avec les anciens jours régularisés. Les paiements saisis avant ce journal du jour même sont repris tels quels.
- `GET /api/tournee` (admin + caissière) renvoie `payes`, `totaux` et la tournée avec `jours_impayes` / `montant_du`.

**Impayés cumulés (administrateur seulement)** : panneau du tableau de bord avec les seuils **2, 3, 4, 5 jours et +** (jours impayés avant aujourd'hui, du début du contrat à la veille), le montant dû, la date de début des impayés et le téléphone cliquable. Le badge « saisie possible » apparaît à partir de 15 000 F (article 8-II du contrat).

- Bouton **Suspendre** (avec confirmation) : le conducteur passe « inactif » et sort des collectes du jour. Onglet **Suspendus** pour le **Réactiver**.
- `GET /api/impayes?min=N` (admin) ; la suspension utilise `PATCH /api/clients/:id` avec `{"statut":"inactif"}`.

## Flèches du montant et numéro Mobile Money

- **Flèches du montant remis** : ▲ double le montant (× 2), ▼ le divise par 2. En partant de 0, ▲ donne le montant de base du jour. Les touches ↑ / ↓ du clavier font la même chose. (Fenêtre de saisie de l'espace caissière, de la fiche conducteur et de Collectes.)
- **Numéro MOMO** : quand le moyen est MOMO ou MOMO régularisation, trois numéros sont proposés ; la caissière coche celui qui a reçu le transfert (obligatoire si un montant est remis). Le numéro est enregistré avec le versement (`paiements.numero_momo`, `versements.numero_momo`), affiché dans la liste du jour (avec le total reçu par numéro) et ajouté à l'export CSV des collectes.
- Les trois numéros sont **fictifs au départ** : l'administrateur les remplace dans **Paramètres → Numéros Mobile Money** (`PATCH /api/config` avec `numeros_momo`).
- Si on change le moyen d'un versement déjà saisi, le journal déplace le montant d'un moyen à l'autre.

## Mise en ligne sur Render

Render ne prend pas de fichier zip : il lit le code dans un dépôt GitHub. Le fichier `render.yaml` fourni contient déjà les réglages du site.

1. **GitHub** : crée un dépôt **privé** et envoie-y le *contenu* du dossier (`package.json` doit être à la racine). N'envoie jamais `softmoto.db`, `.env` ni `node_modules`.
2. **Base PostgreSQL** : Render → New → PostgreSQL, région **Frankfurt**, formule **payante** (la formule gratuite est supprimée après 30 jours). Note l'*Internal* et l'*External Database URL*.
3. **Reprendre tes données** (si tu en as) avant de créer le site : sur ton ordinateur,
   `DATABASE_URL=<External URL> DATABASE_SSL=true npm run migrer`.
4. **Site** : Render → New → **Blueprint** → choisis le dépôt. Render lit `render.yaml` (Node, région Frankfurt, `npm install` / `npm start`, contrôle de santé `/healthz`) et te demande deux valeurs :
   - `DATABASE_URL` : l'**Internal Database URL** de la base ;
   - `ADMIN_PASSWORD` : le mot de passe du premier administrateur (ignoré si tu as migré tes comptes ; laisse-le vide pour qu'un mot de passe aléatoire soit généré et affiché une fois dans les *Logs*).
   (Sans Blueprint : New → Web Service, Build `npm install`, Start `npm start`, variables `DATABASE_URL`, `NODE_ENV=production`.)
5. Ouvre l'adresse `https://….onrender.com`, connecte-toi, puis change le mot de passe (Paramètres) et remplace les numéros Mobile Money fictifs.

Ce que le site fait de lui-même sur Render : cookie de session sécurisé (HTTPS), adresse IP réelle des visiteurs derrière le proxy (protection contre les essais de mot de passe), route `/healthz`, arrêt propre à chaque redéploiement, et **refus de démarrer sans `DATABASE_URL`** (un fichier SQLite y serait effacé à chaque déploiement ; `ALLOW_SQLITE=1` pour forcer si tu as un disque persistant). En ligne, si `ADMIN_PASSWORD` est absent, jamais de mot de passe `admin123` : un mot de passe aléatoire est généré.

Plan gratuit du site : il s'endort après 15 minutes sans visite (premier chargement lent). Pour un usage réel, garde `plan: starter` dans `render.yaml`.

## Code saisi par l'administrateur, recherche par plaque, export des impayés

- **Code du conducteur** : plus de génération automatique. L'administrateur saisit le code à l'inscription (lettres, chiffres, « - » ou « _ », 2 à 20 caractères, majuscules automatiques). Un code déjà utilisé est refusé. Le numéro du contrat reste le code.
- **Recherche par plaque** : la liste des Conducteurs, le champ de recherche de l'espace caissière et celui de la fiche acceptent le code, le nom ou la **plaque** (« EP 1234 RB », « ep-1234-rb » et « EP1234RB » sont équivalents). `GET /api/clients/:code` accepte aussi une plaque.
- **Export Excel des impayés** (administrateur) : bouton **Exporter (Excel)** dans « Impayés cumulés » (`GET /api/impayes?min=N&format=csv`) avec code, conducteur, téléphone, adresse, plaque, jours impayés, montant dû, date de début, témoin, téléphone et adresse du témoin. L'export des collectes (page Collectes) contient maintenant aussi téléphone, adresse, plaque et coordonnées du témoin. Les numéros sont écrits pour que Excel n'affiche pas « #NOM? » devant un « + ».

## Redevance par jour, par semaine ou par mois

Chaque conducteur a une **fréquence de paiement** : par jour (par défaut, comme avant), par semaine ou par mois. À la création (boutons « Redevance payée »), le **montant de base** est celui d'**une période** (un jour, une semaine ou un mois). L'administrateur peut changer la fréquence plus tard dans la fiche, onglet **Contrat**. Les conducteurs existants restent « par jour ».

- Les semaines et les mois **partent de la date de début du contrat** (mois : même quantième ; le 31 devient le 30 ou le 28 si besoin). La dernière période est calculée au prorata si le contrat se termine avant.
- Un versement se rattache à la période qui contient sa date. Une période est **payée quand la somme des versements atteint le montant dû** ; elle est **impayée quand elle est terminée** sans l'avoir atteint (la période en cours est « En cours »). Le surplus n'est pas reporté d'une période à l'autre : pour une ancienne période, utiliser « Enregistrer un versement » sur sa carte.
- Fiche conducteur → Redevance : une **carte par semaine / par mois** (barre de progression, versements, bouton « Enregistrer un versement »). La saisie d'un jour remplace le montant de ce jour (comme pour la redevance journalière).
- Liste du jour : un conducteur payant par semaine ou par mois apparaît « Partiel » ou « Non collecté » tant que sa période n'est pas complète, puis « Payé » jusqu'à la fin de la période.
- Impayés cumulés (admin) : les jours impayés d'une période terminée comptent tous ses jours (1 semaine impayée = 7 jours), pour que les seuils 2, 3, 4, 5 jours restent comparables ; la colonne « Paiement » de l'export Excel indique la fréquence.
- Les contrats indiquent « par jour », « par semaine » ou « par mois ».

## Vidange : 100 F, décompte de 14 jours depuis le jour du paiement

Fiche conducteur → onglet **Vidange** : plus de périodes fixes. Quand le conducteur paie sa vidange, la caissière (ou l'admin) clique sur **« Enregistrer la vidange payée »** (date du jour par défaut, modifiable si le paiement date d'un jour passé). Le décompte de **14 jours** part de cette date : la prochaine vidange est due 14 jours plus tard.

- Avant le premier paiement, aucun décompte ne tourne.
- Une vidange saisie par erreur peut être annulée (le décompte repart de la vidange précédente).
- Les vidanges payées dans la journée apparaissent à part dans la liste du jour et dans « Mon point ».
- Les anciennes cases cochées (24 périodes) sont reprises automatiquement au démarrage : chacune devient une vidange datée du jour où elle avait été cochée (l'ancienne table `vidanges` est conservée comme sauvegarde).
- Montant : 100 F par défaut, modifiable avec `VIDANGE_MONTANT`. API : `GET /api/vidanges?code_client=…` (état et historique), `POST /api/vidanges` (`code_client`, `date` facultative), `DELETE /api/vidanges/:id`.

## Paiements par l'administrateur, modification, archives et point personnel

- **Paiements** : l'administrateur a une entrée « Paiements » dans son menu (même écran que les caissières) et peut aussi saisir paiements et vidanges depuis la fiche d'un conducteur.
- **Modifier un conducteur** : bouton « Modifier » dans la liste des conducteurs (code, coordonnées, témoin, visiteur, moto, contrat, dates, montants, statut). Si le code change, les paiements et vidanges suivent.
- **Montant dû** : dans le formulaire d’ajout et de modification, la case « Prix de la moto » devient « Montant dû », calculée automatiquement (montant de base × nombre de jours, semaines ou mois du contrat, dernière période au prorata). Le serveur fait le même calcul.
- **Ajout d'un conducteur** : nouveaux champs **État de la moto** (neuve ou usagée, obligatoire) et **Nom du visiteur** (facultatif). Le contrat « Droit d'usage » reprend l'état de la moto.
- **Archives** : un conducteur *suspendu* (bouton « Archiver » ou statut « Suspendu » dans la fenêtre de modification) quitte la liste, les collectes, les impayés et le financement ; il est consultable et réactivable dans la page **Archives**. Aucun paiement ne peut lui être enregistré tant qu'il est suspendu.
- **Vidanges en retard** : le tableau de bord admin a un panneau « Vidanges en retard » (14 jours écoulés depuis la dernière vidange payée), trié par retard, avec export Excel (`GET /api/vidanges/retards?format=csv`). Les conducteurs sans aucune vidange payée n’y figurent pas (pas de décompte) ; leur nombre est indiqué.
- **Suspendre depuis les impayés** : le bouton « Suspendre » du tableau de bord archive désormais le conducteur (statut « suspendu »), comme le bouton « Archiver ».
- **Observations** : la fiche de chaque conducteur a un onglet « Observations » (commentaires libres, 1000 caractères max, avec auteur, date et heure). Admin et caissières peuvent en ajouter ; l’admin supprime toutes les observations, une caissière seulement les siennes. API : `GET/POST /api/observations`, `DELETE /api/observations/:id`. Elles suivent le conducteur si son code change et restent visibles dans les archives.
- **Signatures (images)** : à l’ajout et à la modification d’un conducteur, on peut choisir une image pour la signature du conducteur et celle du témoin (réduite automatiquement dans le navigateur, png/jpeg/webp). Elles s’affichent dans les espaces de signature du contrat (aperçu et impression ; le contrat « Droit d’usage » place le conducteur à gauche et le témoin à droite). Dans le fichier Word téléchargé, certaines versions de Word n’affichent pas les images : utilisez l’impression pour un contrat signé. API : `GET /api/clients/:code/signatures`.
- **Clauses des contrats modifiables** : page Paramètres → « Clauses des contrats » (admin). Chaque contrat est un texte : `# Titre`, `## Article…`, `>> Fait à…`, une ligne = un paragraphe, `**gras**`, et des champs automatiques comme `{{nom}}`, `{{montant}}`, `{{date_debut}}` (boutons d’insertion, aperçu, « Rétablir le texte d’origine »). Le texte est enregistré dans la table `parametres` (`contrat_journee_payee`, `contrat_droit_usage`). Attention : les contrats étant générés à la demande, un changement de clauses s’applique aussi aux contrats des conducteurs déjà inscrits lors de leur prochaine impression. API : `GET /api/contrats`, `PUT /api/contrats/:type`.
- **Mes notes** : page `notes.html` (menu admin) pour les notes personnelles, avec le code d’un conducteur facultatif (lien vers sa fiche), recherche, modification et suppression. Chaque note n’est visible que par son auteur. API : `GET/POST /api/notes`, `PATCH/DELETE /api/notes/:id`.
- **Visiteurs (contrat « Journée payée », pré-contrat de 14 jours)** : pendant les 13 premiers jours (le jour de début compte pour le jour 1), les jours non payés ne sont pas des impayés : la tournée, le tableau de bord et les calendriers affichent « En attente · jour N/14 » (en orange) et la fiche indique « Impayés · sursis (jour N\/13) ». Le 14e jour, les jours encore non payés deviennent des impayés (affichés « Impayé », comptés dans la liste des impayés et l’export). Les autres contrats ne changent pas.
- **Demandes** : page `demandes.html` (menu admin) pour les demandes des conducteurs : **début d'un contrat** ou **achat d'une moto**. On enregistre une demande (nom, téléphone, type, contrat souhaité, message ; admin ou caissière), puis l'admin la traite : « Créer le conducteur » (ouvre le formulaire d'ajout prérempli ; la demande passe en « acceptée » avec le code du conducteur), « Refuser » (motif facultatif), « Remettre en attente » ou « Supprimer ». Filtres : en attente / acceptées / refusées / toutes. API : `GET/POST /api/demandes`, `GET/PATCH/DELETE /api/demandes/:id`. (Les demandes d'accès des caissières restent dans la page Employés.)
- **Conducteurs par type de contrat** : la liste des conducteurs est séparée selon la fréquence de paiement : **Journaliers**, **Hebdomadaires** et **Mensuels**. Des pastilles avec le nombre de conducteurs filtrent la liste ; dans « Tous », ils sont regroupés par type sous un titre.
- **Annuler un paiement** : dans la fenêtre de saisie d'un jour (fiche conducteur, calendrier ou tournée de la caissière), le bouton « Annuler ce paiement » annule la saisie **en entier, surplus compris** : si 5 200 F ont payé 2 jours (2 600 F chacun), annuler l'un des deux jours remet les deux jours en « non payé ». Chaque saisie porte un identifiant (`lot`) dans le journal des versements ; les anciennes saisies sans identifiant sont regroupées par compte et par heure. L'annulation est tracée par des lignes négatives au nom de la personne qui annule (les totaux et « Mon point » restent justes). L'administrateur peut tout annuler ; une caissière seulement les paiements saisis aujourd'hui (surplus compris). API : `DELETE /api/paiements?code_client=…&date=AAAA-MM-JJ` (renvoie la liste des jours touchés).
- **Notes** : elles sont enregistrées dans la base de données du serveur (table `notes`, PostgreSQL en ligne), pas dans le navigateur : elles se retrouvent depuis n'importe quel appareil et survivent aux redémarrages.
- **Un seul contrat par conducteur** : la fiche n'affiche et n'imprime que le contrat du conducteur (plus de bascule entre les deux contrats). Changer de contrat se fait par un bouton « Remplacer par… » (ou « Modifier ») avec confirmation, et le changement est consigné dans les observations du conducteur.
- **Page Contrats** (`contrats.html`, menu admin) : sépare les conducteurs en **Journée payée** et **Droit d'usage** (et « Contrat non défini »). Alertes : pré-contrat de 14 jours **bientôt terminé** (jour 12 à 14) ou **terminé** (« Passer en Droit d'usage » en un clic), contrat Droit d'usage **échu** ou à moins de 30 jours de sa fin, contrat non défini. Une bannière sur le tableau de bord signale les contrats à traiter. API : `GET /api/contrats/suivi`.
- **Corrections paiements et impayés** : (1) « Collecte aujourd'hui / hier » et le graphique des 7 jours comptent l'argent réellement reçu (journal des versements) : les paiements partiels, les jours d'avance et les arriérés réglés ce jour-là sont inclus ; (2) le « total versé » des financements (tableau de bord et page Motos) compte aussi les jours partiellement payés ; (3) la page Collectes compte les paiements partiels dans son total et les affiche « Partiel » (export compris) ; (4) un paiement journalier ne peut plus être saisi avant le début ou après la fin du contrat.
- **Mon point** : chaque caissière voit sur sa page ce qu'**elle** a encaissé (jour au choix : total, espèces / MOMO / MOMO régularisation, liste de ses versements, total du mois). API : `GET /api/mon-point?date=AAAA-MM-JJ` (l'admin peut ajouter `compte_id=` pour voir une caissière).
- Le moyen de paiement « MOMO régulateur » s'appelle désormais **« MOMO régularisation »** (même code interne, aucune donnée à migrer).

## Paiement en avance

Un conducteur à jour peut payer des jours, des semaines, des mois ou des vidanges **d'avance**.

- **Redevance par jour** : dans la fenêtre de saisie du montant, les boutons **+ 1 jour, + 1 semaine, + 2 semaines, + 1 mois** ajoutent ce nombre de jours au montant (ex. 2 000 F + 14 × 2 000 F = 30 000 F). Le **surplus** sert d'abord à régler les **jours impayés** (du plus ancien au plus récent), puis paie les **jours suivants**, jusqu'à la fin du contrat (120 jours au maximum) ; les jours déjà payés sont sautés. Si le reste ne suffit pas pour un jour entier, ce jour reçoit une avance partielle (orange). Ce qui ne peut être placé reste sur le jour saisi.
- Le calendrier affiche les jours payés d'avance en vert avec « payé d'avance le jj/mm/aaaa » ; le bouton « mois suivant » apparaît quand des jours payés d'avance débordent sur le mois suivant. Un message confirme « N jours payés d'avance, jusqu'au jj/mm ».
- **Redevance par semaine / par mois** : les 2 prochaines périodes du contrat apparaissent en cartes « À venir » avec le bouton **Payer d'avance**.
- **Vidange** : le décompte de 14 jours part du jour du paiement ; il n'y a plus de périodes à venir.
- **Caisse** : l'argent est compté le jour où il est reçu. La liste du jour indique « payé d'avance : du jj/mm au jj/mm (N jours) ». Les jours payés d'avance ne comptent pas comme impayés et ne gonflent pas le pourcentage de fiabilité.
- API : `POST /api/paiements` renvoie en plus `avance` (montant utilisé) et `avances` (jours à venir payés) ;
