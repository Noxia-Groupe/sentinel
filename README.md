# SENTINEL

Centre d'alarme des enregistreurs Dahua exploités pour nos clients.

SENTINEL reçoit les événements Alarm Center des NVR du parc, permet de les
**traiter depuis la plateforme** (prise en compte, main courante, clôture),
stocke les identifiants d'accès de façon chiffrée et sait s'en servir pour
**tester une connexion, vérifier les droits d'un compte et intervenir à
distance** sur l'équipement. Tout est également exposé par une **API à clés**
destinée aux intégrations et aux agents IA.

Stack : Next.js 16 (App Router) · Prisma 7 / PostgreSQL · NextAuth v5 ·
Tailwind 4 · Docker.

## Ce que fait la plateforme

| Domaine | Détail |
| --- | --- |
| **Clients** | Chaque enregistreur est rattaché à une fiche client (contact, site, référence dossier). |
| **Centre d'alarme** | Flux temps réel filtrable par statut, criticité, client ou enregistreur ; prise en compte, affectation, main courante et clôture motivée. |
| **Coffre d'identifiants** | Mots de passe chiffrés en AES-256-GCM, plusieurs comptes par NVR (admin, télésurveilleur, installateur…), affichage à la demande et systématiquement audité. |
| **Test d'accès** | Connexion réelle au NVR avec un mot de passe enregistré, mesure de la latence, remontée du modèle / firmware / numéro de série. |
| **Vérification des droits** | Lecture des comptes de l'équipement et des autorisations effectives (temps réel, relecture, PTZ, configuration…) canal par canal. |
| **Intervention à distance** | Informations équipement, comptes, titres de canaux, état des disques, capture d'image, mise à l'heure, pilotage des relais, redémarrage. |
| **API agents** | `/api/v1`, authentifiée par clé avec scopes, spécification OpenAPI publiée, limitation de débit. |
| **Audit** | Toute action sensible est tracée : qui a lu quel mot de passe, qui a redémarré quel NVR, quel agent a clôturé quelle alarme. |

## Authentification

L'accès à l'interface se fait exclusivement par **SSO Microsoft Entra ID**. Il
n'y a pas de mot de passe local. L'API `/api/v1` utilise des clés, pas la
session.

### 1. Inscrire l'application dans Entra ID

Portail Azure → *Microsoft Entra ID* → *Inscriptions d'applications* →
*Nouvelle inscription* :

| Champ | Valeur |
| --- | --- |
| Type de plateforme | **Web** (surtout pas SPA) |
| URI de redirection | `https://sentinel.noxia-groupe.fr/api/auth/callback/microsoft-entra-id` |

Puis *Certificats & secrets* → *Nouveau secret client* : copier la colonne
**Value** (pas *Secret ID*).

Les permissions déléguées `openid`, `profile`, `email` et `User.Read` sont
demandées par l'application (`User.Read` sert à récupérer la photo de profil).

### 2. Renseigner les variables d'environnement

Copier `.env.example` en `.env` et compléter :

```env
AUTH_MICROSOFT_ENTRA_ID_ID="<Application (client) ID>"
AUTH_MICROSOFT_ENTRA_ID_SECRET="<Client secret — Value>"
AUTH_MICROSOFT_ENTRA_ID_ISSUER="https://login.microsoftonline.com/<Directory (tenant) ID>/v2.0"
```

> **L'issuer ne doit pas comporter de slash final.** Entra ID publie son issuer
> sous la forme `https://login.microsoftonline.com/<tenant>/v2.0` et la
> librairie OIDC compare les deux chaînes caractère par caractère : un `/` en
> trop fait échouer la connexion. Le code normalise la valeur par sécurité,
> mais autant la renseigner correctement.

Renseigner l'issuer avec le tenant ID restreint la connexion aux comptes de
l'organisation. S'il est laissé vide, Entra ID retombe sur `common` et
n'importe quel compte Microsoft peut se connecter.

`AUTH_TRUST_HOST=true` est nécessaire derrière le reverse proxy (Nginx Proxy
Manager) pour que NextAuth fasse confiance aux en-têtes `X-Forwarded-*`.

### 3. Superadmins

Les adresses listées dans `ADMIN_EMAILS` (séparées par des virgules) reçoivent
le rôle `admin` à chaque connexion, y compris la toute première. Le rôle est
exposé sur `session.user.role` et visible dans *Paramètres*. Les superadmins
sont les seuls à pouvoir créer des clés d'API et lire le journal d'audit.

## Centralisation des alarmes

Chaque NVR dispose d'un token unique et remonte ses événements sur :

```
https://sentinel.noxia-groupe.fr/api/webhooks/dahua/<webhookToken>
```

Cette route est publique par conception (le token fait office
d'authentification) ; toutes les autres routes exigent une session ou une clé.

### Provisionnement automatique

Il n'y a rien à saisir sur l'enregistreur : depuis l'onglet *Webhook* d'un NVR,
**« Déclarer SENTINEL »** écrit l'adresse de la plateforme dans les paramètres
d'alarme de l'équipement, en **HTTPS** par défaut. Même opération par l'API :

```bash
curl -X POST -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  -d '{"action":"configure-alarm-center","params":{"scheme":"https"}}' \
  "$BASE/api/v1/nvrs/$NVR/actions"
```

Le provisionnement passe par l'API de configuration à distance de l'équipement
(`configManager`), qui accepte le HTTPS. Il procède en trois temps :

1. **Lecture** de la section de configuration réellement exposée par le firmware
   (`AlarmServer`, `AlarmCenter`, `HttpNotifyServer`… — les noms varient selon
   les gammes et les versions).
2. **Écriture** des seules clés que l'équipement expose déjà, jamais de champ
   inventé, et uniquement celles dont la valeur change.
3. **Relecture** de la configuration, renvoyée dans la réponse pour constater ce
   que l'enregistreur a réellement retenu.

Paramètres utiles :

| Paramètre | Effet |
| --- | --- |
| `scheme` | `https` (défaut) ou `http` pour un firmware incapable de négocier TLS |
| `dryRun` | Simule : renvoie les champs qui *seraient* écrits, sans rien modifier |
| `section` | Force la section de configuration à utiliser |
| `fields` | Force des champs précis (identifiant, protocole…) sans modifier le code |

`GET`-side, l'action `alarm-center` retourne la destination actuellement réglée
sur l'équipement et celle qu'il devrait avoir — de quoi repérer un NVR qui
remonte encore vers un ancien système.

> **Simuler avant d'écrire.** Si une télésurveillance tierce est déclarée dans
> ces mêmes champs, le provisionnement la remplace. `dryRun` montre exactement
> les champs concernés.

Deux cas ne sont pas provisionnables et sont signalés explicitement :

- un enregistreur en **P2P** sur une instance où l'accès P2P n'est pas activé
  (voir plus bas) ;
- un firmware dont le centre d'alarme utilise le protocole **propriétaire**
  (champ `Protocol` à `TCP`/`UDP`) : il ne sait pas poster sur une URL. L'adresse
  et le port sont tout de même écrits, et un avertissement invite à utiliser le
  menu de notification HTTP de l'équipement.

À défaut, la configuration manuelle reste possible : *Configuration → Réseau →
Centre d'alarme*, en ajoutant l'URL ci-dessus comme destination.

### Réception

Les requêtes **GET et POST** sont acceptées, en JSON, en formulaire ou en
paramètres d'URL : les firmwares varient beaucoup d'un modèle à l'autre. Le code
de l'événement est traduit en libellé français et en criticité
(`critical` / `major` / `minor` / `info`) — voir le catalogue dans
`src/lib/dahua/events.ts`.

Deux comportements évitent de noyer le flux :

- les événements de supervision (`heartbeat`, `keepAlive`) mettent seulement le
  NVR à jour comme « vu », sans créer d'alarme ;
- une alarme identique (même NVR, même code, même canal) encore au statut
  *Nouvelle* est regroupée avec la précédente pendant
  `DAHUA_DEDUPE_WINDOW_SECONDS` (60 s par défaut).

## Accès aux enregistreurs

SENTINEL dialogue avec les NVR par leur **API CGI HTTP**, en authentification
Digest, sur le port de l'interface web (`httpPort`, 80 par défaut) — et non sur
le port SDK 37777, qui reste renseigné à titre d'information pour SmartPSS/DMSS.
Le HTTPS est accepté avec certificat auto-signé.

> **Pourquoi l'API HTTP et non le NetSDK Dahua.** Le SDK réseau natif
> (`libdhnetsdk`) est une bibliothèque binaire C dont le mode centre d'alarme
> (`CLIENT_StartListenEx`) fait connecter les NVR sur un port TCP en protocole
> propriétaire : ni HTTPS, ni URL, et un binding natif à maintenir dans l'image
> Docker. L'API HTTP est l'interface de configuration à distance documentée par
> Dahua, elle supporte le TLS et c'est elle qui permet de ne déclarer qu'une
> adresse — exactement ce qui est attendu ici. Les deux mécanismes visent le même
> but ; seul le second se prête à une plateforme web.

Les tests renvoient un motif d'échec normalisé, exploitable par un humain comme
par un agent :

| Motif | Signification |
| --- | --- |
| `unreachable` | Hôte injoignable, port fermé, tunnel P2P non établi ou délai dépassé |
| `auth` | Identifiants refusés par l'équipement |
| `forbidden` | Compte valide mais droits insuffisants pour l'opération |
| `unsupported` | Impossible dans cette configuration (accès P2P non activé) |
| `invalid` | Configuration incomplète côté SENTINEL (ni IP ni numéro de série, pas de compte) |

### Enregistreurs en P2P

La plupart des sites clients n'ont ni VPN ni redirection de port : le NVR
s'enregistre sur le cloud Dahua avec son **numéro de série**, et c'est par là
que DMSS ou SmartPSS l'atteignent. SENTINEL fait la même chose : un tunnel est
ouvert vers l'équipement à partir de son numéro de série et des identifiants
stockés dans la plateforme, puis **toutes les fonctions marchent à l'identique**
— test d'accès, vérification des droits, interventions, provisionnement du
centre d'alarme. Le reste du code ne voit qu'un hôte et un port.

L'établissement du tunnel est la seule partie déléguée. Le transport Dahua
(PTCP, de l'encapsulage TCP-dans-UDP) n'est pas documenté publiquement : SENTINEL
délègue donc cette étape à l'utilitaire **`dh-p2p`** (implémentation
communautaire du protocole, licence MIT, [khoanguyen-3fc/dh-p2p](https://github.com/khoanguyen-3fc/dh-p2p)),
**vendoré sous `vendor/dh-p2p/` et compilé dans l'image Docker** (voir le
`Dockerfile`). Son contrat tient en une ligne : *à partir d'un numéro de série,
ouvrir un port TCP local qui aboutit sur l'équipement*.

Il n'y a **rien à configurer** : le défaut ci-dessous s'applique
automatiquement. On ne surcharge `DAHUA_P2P_HELPER` que pour pointer un autre
utilitaire (par exemple un habillage du SDK réseau officiel `libdhnetsdk`).

```env
DAHUA_P2P_HELPER="/usr/local/bin/dh-p2p --port {host}:{port}:{devicePort} {serial}"
```

Substitutions disponibles : `{serial}`, `{host}`, `{port}` (port local ouvert)
et `{devicePort}` (port visé sur l'équipement, soit `httpPort`). Pour un autre
utilitaire, les identifiants sont aussi exposés dans son environnement —
`DAHUA_P2P_USERNAME`, `DAHUA_P2P_PASSWORD`, `DAHUA_P2P_SERIAL`,
`DAHUA_P2P_LOCAL_PORT`, `DAHUA_P2P_DEVICE_PORT` — et **jamais** en arguments, qui
seraient lisibles dans la liste des processus.

`dh-p2p` ouvre son port TCP local dès son démarrage, avant la fin du handshake :
SENTINEL attend donc le marqueur `Ready to connect` sur sa sortie
(`DAHUA_P2P_READY_PATTERN`) avant d'émettre la moindre requête. Le tunnel est
mutualisé entre les appels concurrents et refermé après `DAHUA_P2P_IDLE_MS`
d'inactivité : une rafale d'appels sur le même enregistreur n'ouvre qu'une
session cloud.

Deux prérequis réseau côté serveur, tous deux satisfaits par un VPS au sortant
ouvert : joindre le cloud Dahua en **UDP** vers `*.easy4ipcloud.com:8800`, et
laisser sortir le trafic UDP vers les adresses que le cloud renvoie (le pair est
choisi dynamiquement). Si le tunnel ne s'établit pas, l'interface affiche la
sortie de `dh-p2p` et le motif `unreachable`.

Les firmwares qui exigent une **authentification à la création du canal P2P**
(réponse `403 DevPwd_InvalidSalt`) sont pris en charge : SENTINEL passe les
identifiants enregistrés à l'utilitaire (par l'environnement), qui lit le sel du
device, dérive la clé et signe l'ouverture du canal. C'est un patch local à
`dh-p2p` (voir `vendor/dh-p2p/VENDOR.md`), dont la cryptographie est validée par
vecteurs de test. Sans identifiants, le canal reste ouvert en clair comme avant.

Avec `DAHUA_P2P_HELPER` **vidé**, un NVR P2P reste déclarable et continue de
remonter ses alarmes par webhook ; l'interface indique alors que les tests et
les interventions demandent l'activation de l'accès P2P (motif `unsupported`).

> **Le numéro de série est un secret.** Sur les firmwares antérieurs à
> mi-2024, il suffit à ouvrir un tunnel vers la console web d'un équipement
> ([CVE-2025-31702](https://labs.itresit.es/2025/10/15/dahua-cve-2025-31702-p2p-auto-update-eop/)),
> et les séries sont partiellement prédictibles. Traiter le champ `p2pSerial`
> avec le même soin que les mots de passe, et tenir les firmwares à jour.

## API pour les agents IA et les intégrations

Base : `https://sentinel.noxia-groupe.fr/api/v1` ·
Contrat : [`/api/v1/openapi.json`](/api/v1/openapi.json) ·
Découverte : `GET /api/v1` (public, sans clé).

Les clés se créent dans *Paramètres → Clés d'API* (compte superadmin). Le secret
n'est affiché qu'une fois ; seul son SHA-256 est stocké.

```bash
curl -H "Authorization: Bearer sntl_xxxxxxxx_…" \
     https://sentinel.noxia-groupe.fr/api/v1/events?status=new&severity=critical
```

### Scopes

| Scope | Permet |
| --- | --- |
| `alarms:read` | Consulter les alarmes et leur main courante |
| `alarms:write` | Traiter les alarmes (prise en compte, clôture, commentaires) |
| `nvr:read` | Consulter les clients et l'inventaire des enregistreurs |
| `nvr:test` | Tester les connexions et vérifier les droits des comptes |
| `nvr:control` | Agir à distance (redémarrage, mise à l'heure, relais, capture) |
| `credentials:read` | Lire les mots de passe enregistrés en clair |
| `audit:read` | Consulter le journal d'audit |

Un appel hors périmètre répond `403` en indiquant le scope manquant et les
scopes accordés — et la tentative est tracée dans le journal d'audit.

### Endpoints principaux

| Méthode | Chemin | Scope |
| --- | --- | --- |
| `GET` | `/api/v1/me` | toute clé valide |
| `GET` | `/api/v1/stats` | `alarms:read` |
| `GET` | `/api/v1/clients` | `nvr:read` |
| `GET` | `/api/v1/nvrs` · `/api/v1/nvrs/{id}` | `nvr:read` |
| `POST` | `/api/v1/nvrs/{id}/test` | `nvr:test` |
| `GET` | `/api/v1/nvrs/{id}/credentials` | `nvr:read` |
| `POST` | `/api/v1/nvrs/{id}/credentials/{credentialId}/reveal` | `credentials:read` |
| `POST` | `/api/v1/nvrs/{id}/actions` | `nvr:test` ou `nvr:control` |
| `GET` | `/api/v1/events` · `/api/v1/events/{id}` | `alarms:read` |
| `PATCH` | `/api/v1/events/{id}` | `alarms:write` |
| `POST` | `/api/v1/events/{id}/comments` | `alarms:write` |

### Exemple : levée de doute automatisée

```bash
# 1. Les alarmes critiques non traitées
curl -H "Authorization: Bearer $KEY" \
  "$BASE/api/v1/events?status=new&severity=critical"

# 2. Vérifier que l'enregistreur répond toujours et avec quels droits
curl -X POST -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  -d '{}' "$BASE/api/v1/nvrs/$NVR/test"

# 3. Capturer l'image du canal concerné (JPEG en base64)
curl -X POST -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  -d '{"action":"snapshot","params":{"channel":3}}' "$BASE/api/v1/nvrs/$NVR/actions"

# 4. Clôturer avec un motif — l'action est attribuée au nom de la clé
curl -X PATCH -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  -d '{"status":"resolved","resolution":"Levée de doute : véhicule de livraison"}' \
  "$BASE/api/v1/events/$EVENT"
```

Un test de connexion en échec répond **200** avec `ok: false` et un motif : c'est
un résultat d'exploitation, pas une erreur d'API. Seuls les problèmes d'appel
(clé, scope, ressource inexistante) sortent en 4xx.

### Interventions disponibles

`POST /api/v1/nvrs/{id}/actions` avec `{"action": "...", "params": {...}}` :

- **Lecture** (`nvr:test`) : `device-info`, `users`, `channels`, `storage`,
  `alarm-out-state`, `alarm-center`, `event-indexes` (`params.code`), `snapshot`
  (`params.channel`).
- **Contrôle** (`nvr:control`) : `configure-alarm-center`, `sync-time`,
  `alarm-out` (`params.index`, `params.active`), `reboot`.

Le catalogue exact est renvoyé par `GET /api/v1/nvrs/{id}/actions` et décrit dans
la spécification OpenAPI.

## Sécurité

- Les mots de passe des NVR sont chiffrés en **AES-256-GCM** avec
  `ENCRYPTION_KEY`. **Changer cette clé rend les mots de passe existants
  illisibles** — les tests remontent alors une erreur de déchiffrement explicite.
- Un mot de passe n'est jamais renvoyé par les routes de consultation : il faut
  un appel explicite à `…/reveal`, qui écrit dans le journal d'audit qui a lu
  quoi, quand et depuis quelle IP.
- `credentials:read` et `nvr:control` ne devraient être accordés qu'aux
  intégrations qui en ont réellement besoin.
- SENTINEL se connecte aux adresses IP déclarées dans l'inventaire : ces
  équipements étant sur des réseaux privés ou des VPN, l'ajout d'un
  enregistreur reste une opération réservée aux utilisateurs authentifiés.

## Développement

```bash
npm install
npx prisma generate       # génère le client dans src/generated/prisma
npm run dev
```

Le client Prisma est généré, pas versionné : `npx prisma generate` est
obligatoire après un `npm install` propre, sinon le typecheck échoue.

Vérifications avant commit :

```bash
npx tsc --noEmit
npx eslint .
npx next build
```

## Déploiement

```bash
docker compose up -d --build
```

`entrypoint.sh` attend PostgreSQL puis applique les fichiers
`prisma/migrations/*/migration.sql` avec `psql` avant de démarrer le serveur.
Toutes les migrations sont rejouées à chaque démarrage : elles sont écrites de
façon **idempotente** (`IF NOT EXISTS`, contraintes ajoutées sous condition).

Le service applicatif n'expose aucun port : il est publié par Nginx Proxy
Manager via le réseau externe `nginx-proxy`.
