# Audit de sécurité SENTINEL — 14 octobre 2026

**Périmètre** : dépôt `Noxia-Groupe/sentinel` (commit `7fcc61b`, branche `main`) et configuration de déploiement de https://sentinel.noxia-groupe.fr (Docker Compose, Nginx Proxy Manager).

**Méthode** : revue manuelle du code (authentification, autorisations, routes API, chiffrement, exécution de processus, webhooks entrants/sortants, MCP), analyse de la configuration (Docker, Compose, Next.js, Prisma), recherche de secrets dans l'historique Git, `npm audit` sur les dépendances de production.

**Limite importante** : le site de production n'était **pas joignable** depuis l'environnement d'audit (résolution DNS impossible par deux chemins distincts). Aucune vérification « en direct » (en-têtes HTTP, TLS, ports ouverts, comportement réel des routes) n'a donc pu être faite. La section 6 donne la liste exacte des commandes à exécuter pour compléter l'audit côté production.

---

## 1. Note de sécurité actuelle (avant corrections)

# **54 / 100**

| Domaine | Note | Commentaire |
|---|---|---|
| Authentification & sessions | 14 / 20 | SSO Entra ID + liste d'accès solide ; sessions trop longues, restriction au tenant optionnelle |
| Autorisations (RBAC) | 9 / 20 | Un simple `user` lit les mots de passe en clair, supprime, redémarre, reconfigure |
| Surface publique & résistance aux abus | 8 / 15 | Webhook public sans limitation de débit ni de taille, lot MCP illimité |
| Dépendances & maintien à jour | 4 / 15 | Next.js 16.2.12 avec 3 avis critiques (RCE), 25 vulnérabilités en production |
| Secrets & cryptographie | 12 / 15 | AES-256-GCM, clés d'API hachées, HMAC ; jeton webhook faible, pas de rotation de clé |
| Infrastructure, en-têtes & durcissement | 7 / 15 | Aucun en-tête de sécurité applicatif, base sur réseau partagé, conteneur peu durci |

**Note cible après application du plan de remédiation (section 7) : 85–90 / 100.**

---

## 2. Synthèse

Le socle est sain : SSO Microsoft Entra ID avec liste d'accès réévaluée à chaque requête, révocation immédiate des sessions, clés d'API hachées avec comparaison à temps constant et scopes, chiffrement AES-256-GCM des mots de passe d'enregistreurs, journal d'audit sur les opérations sensibles, aucun passage par un shell pour lancer `dh-fwd` ou `ffmpeg`, webhooks sortants signés HMAC avec horodatage anti-rejeu, conteneur non-root, auto-updater du binaire P2P neutralisé, aucun secret réel dans l'historique Git (le `.env.production` commité en `ae2e6f9` ne contenait que des `CHANGE_ME`, vérifié).

Trois faiblesses pèsent lourd dans la note :

1. **Framework vulnérable** : Next.js 16.2.12 est couvert par trois avis **critiques** (exécution de code à distance non authentifiée), un avis élevé (SSRF) et des empoisonnements de cache. Correctif disponible (16.4.0).
2. **Endpoint public sans garde-fou** : `/api/webhooks/dahua/[token]` accepte GET et POST sans limitation de débit, sans limite de taille, et écrit en base à chaque appel. Le jeton qui le protège est un `cuid()`, pas un secret cryptographique.
3. **Modèle de rôles trop grossier** : tout compte `user` peut révéler les mots de passe des NVR en clair, supprimer clients et enregistreurs, couper l'alimentation PoE, redémarrer et réécrire la configuration du centre d'alarme avec des champs arbitraires. Un seul compte Microsoft compromis donne la main sur tout le parc.

---

## 3. Tableau des constats

| ID | Sévérité | Constat | Localisation |
|---|---|---|---|
| V1 | **Élevée** | Next.js 16.2.12 : 3 RCE critiques, SSRF, cache poisoning ; `sharp`, `undici`, `proxy-addr` vulnérables | `package.json`, `package-lock.json` |
| V2 | **Élevée** | Webhook Dahua public sans limitation de débit ni de taille (DoS, flood de la base, force brute du jeton) | `src/app/api/webhooks/dahua/[token]/route.ts` |
| V3 | **Élevée** | Rôle `user` = pouvoir total hors paramètres (révélation des mots de passe, suppression, reboot, PoE off, réécriture du centre d'alarme, direct vidéo) | `src/lib/session.ts`, `src/app/api/nvrs/**` |
| V4 | Moyenne | Jeton de webhook généré par `cuid()` (horodatage + compteur + empreinte + ~41 bits d'aléa), corrélé à l'identifiant public du NVR, transporté dans l'URL | `prisma/schema.prisma:147` |
| V5 | Moyenne | SSRF authentifié : l'adresse/ports d'un NVR sont libres (127.0.0.1, `sentinel-db`, NPM :81, 169.254.169.254) et déclenchent test/health/actions/direct/supervision | `src/app/api/nvrs/route.ts`, `src/app/api/nvrs/[id]/route.ts`, `src/lib/dahua/service.ts` |
| V6 | Moyenne | Sessions de 30 jours par défaut sans expiration d'inactivité ; jetons OAuth Entra stockés en clair en base | `src/lib/auth.ts`, `prisma/schema.prisma` (`Account`) |
| V7 | Moyenne | Restriction au tenant Entra optionnelle (issuer vide = tout compte Microsoft) ; création automatique d'entrées « pending » non plafonnée (pollution, ingénierie sociale) | `src/lib/auth.ts:11-23`, `src/lib/access.ts:309-334` |
| V8 | Moyenne | MCP : lot JSON-RPC de taille illimitée → contournement du rate limit, épuisement (tunnels P2P, processus) | `src/app/api/mcp/route.ts:263-265` |
| V9 | Moyenne | Aucun en-tête de sécurité applicatif (CSP, HSTS, X-Frame-Options, Referrer-Policy, Permissions-Policy) ; `X-Powered-By` actif | `next.config.ts` |
| V10 | Moyenne | Anti-CSRF reposant uniquement sur `SameSite=Lax` ; aucune vérification d'`Origin` sur les routes API à session (sous-domaines same-site) | `src/lib/session.ts` |
| V11 | Moyenne | PostgreSQL attaché au réseau partagé `nginx-proxy` : joignable par tout conteneur de ce réseau | `docker-compose.yml:12-13` |
| V12 | Moyenne | Totalité des secrets de l'application (`ENCRYPTION_KEY`, `NEXTAUTH_SECRET`, `DATABASE_URL`, secret Entra) transmise aux processus enfants `dh-fwd` et `ffmpeg` | `src/lib/dahua/p2p.ts:451-462`, `src/lib/dahua/live.ts:175-201` |
| V13 | Faible | Pas de couche d'authentification « refus par défaut » (`proxy.ts`) : chaque route doit penser à appeler le garde | `src/app/api/**` |
| V14 | Faible | HTTPS vers les NVR sans aucune vérification de certificat (MITM possible sur Internet/P2P) | `src/lib/dahua/http.ts:155` |
| V15 | Faible | IP consignée dans l'audit falsifiable (`X-Forwarded-For` première valeur, contrôlée par le client) | `src/lib/actor.ts:370-374` |
| V16 | Faible | Durcissement conteneur absent (`cap_drop`, `no-new-privileges`, `read_only`, limites), pas de `.dockerignore`, `!.env.production` dans `.gitignore`, migrations appliquées avec `\|\| true`, CLI `shadcn`/`prisma` en `dependencies` | `docker-compose.yml`, `Dockerfile`, `entrypoint.sh`, `.gitignore`, `package.json` |
| V17 | Faible | Validation d'entrées lâche (statut NVR libre, type de compte libre, longueurs non bornées) ; `ENCRYPTION_KEY` non validée au démarrage ; pas d'identifiant de clé dans les chiffrés (rotation impossible) | `src/app/api/nvrs/[id]/route.ts:97`, `src/lib/crypto.ts` |
| V18 | Faible | Épuisement de ressources : diagnostic P2P (2 × 40 s de processus) et tests sans plafond par utilisateur | `src/app/api/nvrs/[id]/p2p-diagnostic/route.ts`, `src/lib/dahua/p2p.ts:592-631` |
| V19 | Faible | Webhooks sortants : oracle SSRF limité (300 premiers caractères d'une réponse d'erreur), contrôle DNS puis `fetch` (TOCTOU) — superadmin uniquement | `src/lib/outbound-webhooks.ts:115-123, 437-442` |
| V20 | Info | `/api/v1` et `/api/v1/openapi.json` publics (contrat de l'API, scopes) ; messages d'erreur détaillés (stderr ffmpeg, déchiffrement) | `src/app/api/v1/route.ts`, `src/lib/dahua/live.ts:60-75` |

---

## 4. Détail des constats et corrections

### V1 — Next.js 16.2.12 : avis critiques (Élevée)

**Constat.** `npm audit --omit=dev` : 25 vulnérabilités (2 critiques, 19 élevées, 4 modérées). Pour `next` (installé 16.2.12, correctif 16.4.0) :

- GHSA-2xp9-vwfh-vxw4 — **critique** — RCE non authentifiée dans l'API d'optimisation d'images (AVIF), `< 16.3.3`
- GHSA-vcvr-r3jv-pc5j — **critique** — RCE dans `next/og` ImageResponse, `< 16.3.6`
- GHSA-p293-qw3h-jr36 — critique — RCE (hôtes Windows uniquement, non applicable ici)
- GHSA-cjq9-62q9-8jv4 — élevée — SSRF dans l'optimisation d'images, `< 16.3.8`
- GHSA-4jqv-mc3x-m676, GHSA-mcj8-r9mp-w47p — modérées — empoisonnement de cache SSG/ISR (substitution de contenu entre utilisateurs, déni de service persistant)

L'application n'utilise `next/image` qu'avec `unoptimized` et une data-URL (`src/app/(dashboard)/nvrs/[id]/page.tsx:1057`) et ne déclare aucun `remotePatterns`, ce qui réduit fortement l'exploitabilité de l'AVIF/SSRF. Mais la route `/_next/image` reste servie, sans authentification, par le serveur standalone. S'ajoutent `sharp` (libvips, libheif, librsvg : 3 avis élevés), `undici` (10 avis dont contournement de validation TLS et DoS) et `proxy-addr` (critique, usurpation d'IP).

**Impact.** Exécution de code sur le conteneur sans compte, à partir d'Internet, si une des conditions d'exploitation est réunie ; dans tous les cas, exposition d'une surface connue et publiée.

**Correction.**
```bash
npm install next@^16.4.0 eslint-config-next@^16.4.0
npm audit fix            # undici, proxy-addr, fast-uri, nanoid, qs…
npm audit --omit=dev     # doit être vide
```
```ts
// next.config.ts
const nextConfig: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  images: { unoptimized: true },   // l'optimiseur n'est pas utilisé : on le désactive
};
```
Dans Nginx Proxy Manager, bloquer en plus `location /_next/image { return 404; }`. Mettre en place Dependabot ou Renovate et faire échouer la CI sur `npm audit --omit=dev --audit-level=high`.

### V2 — Webhook Dahua public sans garde-fou (Élevée)

**Constat.** `src/app/api/webhooks/dahua/[token]/route.ts` :
- accepte GET et POST, lit tout le corps avec `req.text()` sans plafond (l.135), puis stocke le JSON complet en base (l.108, l.121) ;
- chaque appel provoque au moins deux écritures (`nvr.update`, `nvrEvent.create`/`update`) et peut déclencher des livraisons de webhooks sortants ;
- aucune limitation de débit (le limiteur ne s'applique qu'aux clés d'API) ;
- la réponse distingue jeton inconnu (404) et jeton valide (200) : oracle utile à une force brute, que rien ne ralentit.

**Impact.** Déni de service (CPU, base, disque), pollution du centre d'alarme et des agents Hermes (faux événements si le jeton est obtenu), découverte du jeton par force brute.

**Correction.**
1. Refuser les corps de plus de 64 Ko (`Content-Length` puis lecture bornée), ne stocker que la partie utile du payload (tronquer à 16 Ko).
2. Limiter le débit **par jeton** (par exemple 60/min) et **par IP** (par exemple 120/min), en mémoire comme pour les clés d'API, avec réponse 429.
3. Dans NPM : `limit_req_zone $binary_remote_addr zone=webhook:10m rate=10r/s;` sur `/api/webhooks/`, et `client_max_body_size 64k` sur cette location.
4. Réponse identique (204 sans corps) que le jeton existe ou non, après un délai constant.
5. Journaliser (sans le jeton) les appels refusés pour détecter une attaque.

### V3 — Rôle `user` trop puissant (Élevée)

**Constat.** `requireUser` protège toutes les routes opérationnelles ; `requireSuperadmin` ne couvre que les paramètres. Un `user` peut donc :
- lire tout mot de passe en clair (`POST /api/nvrs/[id]/credentials/[credId]/reveal`) ;
- supprimer un enregistreur et tout son historique (`DELETE /api/nvrs/[id]`), un client (`DELETE /api/clients/[id]`) ;
- redémarrer, couper un port PoE, piloter un relais (`POST /api/nvrs/[id]/actions`) ;
- réécrire la configuration du centre d'alarme de l'équipement avec des champs **arbitraires** (`configure-alarm-center` + `params.fields`, `src/lib/dahua/actions.ts:344-368`) — c'est-à-dire détourner les alarmes vers un autre serveur ;
- ouvrir un direct vidéo sur n'importe quelle caméra.

**Impact.** Un seul compte Microsoft compromis (phishing, poste infecté) = compromission de tous les enregistreurs du parc, de leurs mots de passe et des flux vidéo. Pas de séparation entre consultation et intervention, aucun second facteur applicatif.

**Correction.**
1. Introduire trois rôles : `viewer` (lecture, traitement des alarmes), `operator` (tests, actions de lecture, interventions non destructives), `admin` (révélation des mots de passe, suppressions, reboot/PoE/relais, configuration du centre d'alarme), `superadmin` inchangé. Ajouter `requireRole(req, "operator")` dans `src/lib/session.ts` et l'appliquer route par route.
2. Pour la révélation d'un mot de passe : motif obligatoire, limitation (par exemple 10 révélations/heure/compte), et notification des superadmins.
3. `configure-alarm-center` : n'accepter que les champs connus (`Address`, `Port`, `Enable`, `Protocol`) et refuser toute `Address` qui n'est pas celle de SENTINEL.
4. Suppressions : demander une confirmation côté serveur (nom du NVR à ressaisir) ou passer par une corbeille (`deletedAt`).
5. Activer l'authentification multifacteur et les stratégies d'accès conditionnel côté Entra ID pour l'application.

### V4 — Jeton de webhook faible (Moyenne)

**Constat.** `webhookToken String @unique @default(cuid())` (`prisma/schema.prisma:147`). Un cuid v1 vaut `c` + horodatage + compteur + empreinte de processus + 8 caractères aléatoires (~41 bits). Le `id` du NVR est un cuid généré dans la même opération : horodatage, compteur (±1) et empreinte sont donc connus de quiconque voit l'identifiant du NVR — et cet identifiant circule partout (interface, `/api/v1/nvrs`, payload des webhooks sortants `nvr.id`). Le jeton transite en clair dans l'URL (journaux d'accès de NPM, configuration de l'enregistreur, éventuellement en HTTP pour les firmwares anciens).

**Impact.** Espace de recherche réduit à ~2,8 × 10¹² au lieu de 2¹²⁸ ; combiné à V2 (aucune limitation), la force brute est lente mais possible. Un jeton obtenu permet d'injecter de fausses alarmes et de faire passer un NVR pour « en ligne ».

**Correction.**
1. Générer le jeton à la création : `crypto.randomBytes(32).toString("base64url")` (256 bits) dans `src/app/api/nvrs/route.ts`, et retirer le `@default(cuid())`.
2. Ajouter `POST /api/nvrs/[id]/webhook-token/rotate` (admin), qui régénère le jeton puis relance `configure-alarm-center`.
3. Migration : régénérer tous les jetons existants puis reprovisionner les NVR.
4. Dans NPM, ne pas journaliser l'URL complète de `/api/webhooks/` (ou masquer le dernier segment).

### V5 — SSRF authentifié via l'adresse du NVR (Moyenne)

**Constat.** `ip`, `httpPort`, `rtspPort` sont acceptés tels quels (`src/app/api/nvrs/route.ts:52, 82-84` ; `[id]/route.ts:88-91`). Le serveur contacte ensuite cette cible avec les routes `test`, `health`, `actions`, `live`, et la supervision la sonde toutes les 5 minutes. Les messages d'erreur (statut HTTP, extraits de réponse, stderr ffmpeg jusqu'à 300 caractères) sont renvoyés à l'appelant.

**Impact.** Cartographie et sondage du réseau interne (`127.0.0.1:3000`, `sentinel-db:5432`, interface d'administration de NPM sur `:81`, métadonnées cloud `169.254.169.254`), depuis un simple compte `user`. Les condensés Digest/MD5 des mots de passe d'enregistreurs sont envoyés à la cible choisie (cassage hors ligne).

**Correction.**
1. Valider `ip` : IPv4/IPv6 littérale ou nom d'hôte ; refuser `127.0.0.0/8`, `::1`, `0.0.0.0`, `169.254.0.0/16`, `fe80::/10`, les adresses multicast et le nom du service `sentinel-db`. Les plages privées (10/8, 172.16/12, 192.168/16) doivent rester permises (VPN), mais sur liste explicite configurable (`NVR_ALLOWED_CIDRS`).
2. Résoudre le nom au moment de la connexion et réappliquer la liste (comme `assertDeliverableHost` des webhooks sortants).
3. Isoler le conteneur applicatif du réseau d'administration de NPM (voir V11).

### V6 — Sessions longues, jetons OAuth en base (Moyenne)

**Constat.** `NextAuth({...})` sans option `session` : durée par défaut 30 jours, sans expiration d'inactivité. L'adaptateur Prisma conserve `access_token`, `refresh_token`, `id_token` Entra en clair dans `Account`.

**Correction.**
```ts
session: { strategy: "database", maxAge: 12 * 60 * 60, updateAge: 60 * 60 },
```
Ne pas conserver les jetons OAuth (surcharger `linkAccount` dans l'adaptateur pour mettre ces champs à `null`), ou chiffrer ces colonnes avec `ENCRYPTION_KEY`. Afficher et permettre de révoquer les sessions actives par compte dans les paramètres.

### V7 — Restriction au tenant optionnelle, entrées « pending » illimitées (Moyenne)

**Constat.** Si `AUTH_MICROSOFT_ENTRA_ID_ISSUER` est vide, le fournisseur bascule sur le tenant `common` : n'importe quel compte Microsoft (personnel inclus) peut lancer une connexion. Le callback `signIn` crée alors une entrée `pending` avec le nom affiché choisi par l'utilisateur (`recordLoginAttempt`). Rien ne borne le nombre d'entrées.

**Impact.** Pollution de la liste d'accès, ingénierie sociale (nom et adresse ressemblants à un collègue pour obtenir un clic « Autoriser »), remplissage de la base. **À vérifier en production** : valeur réelle de l'issuer.

**Correction.**
1. Rendre l'issuer obligatoire : refuser de démarrer si la variable est vide ou ne contient pas un GUID de tenant.
2. Vérifier en plus la revendication `tid` du jeton d'identité dans `signIn`.
3. Plafonner les entrées `pending` (par exemple 50) et purger celles de plus de 30 jours ; afficher le domaine de l'adresse en évidence et avertir si le domaine n'est pas `noxia-groupe.fr`.

### V8 — Lot JSON-RPC MCP illimité (Moyenne)

**Constat.** `src/app/api/mcp/route.ts:263-265` : un tableau JSON est traité intégralement avec `Promise.all`, alors que le limiteur n'a compté qu'une requête.

**Correction.** Refuser les lots de plus de 10 messages (`-32600`), décompter chaque message dans `checkRateLimit`, et exécuter les appels d'outils séquentiellement.

### V9 — En-têtes de sécurité absents (Moyenne)

**Constat.** `next.config.ts` ne définit aucun en-tête ; `X-Powered-By: Next.js` est émis. Ce que NPM ajoute n'a pas pu être vérifié.

**Correction.**
```ts
// next.config.ts
async headers() {
  return [{
    source: "/(.*)",
    headers: [
      { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
      { key: "Content-Security-Policy", value:
        "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; " +
        "img-src 'self' data: blob: https://*.microsoft.com https://*.live.com; font-src 'self'; " +
        "connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self' https://login.microsoftonline.com" },
      { key: "X-Frame-Options", value: "DENY" },
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
    ],
  }];
},
poweredByHeader: false,
```
Tester la CSP en mode `Content-Security-Policy-Report-Only` d'abord. Dans NPM : forcer SSL, HTTP/2, HSTS, « Block Common Exploits ».

### V10 — CSRF : pas de vérification d'origine (Moyenne)

**Constat.** Les routes API à session ne vérifient ni `Origin` ni `Sec-Fetch-Site`. `SameSite=Lax` bloque un site tiers, mais pas un autre sous-domaine de `noxia-groupe.fr` (same-site) compromis ou vulnérable à une XSS.

**Correction.** Dans `requireUser`, pour toute méthode autre que GET/HEAD : si l'en-tête `Origin` est présent, exiger qu'il soit égal à l'origine de `NEXTAUTH_URL` ; si `Sec-Fetch-Site` vaut `cross-site`, refuser (403).

### V11 — Base de données sur le réseau partagé (Moyenne)

**Constat.** `sentinel-db` est attaché à `nginx-proxy` (`docker-compose.yml:12-13`), réseau externe partagé avec NPM et probablement d'autres applications. Tout conteneur de ce réseau peut ouvrir `sentinel-db:5432`.

**Correction.**
```yaml
services:
  sentinel-db:
    networks: [sentinel-internal]
  sentinel-app:
    networks: [sentinel-internal, nginx-proxy]
networks:
  sentinel-internal:
    internal: true
  nginx-proxy:
    external: true
```
Vérifier aussi que `5432` n'est pas publié sur l'hôte et que l'interface d'administration de NPM (`:81`) n'est accessible que par VPN ou liste d'IP.

### V12 — Secrets transmis aux processus enfants (Moyenne)

**Constat.** `spawn(command, args, { env: { ...process.env, DAHUA_P2P_* } })` (`src/lib/dahua/p2p.ts:451-462`) et `spawn(ffmpeg, …)` (héritage par défaut, `src/lib/dahua/live.ts:175-201`) donnent à `dh-fwd` (outil tiers issu de rétro-ingénierie, qui parle au cloud Dahua) et à `ffmpeg` (qui parse un flux RTSP venant de l'équipement) l'intégralité des secrets de la plateforme.

**Impact.** Une vulnérabilité dans `dh-fwd` ou `ffmpeg` exploitée par un équipement ou un relais cloud malveillant expose `ENCRYPTION_KEY` (donc tous les mots de passe du parc), `NEXTAUTH_SECRET`, l'accès base et le secret Entra.

**Correction.** Construire un environnement minimal : `{ PATH, HOME: "/tmp", TZ, DAHUA_P2P_* }` pour `dh-fwd`, `{ PATH }` pour `ffmpeg`. À terme, exécuter `dh-fwd` et `ffmpeg` dans un conteneur sidecar sans secret, joint par un socket local.

### V13 — Pas de refus par défaut (Faible)

**Constat.** Aucune `proxy.ts`/`middleware.ts`. Toutes les routes actuelles appellent bien un garde (vérifié une à une), sauf les routes volontairement publiques (`/api/auth`, `/api/webhooks/dahua`, `/api/v1`, `/api/v1/openapi.json`, `/api/mcp`). Une route oubliée demain serait publique.

**Correction.** Ajouter `src/proxy.ts` : exiger une session pour tout sauf une liste explicite de préfixes publics. Garder les gardes par route (défense en profondeur). Évaluer si `/api/v1` et `/api/v1/openapi.json` doivent rester publics (un agent peut recevoir la documentation avec sa clé).

### V14 — TLS vers les NVR sans vérification (Faible)

**Constat.** `rejectUnauthorized: false` (`src/lib/dahua/http.ts:155`), justifié par les certificats auto-signés, mais sans aucun épinglage.

**Correction.** Épinglage « premier contact » : stocker l'empreinte SHA-256 du certificat au premier test réussi (`Nvr.tlsFingerprint`), la vérifier ensuite via `checkServerIdentity`, et signaler tout changement (événement de supervision `tls_changed`, à acquitter par un admin).

### V15 — IP d'audit falsifiable (Faible)

**Constat.** `requestIp` lit la première valeur de `X-Forwarded-For`, que le client peut fournir lui-même (NPM ajoute la sienne derrière).

**Correction.** Lire `X-Real-IP` posé par NPM (ou la **dernière** valeur de `X-Forwarded-For`), et configurer NPM pour écraser l'en-tête entrant (`proxy_set_header X-Forwarded-For $remote_addr`).

### V16 — Durcissement de l'image et du déploiement (Faible)

**Constats et corrections.**
- Pas de `.dockerignore` : `.git`, `node_modules`, `.env`, `brand/` partent dans le contexte de build et `COPY . .` embarque un éventuel `.env` dans la couche `builder`. → Créer `.dockerignore` (`.git`, `node_modules`, `.env*`, `brand`, `docs`, `*.md`).
- `.gitignore` contient `!.env.production` : un vrai fichier de production serait commité. → Supprimer cette exception (l'historique ne contient que des placeholders, vérifié).
- `entrypoint.sh` applique les migrations avec `|| true` : une migration en échec passe inaperçue (dérive de schéma, contrainte manquante). → `psql -v ON_ERROR_STOP=1` et arrêt du conteneur en cas d'erreur, ou `prisma migrate deploy`.
- Conteneur : ajouter `security_opt: [no-new-privileges:true]`, `cap_drop: [ALL]`, `read_only: true` avec `tmpfs: [/tmp]` (le direct vidéo écrit dans `/tmp`), `mem_limit`/`cpus`, `logging.options.max-size`.
- `shadcn` et `prisma` (CLI) sont en `dependencies` : ils tirent `hono`, `@modelcontextprotocol/sdk`, `ts-morph`… dans l'étape de build. → Les passer en `devDependencies`.
- Binaire `dh-fwd` vendoré : conserver `UPSTREAM_COMMIT`, revoir chaque mise à jour amont, générer un SBOM de l'image (`syft`) et le scanner (`grype`/`trivy`) en CI.

### V17 — Validation d'entrées et gestion de clé (Faible)

- `PUT /api/nvrs/[id]` accepte un `status` libre (`src/app/api/nvrs/[id]/route.ts:97`) : un utilisateur peut forcer `online` sur un NVR en panne. → Restreindre à `unknown|online|offline`, ou retirer le champ (la supervision fait foi).
- `type` de compte, `label`, `reason` de révélation, commentaires, `notes` : aucune longueur maximale. → Schémas `zod` avec bornes (255 / 4 000 caractères).
- `ENCRYPTION_KEY` : longueur vérifiée seulement au premier chiffrement. → Valider au démarrage (`instrumentation.ts`) que la clé décodée fait 32 octets.
- Chiffrés sans identifiant de clé : impossible de tourner `ENCRYPTION_KEY` sans tout rechiffrer d'un coup. → Préfixer les chiffrés (`v1:` + id de clé) et supporter deux clés pendant la rotation. L'IV GCM de 16 octets fonctionne mais 12 octets est la taille recommandée (NIST SP 800-38D).

### V18 — Épuisement de ressources par un utilisateur (Faible)

**Constat.** Le diagnostic P2P lance jusqu'à deux processus de 40 s puis des tentatives de tunnel de 25 s, sans plafond par utilisateur ni délai minimal entre deux appels ; idem pour les tests de connexion. Le direct vidéo est bien plafonné (`LIVE_MAX_STREAMS`).

**Correction.** Un diagnostic/test en cours au plus par utilisateur et par NVR, délai minimal de 30 s entre deux diagnostics d'un même NVR, file d'attente globale (par exemple 5 opérations P2P simultanées).

### V19 — Webhooks sortants (Faible, superadmin)

Le contrôle d'URL interdit le lien local et les métadonnées cloud mais autorise le réseau privé par conception. Deux points mineurs : la vérification DNS précède le `fetch` (nouvelle résolution, rebinding théorique) et les 300 premiers caractères d'une réponse d'erreur sont conservés et affichés (oracle de lecture interne). → Résoudre une fois et se connecter à l'adresse validée (agent `undici` avec `lookup` figé) ; ne conserver que le statut HTTP.

### V20 — Divulgation d'informations (Info)

`/api/v1` et `/api/v1/openapi.json` décrivent toute l'API sans clé ; `/_next/image` est servi ; les erreurs renvoient des détails internes (stderr ffmpeg, « la clé ENCRYPTION_KEY a-t-elle changé »). → Messages génériques côté client, détails dans les journaux serveur uniquement.

---

## 5. Points forts relevés

- SSO Entra ID, liste d'accès avec statuts, rôle recalculé à **chaque requête**, sessions coupées immédiatement au bannissement, superadmins d'amorçage non modifiables.
- Clés d'API : 192 bits d'aléa, SHA-256 + `timingSafeEqual`, scopes vérifiés jusqu'au niveau de l'action (`nvr:test` / `nvr:control`), expiration, révocation, audit des tentatives hors scope.
- Mots de passe d'enregistreurs chiffrés AES-256-GCM, jamais renvoyés par les listes, révélation isolée et auditée.
- Aucun shell : `spawn` avec arguments tokenisés, identifiants transmis par l'environnement ou fichier `ffconcat` en 0600, `-protocol_whitelist` ffmpeg, sortie du diagnostic P2P expurgée (`redact`).
- Webhooks sortants signés HMAC-SHA256 (v1 + v2 horodatée), `redirect: manual`, délai d'attente, bail de livraison, pas d'identifiants dans l'URL.
- MCP : contrôle d'`Origin`, scopes, outils filtrés selon la clé, erreurs internes masquées.
- Conteneur non-root, binaire Go statique construit hors réseau, auto-updater amont supprimé.
- Aucun `dangerouslySetInnerHTML`, aucun SQL brut, pas de secret réel dans l'historique Git.

---

## 6. Vérifications à faire sur le site en production (non réalisables depuis l'audit)

```bash
# En-têtes de sécurité et bannière serveur
curl -sI https://sentinel.noxia-groupe.fr/ | grep -iE 'strict-transport|content-security|x-frame|x-content-type|referrer|permissions|x-powered|server:'

# Redirection HTTP → HTTPS
curl -sI http://sentinel.noxia-groupe.fr/ | head -3

# Routes publiques attendues (200 / 405 / 404)
curl -s https://sentinel.noxia-groupe.fr/api/v1 | head -c 300
curl -s -o /dev/null -w '%{http_code}\n' https://sentinel.noxia-groupe.fr/api/mcp
curl -s -o /dev/null -w '%{http_code}\n' -X POST https://sentinel.noxia-groupe.fr/api/webhooks/dahua/x
curl -s -o /dev/null -w '%{http_code}\n' 'https://sentinel.noxia-groupe.fr/_next/image?url=%2Fvercel.svg&w=32&q=75'

# Routes privées : doivent répondre 401 sans cookie
for p in /api/nvrs /api/events /api/audit /api/api-keys /api/access; do
  printf '%s ' "$p"; curl -s -o /dev/null -w '%{http_code}\n' "https://sentinel.noxia-groupe.fr$p"; done

# Ports exposés sur l'hôte (depuis l'extérieur)
nmap -Pn -p 22,80,81,443,3000,5432 sentinel.noxia-groupe.fr

# TLS
nmap --script ssl-enum-ciphers -p 443 sentinel.noxia-groupe.fr
```
Compléter avec https://www.ssllabs.com/ssltest/ (viser A+) et https://securityheaders.com/ (viser A). Vérifier dans NPM : accès à l'interface `:81` restreint, HSTS activé, journaux d'accès ne contenant pas les jetons de webhook.

---

## 7. Plan de remédiation priorisé

| Priorité | Actions | Constats | Effort |
|---|---|---|---|
| **P0 — cette semaine** | Mettre à jour Next.js 16.4.0 et `npm audit fix` ; `images.unoptimized`, `poweredByHeader: false` ; bloquer `/_next/image` dans NPM | V1, V20 | 0,5 j |
| **P0** | Limitation de débit + taille sur le webhook Dahua (application + NPM) ; réponse neutre | V2 | 0,5 j |
| **P0** | Jeton de webhook à 256 bits + route de rotation + migration + reprovisionnement | V4 | 1 j |
| **P1 — ce mois** | Rôles `viewer`/`operator`/`admin`, restriction de `configure-alarm-center`, quota de révélations, MFA Entra | V3 | 2–3 j |
| **P1** | Validation des adresses NVR (listes d'adresses interdites/autorisées) | V5 | 0,5 j |
| **P1** | `session.maxAge` 12 h, purge des jetons OAuth, issuer obligatoire + contrôle `tid`, plafond des entrées `pending` | V6, V7 | 0,5 j |
| **P1** | Lot MCP ≤ 10 et décompte par message ; en-têtes de sécurité ; contrôle d'`Origin` ; `proxy.ts` refus par défaut | V8, V9, V10, V13 | 1 j |
| **P1** | Réseau interne dédié à PostgreSQL ; environnement minimal des processus enfants | V11, V12 | 0,5 j |
| **P2 — trimestre** | Épinglage TLS des NVR, IP d'audit, durcissement conteneur, `.dockerignore`, `.gitignore`, `ON_ERROR_STOP`, `devDependencies`, SBOM/scan en CI, Dependabot | V14, V15, V16 | 1–2 j |
| **P2** | Schémas `zod`, validation de `ENCRYPTION_KEY` au démarrage, versionnage des chiffrés, plafonds d'opérations P2P, durcissement des webhooks sortants | V17, V18, V19 | 1–2 j |

Après P0 : note estimée **68 / 100**. Après P0 + P1 : **82 / 100**. Après P2 : **85–90 / 100**.

---

## 8. Corrections appliquées — palier P0 (14 octobre 2026)

| Constat | Correction livrée |
|---|---|
| V1 | Next.js `16.2.12` → `16.4.1` (et `eslint-config-next`), `npm audit fix` (undici `7.30`, proxy-addr `2.0.8`, fast-uri, nanoid, qs…). Les CLI `prisma` et `shadcn` passent en `devDependencies` : elles ne servent qu'au build (le conteneur final embarque le bundle standalone). `npm audit --omit=dev` passe de 25 à **4 avis**, tous dans la chaîne de la CLI `prisma` (`mysql2`, pilote MySQL jamais chargé ; `deepmerge-ts` via `@prisma/config`), que npm garde dans le périmètre de production parce que `@prisma/client` la déclare en dépendance *peer* optionnelle. Aucun de ces modules n'est présent dans le bundle d'exécution ; le seul « correctif » proposé par npm est une rétrogradation en Prisma 6, à écarter. À réévaluer à la prochaine version de Prisma 7. |
| V1 / V20 | `next.config.ts` : `poweredByHeader: false`, `images.unoptimized: true` (l'optimiseur `/_next/image`, visé par les avis RCE/SSRF, n'était pas utilisé). |
| V2 | `src/app/api/webhooks/dahua/[token]/route.ts` : jeton mal formé rejeté avant toute requête en base ; **20 tentatives/min par IP** sur jeton inconnu (`WEBHOOK_UNKNOWN_TOKEN_RATE_LIMIT`) ; **120 appels/min par enregistreur** (`WEBHOOK_RATE_LIMIT`), réponse 429 avec `Retry-After` ; corps borné à **64 Ko** (`WEBHOOK_MAX_BODY_BYTES`), lecture interrompue dès le dépassement, réponse 413. Limiteur réutilisable dans `src/lib/rate-limit.ts`. |
| V2 / V15 | `requestIp` (`src/lib/actor.ts`) lit désormais `X-Real-IP` (posé par le proxy) puis la **dernière** valeur de `X-Forwarded-For` : la limitation par IP et le journal d'audit ne sont plus contournables par un en-tête forgé. |
| V4 | Nouveau module `src/lib/webhook-token.ts` : jeton de **192 bits** (`crypto.randomBytes(24)`, base64url) généré par l'application à la création d'un enregistreur ; `@default(cuid())` retiré du schéma (aucune migration SQL : la colonne ne change pas). Route `POST /api/nvrs/[id]/webhook-token` : la nouvelle adresse est écrite sur l'enregistreur **avant** d'invalider l'ancienne, le jeton est conservé si l'écriture échoue ; `provision: false` pour une reconfiguration manuelle. Onglet *Webhook* de la fiche : bouton de régénération avec confirmation, et avertissement sur les jetons historiques (format cuid). |

**Écart par rapport au rapport.** Les jetons existants ne sont pas régénérés automatiquement au déploiement : chaque rotation réécrit la configuration de l'enregistreur, ce qui suppose qu'il soit joignable à cet instant (les NVR en P2P ne le sont pas toujours). Une régénération en masse aurait coupé la remontée d'alarmes des équipements injoignables. L'interface signale chaque jeton ancien, et la rotation se fait enregistreur par enregistreur, avec réécriture automatique. La réponse 404 sur jeton inconnu est conservée (diagnostic d'une URL mal copiée) : la limitation par IP suffit à rendre la force brute impraticable.

**Reste à faire côté infrastructure (hors dépôt)** : dans Nginx Proxy Manager, `limit_req` sur `/api/webhooks/`, `client_max_body_size 64k` sur cette location, `location /_next/image { return 404; }`, HSTS. Les extraits sont dans le README, section *Déploiement*.

**Note estimée après P0 : 68 / 100.** Les paliers P1 (rôles, validation des adresses NVR, sessions, en-têtes, réseau interne) et P2 restent à traiter.
