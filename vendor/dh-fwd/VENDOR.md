# Vendored: dh-fwd

Tunnel P2P vers les enregistreurs Dahua joignables uniquement par leur numéro
de série (sans IP routable), via le cloud Dahua. C'est l'utilitaire lancé par
`src/lib/dahua/p2p.ts` : à partir d'un numéro de série, il ouvre un port TCP
local qui aboutit sur l'équipement.

## Origine

- Projet : `undervolter/dh-fwd`
- URL : https://github.com/undervolter/dh-fwd
- Commit vendu : `df2edca4e95978ffca6a8173f91e64e327a1fbb6` (2026-09-21, `v2.3.1`)
- Licence : MIT (voir `LICENSE`) — compatible avec l'intégration ici.

## Pourquoi celui-ci (et pas `vendor/dh-p2p`)

`vendor/dh-p2p` (Rust) est une **preuve de concept** du tunnel P2P. Elle
fonctionne sur les firmwares anciens mais échoue sur les enregistreurs
**postérieurs à 2024.07**, qui exigent une authentification du canal et un
dialecte de requête propre à l'application (DMSS / SmartPSS). Sur le
`DHI-NVR5208-8P-EI` du parc, `dh-p2p` obtenait un `403 DevPwd_InvalidNonce` /
`DevPwd_InvalidDigest` au moment du *relay-channel*, alors que la cryptographie
du corps était pourtant correcte.

`dh-fwd` est conçu spécifiquement pour ces équipements post-2024 :

- il gère l'authentification de type 1 (RandSalt lu automatiquement dans le
  blob Info de l'équipement) ;
- il propose deux **profils applicatifs** (`--app smartpss` / `--app dmss`)
  qui reproduisent le dialecte exact du client officiel — serveur cloud,
  identifiants WSSE, ordre des en-têtes et valeur du `CSeq`. Le profil `dmss`
  documente précisément la correction de notre panne (`profile.go`) : l'ordre
  d'en-têtes hérité tirait un `403 DevPwd_InvalidDigest`, là où l'ordre DMSS
  obtient `200 Server Nat Info!` ; le profil `dmss` évite aussi l'étape de
  *relay-channel* qui provoquait chez nous le « Relay agent timeout ».

SENTINEL essaie d'abord le profil `DAHUA_P2P_PROFILE` (défaut `smartpss`, le
cloud où est enregistré le `DHI-NVR5208-8P-EI` du parc), puis bascule sur
l'autre si le cloud répond 404 — signe que l'équipement est enregistré de
l'autre côté (voir `src/lib/dahua/p2p.ts`).

## Modifications locales (patches SENTINEL)

Toutes les modifications sont signalées par un commentaire
`SENTINEL vendor patch` dans le code.

1. **`updater.go` — auto-updater neutralisé.**
   En amont, dh-fwd interroge `api.github.com` à chaque démarrage pour proposer
   de télécharger et de **réécrire son propre binaire**. Dans SENTINEL le
   binaire est construit une fois dans l'image Docker et ne doit jamais
   contacter l'extérieur ni se remplacer à l'exécution. `checkUpdate()` est
   réduit à un no-op qui renvoie toujours `true`. Tout le code réseau et de
   self-update est retiré du fichier.

2. **`main.go` — configuration sans TTY, identifiants par l'environnement.**
   Les identifiants de l'équipement ne doivent JAMAIS transiter par la ligne
   de commande (argv est lisible via `/proc` et la liste des processus).
   Quand ils ne sont pas fournis en argument, ils sont lus dans
   l'environnement :
   - `DAHUA_P2P_USERNAME` / `DAHUA_P2P_PASSWORD` → identifiants (active le
     type 1) ;
   - `DAHUA_P2P_PROFILE` → profil applicatif (`--app`) ;
   - `DAHUA_P2P_RELAY` (`1`/`true`/`yes`) → force le chemin relais (`-R`).
   La présence d'identifiants dans l'environnement marque un contexte non
   interactif : la confirmation `y/n` du chemin relais est alors sautée
   automatiquement (aucun opérateur pour y répondre).

3. **`tunnel.go` — lecture de `/info/device` au-delà des réponses
   intercalées.**
   En amont, un seul datagramme est lu après `/info/device`. Si le serveur P2P
   de l'équipement livre d'abord une réponse tardive à `/probe/device` ou une
   réponse provisoire, ce paquet ne porte pas de blob `Info` et le profil
   `dmss` échoue par `autosalt: randsalt: Info field absent` alors que le blob
   arrive juste après (symptôme observé sur le `DHI-NVR5208-8P-EI`). On lit
   désormais pendant une courte fenêtre (1,5 s après la première réponse,
   6 paquets au plus) et on retient la première réponse qui porte `Info`.
   L'échec reste **fermé** si aucun blob n'arrive (pas de signature avec un sel
   vide), mais le message d'erreur décrit la réponse reçue — ligne de statut
   et **noms** de champs, jamais leurs valeurs — pour diagnostiquer.
   Tests : `sentinel_patch_test.go`.

## Reconstruire / mettre à jour

Le binaire est compilé dans l'image (étape `dh-fwd-builder` du `Dockerfile`)
avec les dépendances figées sous `vendor/` (`go build -mod=vendor`). Pour
mettre à jour depuis l'amont : re-cloner le dépôt au commit voulu, ré-appliquer
les patches ci-dessus, relancer `go mod vendor`, puis
`go build -mod=vendor .` et `go test -mod=vendor ./...`.
