# Sentinel

Centre d'alarme des enregistreurs Dahua exploités pour nos clients.

Sentinel reçoit les événements Alarm Center des NVR du parc, permet de les
**traiter depuis la plateforme** (prise en compte, main courante, clôture),
stocke les identifiants d'accès de façon chiffrée et sait s'en servir pour
**tester une connexion, vérifier les droits d'un compte et intervenir à
distance** sur l'équipement. Tout est également exposé par une **API à clés**
destinée aux intégrations et aux agents IA.

Stack : Next.js 16 (App Router) · Prisma 7 / PostgreSQL · NextAuth v5 ·
Tailwind 4 · Docker.

Développé par OrizonLab.

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

**Un compte Microsoft valide ne suffit pas** : l'adresse doit aussi figurer dans
la liste d'accès de la plateforme (voir [§ 3](#3-accès-et-rôles)).

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

### 3. Accès et rôles

L'accès est accordé **adresse par adresse**, depuis *Paramètres → Accès à la
plateforme* :

| Statut | Effet |
| --- | --- |
| **Autorisé** | Accès à la plateforme, avec le rôle choisi |
| **Banni** | Aucun accès ; les sessions ouvertes sont coupées immédiatement |
| **Demande d'accès** | Compte Microsoft qui a tenté de se connecter sans être dans la liste : aucun accès, mais le superadmin peut l'autoriser ou le bannir en un clic |
| *(absent de la liste)* | Aucun accès |

Une adresse refusée arrive sur une page « Accès non autorisé » qui invite à se
rapprocher de son responsable systèmes (même message quel que soit le motif).

| Rôle | Droits |
| --- | --- |
| **Utilisateur** | Tout voir et tout faire (alarmes, enregistreurs, clients, interventions), **sauf les paramètres** |
| **Superadmin** | Tout, y compris les paramètres : liste d'accès, clés d'API, journal d'audit |

Les adresses de `ADMIN_EMAILS` (séparées par des virgules) sont **superadmins
d'office** : c'est l'amorçage de la plateforme, elles ne sont ni modifiables ni
bannissables depuis l'interface. Un superadmin ne peut pas non plus se bannir,
se rétrograder ou se retirer lui-même. L'accès et le rôle sont réévalués à
chaque requête : un changement s'applique sans attendre l'expiration de la
session. Toutes les modifications sont tracées dans le journal d'audit.

> La liste d'accès repose sur l'adresse e-mail transmise par Entra ID.
> Renseigner `AUTH_MICROSOFT_ENTRA_ID_ISSUER` avec le **tenant ID** de
> l'organisation (plutôt que `common`) garantit que ces adresses sont gérées
> par l'annuaire de l'entreprise.

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
délègue donc cette étape à l'utilitaire **`dh-fwd`** (implémentation
communautaire du protocole, licence MIT, [undervolter/dh-fwd](https://github.com/undervolter/dh-fwd)),
**vendoré sous `vendor/dh-fwd/` et compilé dans l'image Docker** (voir le
`Dockerfile` et `vendor/dh-fwd/VENDOR.md`). Son contrat tient en une ligne :
*à partir d'un numéro de série, ouvrir un port TCP local qui aboutit sur
l'équipement*. Contrairement à l'ancienne preuve de concept `dh-p2p` (toujours
présente sous `vendor/dh-p2p/` pour référence, mais plus compilée), `dh-fwd`
gère les firmwares **postérieurs à 2024.07**, qui exigent un canal authentifié
et le dialecte de requête exact du client officiel.

Il n'y a **rien à configurer** : le défaut ci-dessous s'applique
automatiquement. On ne surcharge `DAHUA_P2P_HELPER` que pour pointer un autre
utilitaire (par exemple un habillage du SDK réseau officiel `libdhnetsdk`).

```env
DAHUA_P2P_HELPER="/usr/local/bin/dh-fwd {serial} -p {port}:{devicePort}"
```

Substitutions disponibles : `{serial}`, `{port}` (port local ouvert) et
`{devicePort}` (port visé sur l'équipement, soit `httpPort`). Les identifiants et
les réglages sont exposés à l'utilitaire par son **environnement** —
`DAHUA_P2P_USERNAME`, `DAHUA_P2P_PASSWORD`, `DAHUA_P2P_PROFILE`,
`DAHUA_P2P_RELAY`, `DAHUA_P2P_SERIAL`, `DAHUA_P2P_LOCAL_PORT`,
`DAHUA_P2P_DEVICE_PORT` — et **jamais** en arguments, qui seraient lisibles dans
la liste des processus.

`dh-fwd` ouvre son port TCP local dès son démarrage, avant la fin du handshake :
SENTINEL attend donc le marqueur `Listening on` sur sa sortie
(`DAHUA_P2P_READY_PATTERN`) avant d'émettre la moindre requête. Le tunnel est
mutualisé entre les appels concurrents et refermé après `DAHUA_P2P_IDLE_MS`
d'inactivité : une rafale d'appels sur le même enregistreur n'ouvre qu'une
session cloud.

**Profil applicatif.** Dahua utilise des serveurs cloud distincts selon
l'application d'enrôlement. `DAHUA_P2P_PROFILE` sélectionne le dialecte :
`smartpss` (défaut, cloud easy4ip — équipement enregistré via **SmartPSS**) ou
`dmss` (cloud Dolynk — enrôlé via l'application **DMSS**). Un mauvais profil fait
répondre le cloud par un **404** : SENTINEL bascule alors automatiquement sur
l'autre profil et retient, pour chaque NVR, celui qui a fonctionné. La variable
ne fixe donc que le profil essayé en premier.

**Authentification post-2024.** Les firmwares récents exigent un canal
authentifié : sans le bon dialecte, ils répondent `403 DevPwd_InvalidNonce` /
`DevPwd_InvalidDigest` même avec une cryptographie de corps correcte. `dh-fwd`
lit le sel du device, dérive la clé, signe les requêtes et reproduit l'ordre
d'en-têtes attendu par l'application ; le profil `dmss` évite en plus l'étape de
*relay-channel* qui provoquait un `Relay agent timeout`. SENTINEL lui passe
simplement les identifiants enregistrés par l'environnement. Sans identifiants,
le canal reste ouvert en clair (firmwares anciens).

Prérequis réseau côté serveur, satisfaits par un VPS au sortant ouvert : joindre
le cloud Dahua en **UDP** (Dolynk pour `dmss`, easy4ip pour `smartpss`) et
laisser sortir le trafic UDP vers les adresses que le cloud renvoie (le pair est
choisi dynamiquement). Si le tunnel ne s'établit pas, l'interface affiche la
sortie de `dh-fwd` et le motif `unreachable`.

Derrière un NAT qui bloque la connexion directe, activer le **mode relais** —
`DAHUA_P2P_RELAY=1` — qui fait transiter le trafic par le serveur relais Dahua :
plus lent mais robuste, et suffisant pour la maintenance (requêtes courtes).

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

## Hermes Agent (MCP et webhooks sortants)

Sentinel se relie à un [agent Hermes](https://hermes-agent.nousresearch.com/docs/)
dans les deux sens. Tout se configure dans *Paramètres → Hermes Agent*
(superadmin).

### Hermes → Sentinel : serveur MCP

Sentinel expose un serveur **MCP** (Model Context Protocol, transport
« Streamable HTTP ») sur `/api/mcp`, authentifié par une clé d'API :

```yaml
# ~/.hermes/config.yaml
mcp_servers:
  sentinel:
    url: "https://sentinel.noxia-groupe.fr/api/mcp"
    headers:
      Authorization: "Bearer sntl_…"
    timeout: 120
```

Le bouton *Générer la clé de connexion Hermes* crée la clé et affiche ce bloc
prêt à coller. Outils disponibles, **filtrés selon les scopes de la clé** :

| Outil | Scope | Rôle |
| --- | --- | --- |
| `sentinel_overview` | `alarms:read` | Alarmes en cours, NVR en ligne / hors ligne |
| `list_alarms`, `get_alarm` | `alarms:read` | Flux d'alarmes filtrable, détail et main courante |
| `update_alarm` | `alarms:write` | Prise en compte, clôture, entrée de main courante |
| `list_clients`, `list_nvrs`, `get_nvr` | `nvr:read` | Inventaire et derniers tests |
| `test_nvr` | `nvr:test` | Test d'accès réel (IP ou P2P) et droits du compte |
| `nvr_action` | `nvr:test` / `nvr:control` | Interventions (capture renvoyée en image, disques, heure, relais, redémarrage…) |

Sans le scope `nvr:control` (case *Autoriser les interventions*), Hermes
observe, teste et traite les alarmes mais ne modifie aucun équipement. La
lecture des mots de passe n'est **jamais** exposée par MCP. Chaque appel passe
par les mêmes contrôles et le même journal d'audit que l'API `/api/v1`, au nom
de la clé.

### Sentinel → Hermes : webhooks sortants

Sentinel pousse vers une ou plusieurs URL les événements choisis :

| `event_type` | Déclencheur |
| --- | --- |
| `alarm.created` | Nouvelle alarme reçue d'un enregistreur |
| `alarm.status_changed` | Prise en compte / clôture (option) |
| `nvr.offline` / `nvr.online` | Enregistreur injoignable / rétabli (option) |
| `sentinel.test` | Bouton *Tester* |

Filtres par webhook : **criticité**, **famille** (intrusion, vidéo, entrées /
sorties, stockage, réseau et système) et **client** — rien de coché = tout.
Chaque corps JSON porte `event_type`, un `summary` lisible et les blocs
`alarm`, `nvr`, `client`.

Format **Hermes « generic »** : `X-Webhook-Timestamp` +
`X-Webhook-Signature-V2` (HMAC-SHA256 hexadécimal de `<timestamp>.<corps>`,
anti-rejeu ±300 s), `X-Webhook-Signature` (V1) et `X-Request-ID` stable entre
les tentatives (dédoublonnage côté Hermes). Le secret `whsec_…` est chiffré en
base et affiché une seule fois, avec la route Hermes prête à coller :

```yaml
platforms:
  webhook:
    enabled: true
    extra:
      routes:
        sentinel:
          secret: "whsec_…"
          events: ["alarm.created", "nvr.offline", "nvr.online", "sentinel.test"]
          prompt: |
            Événement Sentinel : {summary}
            Données complètes : {__raw__}
          deliver: "telegram"
```

URL à déclarer dans Sentinel : `http://<serveur-hermes>:8644/webhooks/sentinel`.

Livraison : premier envoi immédiat, puis nouvelles tentatives à 30 s, 2 min,
10 min, 30 min et 2 h en cas d'erreur réseau ou de réponse 5xx / 408 / 429.
Une réponse 4xx (signature refusée, route inconnue) arrête les essais. Les 30
dernières livraisons sont visibles dans les paramètres, avec renvoi manuel.
Les adresses de lien local (`169.254.0.0/16`, métadonnées cloud) sont refusées,
y compris après résolution DNS au moment de l'envoi.

## Sécurité

- Les mots de passe des NVR sont chiffrés en **AES-256-GCM** avec
  `ENCRYPTION_KEY`. **Changer cette clé rend les mots de passe existants
  illisibles** — les tests remontent alors une erreur de déchiffrement explicite.
- Un mot de passe n'est jamais renvoyé par les routes de consultation : il faut
  un appel explicite à `…/reveal`, qui écrit dans le journal d'audit qui a lu
  quoi, quand et depuis quelle IP.
- `credentials:read` et `nvr:control` ne devraient être accordés qu'aux
  intégrations qui en ont réellement besoin.
- Le serveur MCP n'expose jamais les mots de passe ; les webhooks sortants
  sont signés (HMAC-SHA256) avec un secret chiffré en base.
- L'accès à l'interface est limité à une liste d'adresses gérée par le
  superadmin (autoriser, bannir, rôle) — voir *Accès et rôles*.
- Sentinel se connecte aux adresses IP déclarées dans l'inventaire : ces
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
