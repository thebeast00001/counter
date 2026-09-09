type SecureStoreModule = typeof import('expo-secure-store');

/** Same defensive require as the vault: a missing native module degrades, never crashes. */
const SecureStore: SecureStoreModule | null = (() => {
  try {
    return require('expo-secure-store');
  } catch {
    return null;
  }
})();

const KEY_NAME = 'os.ai.key.v1';

/**
 * The owner's own API key, in the Keystore.
 *
 * Bring-your-own-key rather than a key shipped inside the app, for two reasons
 * that both matter more than the convenience cost.
 *
 * A key compiled into a React Native bundle is not secret. The bundle is a
 * JavaScript file on the handset; anyone who wants the key has it in a minute,
 * and the bill is the developer's. Every app that has tried this has ended up
 * with a stranger's crypto miner on their account.
 *
 * And it keeps the trust story clean. The owner's data goes to the owner's
 * account under the owner's terms. Nothing routes through a server belonging to
 * this app, so there is no server that could keep a copy — which is a much
 * stronger promise than a privacy policy saying we choose not to.
 */

let cached: string | null = null;
let loaded = false;

/**
 * The in-flight read, so concurrent callers share one.
 *
 * The obvious version sets `loaded = true` and then awaits the Keystore — which
 * means a second caller arriving during that await sees `loaded` already true
 * and returns `cached`, still null. The key is present and the app reports it
 * missing. Asking a question the moment the screen opens is exactly the timing
 * that triggers it, because the settings screen reads the key too.
 */
let pending: Promise<string | null> | null = null;

export function getKey(): Promise<string | null> {
  if (loaded) return Promise.resolve(cached);
  if (!SecureStore) return Promise.resolve(null);
  if (pending) return pending;

  pending = (async () => {
    try {
      cached = await SecureStore.getItemAsync(KEY_NAME);
    } catch {
      cached = null;
    }
    loaded = true;
    pending = null;
    return cached;
  })();

  return pending;
}

export async function setKey(key: string | null): Promise<boolean> {
  const trimmed = key?.trim() ?? '';
  cached = trimmed.length > 0 ? trimmed : null;
  loaded = true;
  if (!SecureStore) return false;
  try {
    if (cached) {
      await SecureStore.setItemAsync(KEY_NAME, cached, {
        keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK,
      });
    } else {
      await SecureStore.deleteItemAsync(KEY_NAME);
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Cheap shape check, so an obviously wrong paste is caught before a round trip.
 *
 * Deliberately loose about the prefix. Sarvam's keys begin `sk_`, but this file
 * has already outlived one provider and requiring a particular prefix is how a
 * valid key gets refused by the app the day the next one changes format.
 */
export function looksLikeKey(key: string): boolean {
  const k = key.trim();
  return k.length >= 20 && !/\s/.test(k);
}

/* ----------------------------------------------------------------- model -- */

/**
 * The chosen model, if the owner picked one.
 *
 * Discovery is the right default — a model added or withdrawn should not need a
 * release — but a poor *only* option, because the ordering it produces is a
 * judgement and the owner may disagree with it. Naming one pins it; clearing it
 * goes back to discovery.
 */
let modelCached: string | null = null;
let modelLoaded = false;

/**
 * Storage is reached through a lazy require rather than a top-level import.
 *
 * `@/state/persist` pulls in AsyncStorage, which pulls in native modules that do
 * not exist outside the app — so a static import here would make every module
 * that touches `provider.ts` unloadable by the verification scripts, and the
 * error-classification tests would have to stub the whole storage layer to
 * check a status code. Deferring it keeps `src/ai` testable in plain Node.
 */
type PersistModule = typeof import('@/state/persist');

function persist(): PersistModule | null {
  try {
    return require('@/state/persist');
  } catch {
    return null;
  }
}

export async function getModel(): Promise<string | null> {
  if (modelLoaded) return modelCached;
  modelLoaded = true;
  const store = persist();
  if (!store) return null;
  try {
    modelCached = await store.loadJSON<string | null>(store.KEYS.aiModel, null);
  } catch {
    modelCached = null;
  }
  return modelCached;
}

export function setModel(id: string | null): void {
  const trimmed = id?.trim() ?? '';
  modelCached = trimmed.length > 0 ? trimmed : null;
  modelLoaded = true;
  const store = persist();
  store?.saveJSON(store.KEYS.aiModel, modelCached);
}

/**
 * A model id, in either shape a provider might use.
 *
 * Sarvam's are bare — `sarvam-105b-conversations` — where a router's carry a
 * `vendor/model` prefix. This used to require the prefix, which rejected every
 * id the app now actually uses; it is loose on purpose, because its only job is
 * catching the commonest paste mistake, which is the display name with spaces
 * in it rather than the id.
 */
export function looksLikeModelId(id: string): boolean {
  return /^[\w.-]+(\/[\w.:-]+)?$/.test(id.trim());
}
