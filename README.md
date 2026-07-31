# SENTINEL

Centre de contrôle des enregistreurs NVR Dahua : inventaire des enregistreurs,
stockage chiffré des identifiants (AES-256-GCM) et réception des événements
Alarm Center via webhook.

Stack : Next.js 16 (App Router) · Prisma 7 / PostgreSQL · NextAuth v5 ·
Tailwind 4 · Docker.

## Authentification

L'accès se fait exclusivement par **SSO Microsoft Entra ID**. Il n'y a pas de
mot de passe local.

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
exposé sur `session.user.role` et visible dans *Paramètres*.

## Développement

```bash
npm install
npx prisma generate       # génère le client dans src/generated/prisma
npm run dev
```

Le client Prisma est généré, pas versionné : `npx prisma generate` est
obligatoire après un `npm install` propre, sinon le typecheck échoue.

## Déploiement

```bash
docker compose up -d --build
```

`entrypoint.sh` attend PostgreSQL puis applique les fichiers
`prisma/migrations/*/migration.sql` avec `psql` avant de démarrer le serveur.
Le service applicatif n'expose aucun port : il est publié par Nginx Proxy
Manager via le réseau externe `nginx-proxy`.

## Webhook Alarm Center

Chaque NVR dispose d'un token unique. Configurer l'Alarm Center Dahua pour
poster sur :

```
https://sentinel.noxia-groupe.fr/api/webhooks/dahua/<webhookToken>
```

Cette route est publique par conception (le token fait office
d'authentification) ; toutes les autres routes exigent une session.
