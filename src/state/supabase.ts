import AsyncStorage from '@react-native-async-storage/async-storage';

import { currentToken } from '@/state/clerkBridge';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * Note on imports: this module must stay loadable in plain Node.
 *
 * `validateUrl` and `validateAnonKey` are the two functions here most worth
 * testing, and a top-level `react-native` import would put them out of
 * `scripts/supabase-check.mjs`'s reach. Nothing native is imported for that
 * reason — the session storage and foreground-refresh wiring that used to
 * require it are gone, because Clerk's SDK owns both now.
 */

/**
 * The Supabase connection.
 *
 * Deliberately optional and deliberately late. The app is local-first and stays
 * that way: AsyncStorage remains the source of truth, every screen reads from
 * memory, and none of the intelligence layer knows a server exists. Supabase is
 * a *backup and a second device*, not a dependency — pull the wifi and nothing
 * on any screen changes.
 *
 * That ordering is the whole design. An app that reads from the network cannot
 * run `buildIndex` over the entire record set on every render, and that single
 * synchronous pass is what every insight in this product is built on.
 */

const URL_KEY = 'os.supabase.url';
const ANON_KEY = 'os.supabase.anon';

let client: SupabaseClient | null = null;

/**
 * Credentials live in storage rather than in the bundle.
 *
 * A URL and anon key compiled into the app are readable by anyone who downloads
 * it — which is fine, they are public by design, and Row Level Security is what
 * actually protects the data. Keeping them configurable means the same build can
 * point at a test project or a real one without a rebuild, which matters more
 * than the secrecy that an anon key never had.
 */
export async function loadConfig(): Promise<{ url: string; anonKey: string } | null> {
  try {
    const [url, anonKey] = await Promise.all([
      AsyncStorage.getItem(URL_KEY),
      AsyncStorage.getItem(ANON_KEY),
    ]);
    if (!url || !anonKey) return null;
    return { url, anonKey };
  } catch {
    return null;
  }
}

/**
 * What may be stored as a project URL.
 *
 * Two refusals, and the second one matters far more than it looks.
 *
 * **Plain http is rejected** because the anon key travels in a header on every
 * request. Over http that is a credential read off the wire by anyone on the
 * café wifi, and a config screen that silently accepts `http://` is a config
 * screen that quietly downgrades the whole connection.
 *
 * **Anything that is not http(s) is rejected**, which in practice means a
 * `postgres://` connection string. That paste is an easy mistake to make — it is
 * the string Supabase shows most prominently — and it is the most dangerous one
 * available, because a Postgres superuser URI carries a real password and
 * bypasses Row Level Security completely. Storing it would put the keys to every
 * tenant's data in a phone's AsyncStorage. Refusing it by shape is the only
 * check that catches it before that happens.
 */
export function validateUrl(raw: string): { ok: true; url: string } | { ok: false; reason: string } {
  const text = raw.trim().replace(/\/+$/, '');
  if (!text) return { ok: false, reason: 'Paste your project URL.' };

  let parsed: URL;
  try {
    parsed = new URL(text);
  } catch {
    return { ok: false, reason: 'That is not a URL. It should look like https://abc.supabase.co' };
  }

  if (parsed.protocol === 'postgres:' || parsed.protocol === 'postgresql:') {
    return {
      ok: false,
      reason:
        'That is the database connection string, not the project URL. It contains a password and bypasses row-level security, so it must never go in the app. Use the Project URL and anon key from Settings → API.',
    };
  }
  if (parsed.protocol === 'http:') {
    return { ok: false, reason: 'Use https. Over http your key is readable on the network.' };
  }
  if (parsed.protocol !== 'https:') {
    return { ok: false, reason: 'The project URL should start with https://' };
  }
  if (parsed.username || parsed.password) {
    return { ok: false, reason: 'That URL carries a password in it. The project URL has none.' };
  }

  return { ok: true, url: parsed.origin };
}

/**
 * The client-side key, in either format Supabase issues.
 *
 * There are two, and a project created recently only has the newer one:
 *
 *   - **`sb_publishable_…`** — the current format. An opaque string, not a JWT,
 *     so none of the claim-reading below applies to it.
 *   - **A JWT with `role: anon`** — the legacy format, still valid on older
 *     projects.
 *
 * Both are safe in an app and both respect Row Level Security. Their dangerous
 * twins — `sb_secret_…` and a `role: service_role` JWT — sit next to them on the
 * same dashboard page, look almost identical, and ignore RLS completely. Each is
 * refused by name, because the failure mode of pasting one is not an error
 * message: it is an app that works perfectly while exposing every tenant.
 */
export function validateAnonKey(raw: string): { ok: true; key: string } | { ok: false; reason: string } {
  const key = raw.trim();
  if (!key) return { ok: false, reason: 'Paste your publishable key.' };
  if (/\s/.test(key)) return { ok: false, reason: 'That key has spaces in it — something got cut.' };

  if (key.startsWith('sb_secret_')) {
    return {
      ok: false,
      reason:
        'That is the secret key. It ignores row-level security and must never go inside an app — anyone who opened the app would have full access to every account. Use the publishable key (sb_publishable_…) instead, and rotate that secret key.',
    };
  }

  if (key.startsWith('sb_publishable_')) {
    if (key.length < 30) return { ok: false, reason: 'That publishable key looks cut short.' };
    return { ok: true, key };
  }

  if (key.startsWith('sb_')) {
    return {
      ok: false,
      reason: 'Use the key that starts with sb_publishable_ — it is the only one safe to put in an app.',
    };
  }

  if (key.split('.').length !== 3 || key.length < 40) {
    return {
      ok: false,
      reason:
        'That does not look like a Supabase key. Copy the publishable key (sb_publishable_…) from Settings → API Keys.',
    };
  }
  // The service_role key has the same shape and full access to every row. It
  // sits next to the anon key in the dashboard and is copied by mistake
  // constantly, so it is worth reading the claim rather than trusting the shape.
  const role = jwtRole(key);
  if (role && role !== 'anon') {
    return {
      ok: false,
      reason: `That is the ${role} key. It ignores row-level security and must never ship inside an app — use the anon public key, or the newer sb_publishable_ one.`,
    };
  }
  return { ok: true, key };
}

/**
 * The `role` claim out of a JWT payload, or null if it cannot be read.
 *
 * Decoded by hand rather than with `atob`, which is not dependable on Hermes —
 * the same reason the vault encodes in hex. Only the payload segment is read and
 * nothing is verified: this is a typo check, not an authentication decision, and
 * the server is what actually enforces the role.
 */
function jwtRole(token: string): string | null {
  const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const segment = token.split('.')[1];
  if (!segment) return null;

  const base64 = segment.replace(/-/g, '+').replace(/_/g, '/');
  let bits = 0;
  let acc = 0;
  let text = '';
  for (const ch of base64) {
    const value = ALPHABET.indexOf(ch);
    if (value < 0) continue;
    acc = (acc << 6) | value;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      text += String.fromCharCode((acc >> bits) & 0xff);
    }
  }

  try {
    const role = (JSON.parse(text) as { role?: unknown }).role;
    return typeof role === 'string' ? role : null;
  } catch {
    return null;
  }
}

/** Throws on an invalid pair rather than storing something unusable. */
export async function saveConfig(url: string, anonKey: string): Promise<void> {
  const checkedUrl = validateUrl(url);
  if (!checkedUrl.ok) throw new Error(checkedUrl.reason);
  const checkedKey = validateAnonKey(anonKey);
  if (!checkedKey.ok) throw new Error(checkedKey.reason);

  await AsyncStorage.multiSet([
    [URL_KEY, checkedUrl.url],
    [ANON_KEY, checkedKey.key],
  ]);
  // Force the next getClient() to rebuild against the new project.
  client = null;
}

export async function clearConfig(): Promise<void> {
  await AsyncStorage.multiRemove([URL_KEY, ANON_KEY]);
  client = null;
}

/**
 * Returns null when nothing is configured, which is the normal state.
 *
 * Every caller treats null as "stay local", so an unconfigured app is not a
 * degraded one — it is the app working exactly as designed.
 */
export async function getClient(): Promise<SupabaseClient | null> {
  if (client) return client;

  const config = await loadConfig();
  if (!config) return null;

  /*
    Re-checked on the way out, not just on the way in.

    Validation was added to `saveConfig` after this shipped, so a phone that was
    configured before it exists can still be holding an `http://` URL or a
    connection string in storage. Refusing to build a client from one means those
    installs fall back to local-only — the state the app is designed around —
    instead of quietly using the bad config forever because it predates the check.
  */
  if (!validateUrl(config.url).ok || !validateAnonKey(config.anonKey).ok) return null;

  /*
    Supabase stores the records; Clerk says who you are.

    `accessToken` hands every request the current Clerk session token, and it
    turns Supabase's own auth off entirely — there is no Supabase user, no
    session to persist, and nothing to refresh. That is why the session
    encryption and the AppState refresh wiring that used to live here are gone
    rather than merely unused: Clerk's SDK owns both now, and its token cache is
    in the Keystore for the same reason the old one was.

    The row-level-security policies read the Clerk subject claim from this token.
    See `supabase/clerk-migration.sql` — with `auth.uid()` they would all match
    nothing, and every write would be refused.
  */
  client = createClient(config.url, config.anonKey, {
    accessToken: async () => (await currentToken()) ?? '',
  });

  return client;
}

export type ConnectionState =
  | { status: 'off' }
  | { status: 'no-account' }
  /** `who` is the phone or email the session belongs to, whichever it has. */
  | { status: 'ready'; who: string | null }
  | { status: 'error'; message: string };

/**
 * What the settings screen reports.
 *
 * Distinguishes "not set up" from "set up but not signed in" from "broken",
 * because those need three different things from the owner and a single "not
 * connected" would tell them none of it.
 */
/**
 * What the backup screen reports.
 *
 * Signed-in-ness is now a Clerk fact, not a Supabase one, so it is passed in by
 * the screen rather than read from a session here — this module has no hook to
 * read Clerk with. What it still owns is whether a *project* is configured and
 * whether it answers, which is the half Clerk knows nothing about.
 */
export async function connectionState(who: string | null): Promise<ConnectionState> {
  const supabase = await getClient();
  if (!supabase) return { status: 'off' };
  if (!who) return { status: 'no-account' };

  /*
    A real query rather than a reachability ping.

    The failure this needs to catch is not "the server is down" — it is a token
    Supabase will not accept, which happens when the Clerk third-party auth
    integration has not been added on the Supabase side. That returns a
    perfectly healthy connection and rejects every row, so anything short of an
    actual authenticated request reports success and the first backup fails.
  */
  try {
    const { error } = await supabase.from('businesses').select('id').limit(1);
    if (error) return { status: 'error', message: error.message };
    return { status: 'ready', who };
  } catch (e) {
    return { status: 'error', message: e instanceof Error ? e.message : 'Could not reach it' };
  }
}
