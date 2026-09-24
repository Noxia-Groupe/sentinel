# dh-p2p (vendoré)

Utilitaire de tunnel TCP au-dessus du protocole P2P Dahua. SENTINEL s'en sert
pour joindre les enregistreurs déclarés en P2P (sans IP routable) à partir de
leur seul numéro de série, comme le font DMSS / SmartPSS.

- **Origine** : https://github.com/khoanguyen-3fc/dh-p2p
- **Commit** : voir `UPSTREAM_COMMIT.txt`
- **Licence** : MIT (voir `LICENSE`)

## Pourquoi vendoré

Le transport PTCP de Dahua n'est pas documenté et aucun paquet n'est distribué :
plutôt que dépendre d'un dépôt tiers au moment du build, on fige les sources ici
et on compile le binaire dans l'image (stage `p2p-builder` du `Dockerfile`).
`Cargo.lock` est conservé pour un build reproductible.

## Comment SENTINEL l'appelle

`src/lib/dahua/p2p.ts` lance ce binaire à la demande, avec la ligne de commande
`DAHUA_P2P_HELPER` (défaut : `/usr/local/bin/dh-p2p --port {host}:{port}:{devicePort} {serial}`),
attend le marqueur `Ready to connect` sur sa sortie, puis dirige les requêtes
CGI vers le port local ouvert. Le tunnel est mutualisé et refermé après
inactivité.

## Patch local : authentification du canal P2P

L'amont ne gère pas l'authentification exigée par certains firmwares à la
création du canal P2P (réponse `403 DevPwd_InvalidSalt`). On l'ajoute ici, en
portant la recette de l'implémentation Python de référence (`helpers.py`/`main.py`
du même dépôt, sous le même MIT) :

- `src/auth.rs` — **ajout** : dérivation de clé (MD5), chiffrement d'adresse
  (AES-256-OFB + PBKDF2-HMAC-SHA256), signature de corps (HMAC-SHA256),
  déchiffrement du bloc `<Info>` pour lire le sel. La cryptographie est validée
  par des vecteurs générés depuis l'implémentation de référence (`cargo test`).
- `src/dh.rs` — **modif** : `p2p_handshake` prend des identifiants optionnels ;
  requête `/info/device` pour le sel ; corps signés + `IpEncrptV2` sur
  `p2p-channel` et `relay-channel` ; déchiffrement de l'adresse locale du device.
- `src/main.rs` — **modif** : options `--username`/`--password` avec repli sur
  `DAHUA_P2P_USERNAME`/`DAHUA_P2P_PASSWORD` (jamais en arguments côté SENTINEL).
- `Cargo.toml` — **ajout** des crates crypto (`md-5`, `sha2`, `hmac`, `pbkdf2`,
  `aes`, `serde_json`), toutes pures Rust (compilent en musl).

Sans identifiants, le comportement d'origine (canal non authentifié) est conservé.

## Mise à jour depuis l'amont

Une remontée du patch d'authentification en amont serait idéale. En attendant,
lors d'une resynchronisation, réappliquer le patch local ci-dessus par-dessus les
sources amont (les fichiers marqués « modif » et l'ajout `src/auth.rs`) :

```sh
git clone https://github.com/khoanguyen-3fc/dh-p2p /tmp/dh-p2p
git -C /tmp/dh-p2p rev-parse HEAD > vendor/dh-p2p/UPSTREAM_COMMIT.txt
# puis reporter à la main auth.rs + les modifs dh.rs / main.rs / Cargo.toml
```
