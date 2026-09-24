//! Authentification du canal P2P (patch local Sentinel — voir VENDOR.md).
//!
//! Certains firmwares Dahua exigent une authentification dès la création du
//! canal P2P et répondent sinon `403 DevPwd_InvalidSalt`. L'utilitaire amont ne
//! la gère pas. On porte ici la recette de l'implémentation Python de référence
//! (helpers.py, MIT) : lecture du « sel » (`randsalt`) exposé par l'équipement,
//! dérivation d'une clé à partir des identifiants, chiffrement de l'adresse
//! locale et signature HMAC des corps de requête.
//!
//! La cryptographie est validée par des vecteurs générés depuis l'implémentation
//! de référence (voir les tests en bas de fichier).

use base64::Engine;
use hmac::{Hmac, Mac};
use md5::{Digest, Md5};
use sha2::Sha256;

use aes::cipher::generic_array::GenericArray;
use aes::cipher::{BlockEncrypt, KeyInit};
use aes::Aes256;

/// IV fixe pour le chiffrement de l'adresse locale (partagé par tous les devices).
const ENC_IV: &[u8; 16] = b"2z52*lk9o6HRyJrf";
/// Clé/IV fixes pour déchiffrer le bloc `<Info>` (salt + ports), identiques sur
/// tout le parc — ce ne sont pas des secrets, mais l'obfuscation du firmware.
const INFO_KEY: &[u8; 32] = b"kRjmsUB&ezmdGLL67H#$ojw@XflcaIaf";
const INFO_IV: &[u8; 16] = b"MydvJw*Iw1w&i^kk";

fn b64e(data: &[u8]) -> String {
    base64::engine::general_purpose::STANDARD.encode(data)
}
fn b64d(text: &str) -> Vec<u8> {
    base64::engine::general_purpose::STANDARD
        .decode(text.trim())
        .unwrap_or_default()
}

/// AES-256 en mode OFB. OFB est un chiffrement par flux symétrique : la même
/// fonction chiffre et déchiffre. Implémenté à la main sur le chiffrement par
/// bloc pour ne pas dépendre d'une crate de mode archivée.
pub fn aes256_ofb(key: &[u8], iv: &[u8; 16], data: &[u8]) -> Vec<u8> {
    let cipher = Aes256::new(GenericArray::from_slice(key));
    let mut feedback = *iv;
    let mut out = Vec::with_capacity(data.len());
    let mut offset = 0;
    while offset < data.len() {
        let mut block = *GenericArray::from_slice(&feedback);
        cipher.encrypt_block(&mut block);
        feedback.copy_from_slice(block.as_slice());
        for (j, k) in block.iter().enumerate() {
            if offset + j < data.len() {
                out.push(data[offset + j] ^ k);
            }
        }
        offset += 16;
    }
    out
}

/// Clé dérivée des identifiants : `MD5("user:Login to {salt}:pass")`, en
/// hexadécimal majuscule (comme le fait le client officiel).
pub fn device_key(username: &str, password: &str, randsalt: &str) -> Vec<u8> {
    let mut hasher = Md5::new();
    hasher.update(format!("{}:Login to {}:{}", username, randsalt, password).as_bytes());
    hasher
        .finalize()
        .iter()
        .map(|b| format!("{:02X}", b))
        .collect::<String>()
        .into_bytes()
}

/// Clé de session : PBKDF2-HMAC-SHA256(clé, nonce, 20000, 32).
fn derive(key: &[u8], nonce: u64) -> [u8; 32] {
    let mut dk = [0u8; 32];
    pbkdf2::pbkdf2_hmac::<Sha256>(key, nonce.to_string().as_bytes(), 20000, &mut dk);
    dk
}

/// Chiffre l'adresse locale annoncée à l'équipement (champ `IpEncrptV2`).
pub fn enc_local_addr(key: &[u8], nonce: u64, data: &str) -> String {
    b64e(&aes256_ofb(&derive(key, nonce), ENC_IV, data.as_bytes()))
}

/// Déchiffre l'adresse locale renvoyée par l'équipement, avec le nonce du device.
pub fn dec_local_addr(key: &[u8], nonce: u64, payload: &str) -> String {
    String::from_utf8_lossy(&aes256_ofb(&derive(key, nonce), ENC_IV, &b64d(payload))).into_owned()
}

/// Corps d'authentification signé (HMAC-SHA256 sur `{nonce}{curdate}{payload}`).
/// `randsalt` vide ⇒ l'élément `<RandSalt>` est omis (firmwares sans sel).
pub fn device_auth(
    username: &str,
    key: &[u8],
    nonce: u64,
    curdate: i64,
    randsalt: &str,
    payload: &str,
) -> String {
    // `new_from_slice` existe sur KeyInit (importé pour AES) et sur Mac : on qualifie.
    let mut mac = <Hmac<Sha256> as Mac>::new_from_slice(key).expect("clé HMAC de longueur valide");
    mac.update(format!("{}{}{}", nonce, curdate, payload).as_bytes());
    let auth = b64e(&mac.finalize().into_bytes());
    let salt = if randsalt.is_empty() {
        String::new()
    } else {
        format!("<RandSalt>{}</RandSalt>", randsalt)
    };
    format!(
        "<CreateDate>{}</CreateDate><DevAuth>{}</DevAuth><Nonce>{}</Nonce>{}<UserName>{}</UserName>",
        curdate, auth, nonce, salt, username
    )
}

/// Déchiffre le bloc `<Info>` de `/info/device/{SN}` (salt + ports du device).
pub fn decrypt_info(payload: &str) -> Vec<u8> {
    aes256_ofb(INFO_KEY, INFO_IV, &b64d(payload))
}

/// Extrait `randsalt` du bloc `<Info>` déchiffré (JSON). Chaîne vide si absent.
pub fn randsalt_from_info(info_b64: &str) -> String {
    if info_b64.trim().is_empty() {
        return String::new();
    }
    let clear = decrypt_info(info_b64);
    serde_json::from_slice::<serde_json::Value>(&clear)
        .ok()
        .and_then(|v| v.get("randsalt").and_then(|s| s.as_str()).map(str::to_owned))
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    // Vecteurs produits par l'implémentation Python de référence (helpers.py).
    const USER: &str = "admin";
    const PASS: &str = "S3cret!Pass";
    const SALT: &str = "5daf91fc5cfc1be8e081cfb08f792726";
    const NONCE: u64 = 1234567890;
    const CURDATE: i64 = 1700000000;

    #[test]
    fn key_matches_reference() {
        assert_eq!(
            String::from_utf8(device_key(USER, PASS, SALT)).unwrap(),
            "63E5985BC9CE042D495763543F486007"
        );
    }

    #[test]
    fn enc_and_roundtrip_match_reference() {
        let enc = enc_local_addr(&device_key(USER, PASS, SALT), NONCE, "127.0.0.1:49876");
        assert_eq!(enc, "TTH+Ig+Eq9r2/xlGm7C8");
        let dec = dec_local_addr(&device_key(USER, PASS, SALT), NONCE, &enc);
        assert_eq!(dec, "127.0.0.1:49876");
    }

    #[test]
    fn auth_matches_reference() {
        let key = device_key(USER, PASS, SALT);
        let enc = enc_local_addr(&key, NONCE, "127.0.0.1:49876");
        assert_eq!(
            device_auth(USER, &key, NONCE, CURDATE, SALT, &enc),
            "<CreateDate>1700000000</CreateDate><DevAuth>MGkWKdUzXZNhlBSGoFZA1gHTivXeAYGlDTPyG90W318=</DevAuth><Nonce>1234567890</Nonce><RandSalt>5daf91fc5cfc1be8e081cfb08f792726</RandSalt><UserName>admin</UserName>"
        );
        assert_eq!(
            device_auth(USER, &key, NONCE, CURDATE, SALT, ""),
            "<CreateDate>1700000000</CreateDate><DevAuth>lvL05ojMZa665BTBoVjjqcy3uudMaGMkY5F3OQZsXIY=</DevAuth><Nonce>1234567890</Nonce><RandSalt>5daf91fc5cfc1be8e081cfb08f792726</RandSalt><UserName>admin</UserName>"
        );
        // sans sel : élément <RandSalt> absent, DevAuth inchangé
        assert_eq!(
            device_auth(USER, &key, NONCE, CURDATE, "", ""),
            "<CreateDate>1700000000</CreateDate><DevAuth>lvL05ojMZa665BTBoVjjqcy3uudMaGMkY5F3OQZsXIY=</DevAuth><Nonce>1234567890</Nonce><UserName>admin</UserName>"
        );
    }

    #[test]
    fn info_decrypts_to_salt() {
        let info_b64 = "sLwAgMEOWisMO6lxkxJEA7WGvF3oCc7q4LVNd/n0deRN+MYlMpcDc17S3OKadq4HYX2wM1Z9m/M6jAlU0RgHysF8DlHZx9GWjlMG5FiX8qV3PhAAtJJEpvSb382H8doYaLk0wW6KS25Ysq1KrVykCaYnDAcHwV9u29M=";
        assert_eq!(randsalt_from_info(info_b64), SALT);
    }
}
