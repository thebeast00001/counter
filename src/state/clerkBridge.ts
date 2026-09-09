/**
 * The one wire between Clerk and the Supabase client.
 *
 * Clerk hands out its session token through `useAuth()`, which is a React hook.
 * The Supabase client is built once in a plain module, outside any component,
 * because every domain function and every screen imports it — turning it into a
 * hook would mean threading a client through the whole app to save one wire.
 *
 * So the provider registers its `getToken` here on mount, and `supabase.ts`
 * reads it. It is a mutable module-level binding, which is exactly the shape
 * that usually deserves suspicion; it is justified here because there is only
 * ever one Clerk session in a process and only one thing that needs to read it.
 *
 * Returning null is a normal state, not an error: signed out, still loading, or
 * Clerk not configured at all. Supabase then sends the publishable key alone,
 * every RLS policy sees a null subject, and the result is that nothing is
 * readable — which is the correct answer for a request with no signed-in user.
 */

type TokenReader = () => Promise<string | null>;

let read: TokenReader | null = null;

/** Called by `ClerkTokenBridge` on mount. Returns a disposer. */
export function provideToken(reader: TokenReader): () => void {
  read = reader;
  return () => {
    // Only clear if nothing else has claimed it, so a remount that runs the new
    // effect before the old cleanup does not leave the app tokenless.
    if (read === reader) read = null;
  };
}

/** The current Clerk session token, or null when there is no session. */
export async function currentToken(): Promise<string | null> {
  if (!read) return null;
  try {
    return await read();
  } catch {
    // A refresh failure must read as "signed out" rather than crash a sync.
    return null;
  }
}

/** True when Clerk has a session this process can act on. */
export function hasToken(): boolean {
  return read !== null;
}

/**
 * The Clerk user id, taken from the subject claim of the current token.
 *
 * Read out of the token rather than from `useAuth().userId` for one reason: it
 * is then guaranteed to be the *same* value the database will see. The row-level
 * policies match on `auth.jwt() ->> 'sub'`, so if these two ever disagreed —
 * mid-refresh, or after an account switch — the app would write rows under an id
 * the policies reject, and the failure would look like a permissions bug rather
 * than a stale identifier.
 *
 * Decoded, not verified. Verification is Supabase's job and it does it on every
 * request; this only needs to know which id the server is about to check.
 */
export async function clerkSubject(): Promise<string | null> {
  const token = await currentToken();
  if (!token) return null;

  const segment = token.split('.')[1];
  if (!segment) return null;

  try {
    const sub = (JSON.parse(decodeBase64Url(segment)) as { sub?: unknown }).sub;
    return typeof sub === 'string' && sub.length > 0 ? sub : null;
  } catch {
    return null;
  }
}

/**
 * Base64url to text, by hand.
 *
 * `atob` is not dependable on Hermes — the same reason the vault encodes in hex
 * and `supabase.ts` decodes JWT claims this way. Reaching for it here would work
 * in development and fail on somebody's device.
 */
function decodeBase64Url(segment: string): string {
  const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
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
  return text;
}
