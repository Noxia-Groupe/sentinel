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

## Mise à jour

```sh
git clone https://github.com/khoanguyen-3fc/dh-p2p /tmp/dh-p2p
cp -r /tmp/dh-p2p/src /tmp/dh-p2p/Cargo.toml /tmp/dh-p2p/Cargo.lock \
      /tmp/dh-p2p/LICENSE /tmp/dh-p2p/README.md vendor/dh-p2p/
git -C /tmp/dh-p2p rev-parse HEAD > vendor/dh-p2p/UPSTREAM_COMMIT.txt
```

Aucune modification locale n'est apportée aux sources : tout adaptateur de
contrat vit côté SENTINEL (`p2p.ts`), pas dans ce dossier.
