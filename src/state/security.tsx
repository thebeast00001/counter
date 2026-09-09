import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';

/**
 * Device-level protection for the app.
 *
 * A word on the threat model, because it drives every decision here. By default
 * the app has no account, no server, and makes no network requests: there is no +
 *  * session token to steal, no API to attack, and no database to breach, so the
 * only realistic adversary is someone who physically holds an unlocked phone.
 *
 * Two opt-in features change that, and only for owners who switch them on.
 * Supabase backup uploads records to a project the owner controls, and the AI
 * assistant sends redacted questions to a model under the owner's own API key.
 * Neither is reachable without the owner entering their own credentials, and
 * neither is defended by this module — the first relies on Row Level Security on
 * the server, the second on the curtain in `src/ai/redact.ts`.
 *
 * So this module defends the physical-access case, and nothing it cannot
 * honestly defend:
 *
 *  - Auth is delegated to the OS (fingerprint, face, or device passcode). The app
 *    never sees, stores, or compares a credential, so there is no secret of ours
 *    to leak.
 *  - The lock preference lives in SecureStore, backed by the Android Keystore,
 *    rather than in plain app storage.
 *  - Locking is time-based on backgrounding rather than immediate, because a lock
 *    that fires when you glance at a notification gets switched off, and a
 *    disabled lock protects nothing.
 *  - Screenshot and screen-recording blocking closes the most common real leak:
 *    a task list captured into a shared gallery or a screen-share.
 *
 * What this deliberately does not claim: it is not protection against forensic
 * extraction of an unlocked device, a compromised OS, or a determined attacker
 * with physical access and time. No client-side code can promise that.
 */

/**
 * Native modules are resolved through require() inside a try/catch.
 *
 * Expo Go ships a fixed set of native modules, and a build that lacks one would
 * otherwise throw at import time and take down the whole app before the first
 * frame. A security feature being unavailable must degrade to "off", never to a
 * crash — so every module below is optional, and every call site tolerates null.
 */
function optionalModule<T>(load: () => T): T | null {
  try {
    return load();
  } catch {
    return null;
  }
}

type LocalAuthModule = typeof import('expo-local-authentication');
type SecureStoreModule = typeof import('expo-secure-store');
type ScreenCaptureModule = typeof import('expo-screen-capture');

const LocalAuth = optionalModule<LocalAuthModule>(() => require('expo-local-authentication'));
const SecureStore = optionalModule<SecureStoreModule>(() => require('expo-secure-store'));
const ScreenCapture = optionalModule<ScreenCaptureModule>(() => require('expo-screen-capture'));

const KEY_LOCK = 'cadence.lock.enabled';
const KEY_SHIELD = 'cadence.lock.shield';

/** Grace period before backgrounding triggers a lock. */
const LOCK_AFTER_MS = 30_000;

async function readFlag(key: string): Promise<boolean> {
  if (!SecureStore) return false;
  try {
    return (await SecureStore.getItemAsync(key)) === '1';
  } catch {
    return false;
  }
}

function writeFlag(key: string, on: boolean): void {
  if (!SecureStore) return;
  SecureStore.setItemAsync(key, on ? '1' : '0').catch(() => {});
}

/** Prompts the OS. Returns false when auth is unavailable or was declined. */
async function promptAuth(message: string): Promise<boolean> {
  if (!LocalAuth) return false;
  try {
    const result = await LocalAuth.authenticateAsync({
      promptMessage: message,
      // Falls back to the device PIN when biometrics fail, so a wet finger does
      // not lock someone out of their own history.
      disableDeviceFallback: false,
      cancelLabel: 'Cancel',
    });
    return result.success;
  } catch {
    return false;
  }
}

type SecurityValue = {
  /** Hardware supports biometrics or a device passcode, and the module loaded. */
  available: boolean;
  /** Which factor the device offers, for accurate copy. */
  biometricLabel: string;
  /** False when the platform cannot block screen capture at all. */
  shieldSupported: boolean;
  lockEnabled: boolean;
  shieldEnabled: boolean;
  locked: boolean;
  ready: boolean;

  setLockEnabled: (on: boolean) => Promise<boolean>;
  setShieldEnabled: (on: boolean) => void;
  unlock: () => Promise<boolean>;
  lockNow: () => void;
};

const SecurityContext = createContext<SecurityValue | null>(null);

export function SecurityProvider({ children }: { children: React.ReactNode }) {
  const [available, setAvailable] = useState(false);
  const [biometricLabel, setBiometricLabel] = useState('Device passcode');
  const [lockEnabled, setLockState] = useState(false);
  const [shieldEnabled, setShieldState] = useState(false);
  const [locked, setLocked] = useState(false);
  const [ready, setReady] = useState(false);

  const backgroundedAt = useRef<number | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      let canAuth = false;
      let label = 'Device passcode';

      if (LocalAuth) {
        try {
          const [hasHardware, enrolled, types] = await Promise.all([
            LocalAuth.hasHardwareAsync(),
            LocalAuth.isEnrolledAsync(),
            LocalAuth.supportedAuthenticationTypesAsync(),
          ]);
          canAuth = hasHardware && enrolled;
          if (types.includes(LocalAuth.AuthenticationType.FACIAL_RECOGNITION)) {
            label = 'Face unlock';
          } else if (types.includes(LocalAuth.AuthenticationType.FINGERPRINT)) {
            label = 'Fingerprint';
          }
        } catch {
          canAuth = false;
        }
      }

      const [storedLock, storedShield] = await Promise.all([
        readFlag(KEY_LOCK),
        readFlag(KEY_SHIELD),
      ]);

      if (!alive) return;

      setAvailable(canAuth);
      setBiometricLabel(label);

      const on = storedLock && canAuth;
      setLockState(on);
      // Start locked when armed — otherwise the lock would be pointless across a
      // cold start, which is exactly when it matters most.
      setLocked(on);

      setShieldState(storedShield);
      if (storedShield && ScreenCapture) {
        ScreenCapture.preventScreenCaptureAsync().catch(() => {});
      }

      setReady(true);
    })();
    return () => {
      alive = false;
    };
  }, []);

  // Lock on return from background, but only after the grace period.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (!lockEnabled) return;
      if (state === 'background' || state === 'inactive') {
        backgroundedAt.current = Date.now();
        return;
      }
      if (state === 'active' && backgroundedAt.current !== null) {
        if (Date.now() - backgroundedAt.current > LOCK_AFTER_MS) setLocked(true);
        backgroundedAt.current = null;
      }
    });
    return () => sub.remove();
  }, [lockEnabled]);

  const unlock = useCallback(async () => {
    const ok = await promptAuth('Unlock Cadence');
    if (ok) setLocked(false);
    return ok;
  }, []);

  const setLockEnabled = useCallback(
    async (on: boolean) => {
      if (on && !available) return false;

      /*
        Both directions need proof, and the disarming one matters more.

        Arming asks so that nobody locks a phone's owner out of their own data
        with a stray tap. Disarming asked for nothing, which quietly made the
        whole feature optional for anyone holding the phone: the lock has a
        thirty-second grace period, so someone who picks up a handset the moment
        it is put down reaches Settings unchallenged and can simply switch the
        lock off, then keep the phone. A control that can be disabled without the
        credential it is built on is decoration.
      */
      /*
        The one exception: if the device can no longer authenticate at all — the
        owner removed their fingerprint and screen lock — then gating the *off*
        switch behind a prompt that can never succeed would strand them with a
        setting they cannot change. Startup already treats the lock as off in
        that case, so allowing it through changes nothing an attacker could use.
      */
      if (!on && !available) {
        setLockState(false);
        writeFlag(KEY_LOCK, false);
        return true;
      }

      const ok = await promptAuth(on ? 'Confirm to enable app lock' : 'Confirm to turn off app lock');
      if (!ok) return false;

      setLockState(on);
      writeFlag(KEY_LOCK, on);
      return true;
    },
    [available],
  );

  const setShieldEnabled = useCallback((on: boolean) => {
    if (!ScreenCapture) return;
    setShieldState(on);
    writeFlag(KEY_SHIELD, on);
    const call = on
      ? ScreenCapture.preventScreenCaptureAsync()
      : ScreenCapture.allowScreenCaptureAsync();
    call.catch(() => {});
  }, []);

  const lockNow = useCallback(() => {
    if (lockEnabled) setLocked(true);
  }, [lockEnabled]);

  /* Memoised because this context sits above the whole tree: a fresh object
     every render re-renders every consumer, which is the same trap `undo.tsx`
     documents. */
  const value = useMemo<SecurityValue>(
    () => ({
      available,
      biometricLabel,
      shieldSupported: ScreenCapture !== null,
      lockEnabled,
      shieldEnabled,
      locked,
      ready,
      setLockEnabled,
      setShieldEnabled,
      unlock,
      lockNow,
    }),
    [
      available,
      biometricLabel,
      lockEnabled,
      shieldEnabled,
      locked,
      ready,
      setLockEnabled,
      setShieldEnabled,
      unlock,
      lockNow,
    ],
  );

  return <SecurityContext.Provider value={value}>{children}</SecurityContext.Provider>;
}

export function useSecurity(): SecurityValue {
  const ctx = useContext(SecurityContext);
  if (!ctx) throw new Error('useSecurity must be used inside <SecurityProvider>');
  return ctx;
}
