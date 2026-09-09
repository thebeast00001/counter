import AsyncStorage from '@react-native-async-storage/async-storage';

import { open, seal } from '@/state/vault';

/**
 * Thin JSON wrapper over AsyncStorage.
 *
 * Every read is total: corrupt or absent data resolves to the fallback rather
 * than throwing. A storage failure should never be able to prevent the app from
 * starting — the worst acceptable outcome is losing history, not a black screen.
 */

/**
 * Keys whose contents are encrypted at rest.
 *
 * Only the ones that carry somebody's personal information. Encrypting the theme
 * preference would cost a Keystore round trip on every launch to protect the
 * fact that a user likes dark mode.
 *
 * Derived from `KEYS` rather than repeating the strings. It used to hold two
 * literals, which meant renaming a key in `KEYS` would have moved the records to
 * a new key that was not on this list and stored every customer's name and phone
 * number in plaintext — with nothing failing, no error, and no way to notice
 * short of reading the file off the device.
 */
function sensitiveKeys(): Set<string> {
  return new Set<string>([KEYS.businessProfile, KEYS.businessData]);
}

let sensitive: Set<string> | null = null;

function isSensitive(key: string): boolean {
  // Lazily, because `KEYS` is declared below this and is read at call time.
  sensitive ??= sensitiveKeys();
  return sensitive.has(key);
}

export async function loadJSON<T>(key: string, fallback: T): Promise<T> {
  try {
    const raw = await AsyncStorage.getItem(key);
    if (raw === null) return fallback;

    const text = isSensitive(key) ? await open(raw) : raw;
    // Null means a sealed payload would not open — wrong key or altered bytes.
    // Returning the fallback is right; pretending it parsed would be worse.
    if (text === null) return fallback;

    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
}

/** In-flight writes, one chain per key, so they cannot land out of order. */
const chains = new Map<string, Promise<void>>();

/** The newest value per key, and the timer that will write it. */
const pending = new Map<string, unknown>();
const timers = new Map<string, ReturnType<typeof setTimeout>>();

/**
 * How long a write waits for another to replace it.
 *
 * Long enough to collapse a burst, short enough that nothing is at risk: the
 * app is killed by the OS, not by the user, and `flushNow` runs on background.
 */
const COALESCE_MS = 400;

/**
 * Writes are coalesced, because each one costs the whole ledger.
 *
 * This stores a business as a single sealed JSON value, so every save
 * serialises the entire record set, encrypts it, and writes it back — the cost
 * is the size of the business, not the size of the change. Ticking fourteen
 * students off a register calls this fourteen times, and thirteen of those
 * results are thrown away by the fourteenth.
 *
 * Measured at roughly 155 bytes per engagement, a two-year-old gym is a 5 MB
 * value. Fourteen serialise-encrypt-write cycles over 5 MB is a visible freeze
 * on the one screen that has to keep up with a room of people.
 *
 * So a save records the value and arms a timer; a save arriving before it fires
 * replaces the value and re-arms. Only the last one is ever written, which is
 * the only one that was ever true.
 *
 * This is a mitigation and not the fix. The fix is to stop keeping the whole
 * ledger in one value — see `docs/storage.md`.
 */
export function saveJSON(key: string, value: unknown): void {
  pending.set(key, value);

  const existing = timers.get(key);
  if (existing) clearTimeout(existing);
  timers.set(
    key,
    setTimeout(() => {
      timers.delete(key);
      commit(key);
    }, COALESCE_MS),
  );
}

/** Serialises and writes whatever is pending for one key. */
function commit(key: string): void {
  if (!pending.has(key)) return;
  const value = pending.get(key);
  pending.delete(key);

  const write = async () => {
    try {
      const json = JSON.stringify(value);
      const payload = isSensitive(key) ? await seal(json) : json;
      await AsyncStorage.setItem(key, payload);
    } catch {
      // Non-fatal by design.
    }
  };

  // Still chained per key: two writes finishing out of order would persist the
  // older one, and coalescing makes that more likely rather than less.
  const previous = chains.get(key) ?? Promise.resolve();
  const next = previous.then(write, write);
  chains.set(key, next);
}

/**
 * Writes everything pending immediately, and resolves when it is on disk.
 *
 * Called when the app leaves the foreground. Without it, the coalescing window
 * above is a window in which the last few hundred milliseconds of work can be
 * lost to a process kill — which is precisely when Android kills apps.
 */
export async function flushNow(): Promise<void> {
  for (const [key, timer] of timers) {
    clearTimeout(timer);
    timers.delete(key);
    commit(key);
  }
  await Promise.all([...chains.values()]);
}

/*
  Flush when the app leaves the foreground.

  Registered at module load rather than in a component, because the guarantee
  has to hold for the whole process — a screen that owns it is a screen that can
  unmount, and the write window would then silently reopen.

  `react-native` is reached through a guarded require for the same reason as
  everywhere else here: this module is imported by code that runs outside the
  app, and a top-level import would break it there.
*/
(() => {
  try {
    const { AppState } = require('react-native') as typeof import('react-native');
    AppState.addEventListener('change', (next: string) => {
      if (next !== 'active') void flushNow();
    });
  } catch {
    // Outside the app there is nothing to background.
  }
})();

/*
  Keys nothing reads any more, cleared on the next launch that notices them.

  `cadence.accent` held a per-business accent chosen by a picker that no longer
  exists; `cadence.autoAccent` its companion switch. `theme.tsx` stopped reading
  both when the accent became a constant, which fixed the behaviour and left the
  values sitting on every device that had ever set one — dead data that looks
  live to anyone reading the storage later.
*/
const RETIRED = ['cadence.accent', 'cadence.autoAccent'];

export function sweepRetiredKeys(): void {
  AsyncStorage.multiRemove(RETIRED).catch(() => {});
}

export function removeKeys(keys: string[]): void {
  AsyncStorage.multiRemove(keys).catch(() => {});
}

export const KEYS = {
  active: 'cadence.active',
  daily: 'cadence.daily',
  goal: 'cadence.goal',
  log: 'cadence.log',
  categories: 'cadence.categories',
  tasks: 'cadence.tasks',
  widgets: 'cadence.widgets',
  onboarded: 'cadence.onboarded',
  profile: 'cadence.profile',
  scheme: 'cadence.scheme',
  accent: 'cadence.accent',
  lock: 'cadence.lock',
  onboardingStep: 'cadence.onboarding.step',
  lastMilestone: 'cadence.milestone',
  locale: 'cadence.locale',

  colourSafe: 'cadence.colourSafe',
  autoAccent: 'cadence.autoAccent',
  coachMarks: 'os.coachmarks',
  /** Whether the daily reminder is on, and which of the three times. */
  reminders: 'os.reminders',

  // Business OS
  businessProfile: 'os.business.profile',
  businessData: 'os.business.data',

  /**
   * The chosen model id. Not in SecureStore with the key — it is a public
   * identifier like `meta-llama/llama-3.3-70b-instruct:free`, and hiding it
   * would only make it harder to show the owner what they picked.
   */
  aiModel: 'os.ai.model',
} as const;
