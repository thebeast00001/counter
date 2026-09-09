import { gcm } from '@noble/ciphers/aes.js';
import { bytesToHex, bytesToUtf8, hexToBytes, utf8ToBytes } from '@noble/ciphers/utils.js';
import * as Crypto from 'expo-crypto';

/**
 * Encryption at rest for everything the business records.
 *
 * The app's privacy claim has always rested on "it never leaves your phone",
 * which is true and was never the whole story: the records were sitting in
 * AsyncStorage as plain JSON, which on Android is a file in the app's sandbox.
 * That is fine against another app and useless against a rooted handset, an ADB
 * backup, or anyone who picks up an unlocked phone and knows where to look. For
 * a file containing every customer's name, phone number and debts, that gap is
 * the difference between a real promise and a marketing line.
 *
 * So: AES-256-GCM, with the key generated on the device and held in the Android
 * Keystore (via SecureStore) rather than anywhere the ciphertext lives.
 *
 * Three deliberate choices worth stating:
 *
 *  - The cipher is `@noble/ciphers`, an audited implementation. Hand-rolling a
 *    block cipher is the single most reliable way to build something that looks
 *    encrypted and is not.
 *  - GCM rather than CBC, so tampering is *detected* rather than silently
 *    decrypting to rubbish. A corrupted ledger that reads as valid is worse than
 *    one that refuses to open.
 *  - A fresh 96-bit nonce per write. Reusing a nonce with GCM does not merely
 *    weaken it, it leaks the key stream outright.
 */

type SecureStoreModule = typeof import('expo-secure-store');

/**
 * Resolved through require() in a try/catch for the same reason the rest of the
 * security layer is: a missing native module must degrade, never crash before
 * the first frame.
 */
const SecureStore: SecureStoreModule | null = (() => {
  try {
    return require('expo-secure-store');
  } catch {
    return null;
  }
})();

const KEY_NAME = 'os.vault.key.v1';
/** Marks a payload as encrypted, so plaintext written by an older build is still readable. */
const PREFIX = 'v1:';

let cached: Uint8Array | null = null;

/**
 * The in-flight key lookup, so concurrent callers share one.
 *
 * Without this there is a first-launch race that loses data permanently. `seal`
 * and `open` are both async and both call `getKey`; on a cold start several
 * writes and a read can be in flight at once, all seeing `cached === null`, all
 * finding nothing in the Keystore, and all generating a *different* 32-byte key.
 * Each seals its payload with its own, the last `setItemAsync` wins, and every
 * record sealed with one of the losers can never be opened again — GCM
 * authentication fails and `open` correctly returns null for data that is, at
 * that point, genuinely gone.
 *
 * Sharing the promise makes key creation happen exactly once.
 */
let pending: Promise<Uint8Array | null> | null = null;

/**
 * Hex rather than base64.
 *
 * `btoa`/`atob` are not reliably present on Hermes, and reaching for a polyfill
 * — or worse, hand-rolling base64 — to save a third of the bytes is a poor
 * trade against a helper the cipher library already ships and tests.
 */
const encode = bytesToHex;
const decode = hexToBytes;

/**
 * The device's key, created once and never leaving the Keystore.
 *
 * Returns null when SecureStore is unavailable — the caller then stores
 * plaintext rather than failing, because losing a business's records to a
 * missing module would be a far worse outcome than storing them unencrypted on
 * a device that cannot encrypt anything anyway.
 */
export function getKey(): Promise<Uint8Array | null> {
  if (cached) return Promise.resolve(cached);
  if (!SecureStore) return Promise.resolve(null);
  if (pending) return pending;

  pending = (async () => {
    try {
      const existing = await SecureStore.getItemAsync(KEY_NAME);
      if (existing) {
        cached = decode(existing);
        return cached;
      }

      const fresh = Crypto.getRandomBytes(32);
      await SecureStore.setItemAsync(KEY_NAME, encode(fresh), {
        // Available after the first unlock rather than while locked, so a
        // background write cannot fail silently and drop a record.
        keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK,
      });
      cached = fresh;
      return cached;
    } catch {
      return null;
    } finally {
      // Cleared either way: a failed lookup must be retryable rather than
      // caching "no key" for the life of the process.
      pending = null;
    }
  })();

  return pending;
}

/** Encrypts a JSON string. Falls back to plaintext when no key is obtainable. */
export async function seal(plain: string): Promise<string> {
  const key = await getKey();
  if (!key) return plain;

  try {
    const nonce = Crypto.getRandomBytes(12);
    const sealed = gcm(key, nonce).encrypt(utf8ToBytes(plain));
    return `${PREFIX}${encode(nonce)}.${encode(sealed)}`;
  } catch {
    // A cipher failure must not lose the write. Plaintext is a worse outcome
    // than encrypted, and a far better one than nothing.
    return plain;
  }
}

/**
 * Decrypts a payload written by `seal`.
 *
 * Anything without the prefix is returned untouched — that is how records
 * written before this existed keep opening, and they are re-sealed on the next
 * write without the owner doing anything.
 *
 * Returns null when a *sealed* payload fails to open, which means the key is
 * gone or the file was tampered with. Callers treat that as "no data" rather
 * than crashing, and never as "empty business".
 */
export async function open(payload: string): Promise<string | null> {
  if (!payload.startsWith(PREFIX)) return payload;

  const key = await getKey();
  if (!key) return null;

  try {
    const [noncePart, bodyPart] = payload.slice(PREFIX.length).split('.');
    if (!noncePart || !bodyPart) return null;
    const opened = gcm(key, decode(noncePart)).decrypt(decode(bodyPart));
    return bytesToUtf8(opened);
  } catch {
    // GCM authentication failed: wrong key, or the bytes were altered.
    return null;
  }
}

/** True once a device key exists, so settings can report the real state. */
export async function isSealed(): Promise<boolean> {
  return (await getKey()) !== null;
}
