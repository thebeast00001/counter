import { ClerkProvider, useAuth } from '@clerk/clerk-expo';
import { useEffect } from 'react';

import { provideToken } from '@/state/clerkBridge';

/**
 * Clerk, as the app's identity.
 *
 * Auth and data are deliberately split: Clerk owns who you are, Supabase owns
 * what you recorded, and neither knows much about the other. Clerk was chosen
 * over Supabase's own phone auth for one concrete reason — it delivers the SMS
 * itself. Indian carriers require the sender and the exact message template to
 * be registered on a DLT platform before they will carry an OTP, which is days
 * of paperwork per sender; Clerk sends on registrations it already holds.
 *
 * The cost of that choice is paid in `supabase/clerk-migration.sql`: every
 * row-level-security policy now reads the Clerk subject claim rather than
 * `auth.uid()`, because with Clerk issuing the token there is no Supabase user
 * for `auth.uid()` to return.
 */

/**
 * The publishable key is public and belongs in the bundle.
 *
 * It identifies the Clerk instance and nothing else — it cannot read a user,
 * mint a session, or change anything. Clerk's *secret* key can do all three and
 * must never appear in an app; it is a server credential, and this app has no
 * server.
 */
const PUBLISHABLE_KEY = process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY ?? '';

/**
 * Sessions are cached in the Keystore, not in plain storage.
 *
 * A Clerk session token is a credential: it opens the Supabase copy of every
 * record this account has backed up. The app already seals its local ledger with
 * a Keystore-held key precisely because app storage is readable on a rooted
 * handset or through an ADB backup — leaving the token that opens the server
 * copy in plaintext beside it would make that encryption a half-measure.
 *
 * Resolved through a guarded require, like every other native module here: a
 * missing one must degrade, never crash before the first frame.
 */
type SecureStoreModule = typeof import('expo-secure-store');

const SecureStore: SecureStoreModule | null = (() => {
  try {
    return require('expo-secure-store');
  } catch {
    return null;
  }
})();

const tokenCache = {
  getToken: async (key: string): Promise<string | null> => {
    if (!SecureStore) return null;
    try {
      return await SecureStore.getItemAsync(key);
    } catch {
      return null;
    }
  },
  saveToken: async (key: string, value: string): Promise<void> => {
    if (!SecureStore) return;
    try {
      await SecureStore.setItemAsync(key, value, {
        // Readable after the first unlock rather than only while unlocked, so a
        // background sync cannot fail silently on a locked phone.
        keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK,
      });
    } catch {
      // A cache miss costs a network round trip, not a session.
    }
  },
};

/**
 * Hands Clerk's `getToken` to the module that builds the Supabase client.
 *
 * Rendered inside the provider because `useAuth` is a hook and the Supabase
 * client is not a component. See `clerkBridge.ts` for why that wire exists.
 */
function ClerkTokenBridge({ children }: { children: React.ReactNode }) {
  const { getToken } = useAuth();

  useEffect(() => provideToken(() => getToken()), [getToken]);

  return <>{children}</>;
}

/**
 * Wraps the app. A missing key is not fatal — the app is local-first, so it
 * simply runs without a backup rather than refusing to start.
 */
export function AuthProvider({ children }: { children: React.ReactNode }) {
  if (!PUBLISHABLE_KEY) return <>{children}</>;

  return (
    <ClerkProvider publishableKey={PUBLISHABLE_KEY} tokenCache={tokenCache}>
      <ClerkTokenBridge>{children}</ClerkTokenBridge>
    </ClerkProvider>
  );
}

/** True when Clerk was configured at build time. */
export const CLERK_CONFIGURED = PUBLISHABLE_KEY.length > 0;
