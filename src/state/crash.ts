import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * What broke, kept on the phone.
 *
 * There was no crash reporting of any kind: when the app failed on a real
 * device nobody ever found out, because the one person who saw it was the one
 * person who could not read a stack trace.
 *
 * Deliberately **not** Sentry, and not for want of trying. `@sentry/react-native`
 * ships a native module, and a native module is exactly what Expo Go cannot
 * load — adding it would trade the crash reporting for the ability to run the
 * app at all on the device it is demonstrated on. So this writes to the phone
 * instead, which loses aggregation across users and keeps the part that
 * actually matters to a solo developer: being able to see, after the fact,
 * what the app was doing when it stopped.
 *
 * `report()` is the whole interface. Pointing it at Sentry once this ships as a
 * dev build is a change to this file and nothing else — but read the note on
 * `redact` in `src/ai/redact.ts` first, because a stack trace can carry a
 * customer's name in it and the promise this app makes about names leaving the
 * device does not have an exception for error reports.
 */

const KEY = 'os.crash.log';

/** Enough to see a pattern, few enough that the log can never become the problem. */
const KEEP = 20;

export type CrashRow = {
  at: number;
  message: string;
  /** Component stack for a render failure, JS stack for anything else. */
  stack: string;
  /** False for an error caught outside React — a promise nobody handled. */
  render: boolean;
};

/*
  Written directly rather than through `persist.ts`.

  That module coalesces writes by 400ms to keep the ledger cheap, which is right
  for records and wrong for this: the process may be seconds from dying, and a
  crash report that was still waiting in a timer is not a crash report.
*/
async function appendRow(row: CrashRow): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    const rows: CrashRow[] = raw ? (JSON.parse(raw) as CrashRow[]) : [];
    rows.unshift(row);
    await AsyncStorage.setItem(KEY, JSON.stringify(rows.slice(0, KEEP)));
  } catch {
    // A failure to record a failure is not worth a second failure.
  }
}

export function report(error: unknown, stack = '', render = false): void {
  const err = error instanceof Error ? error : new Error(String(error));
  void appendRow({
    at: Date.now(),
    message: err.message || String(error),
    stack: (stack || err.stack || '').slice(0, 4000),
    render,
  });
}

export async function recentCrashes(): Promise<CrashRow[]> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as CrashRow[]) : [];
  } catch {
    return [];
  }
}

export async function clearCrashes(): Promise<void> {
  await AsyncStorage.removeItem(KEY).catch(() => {});
}

/**
 * Catches what React cannot.
 *
 * The error boundary only sees failures thrown while rendering. A rejected
 * promise in a save path, or a throw inside a `setTimeout`, never reaches it —
 * and those are the ones that corrupt state quietly rather than loudly.
 *
 * `ErrorUtils` is React Native's own global handler and is not in the public
 * types, hence the guarded shape. The previous handler is always called, so
 * the red box still appears in development.
 */
export function installCrashHandler(): void {
  const g = globalThis as {
    ErrorUtils?: {
      getGlobalHandler?: () => (e: unknown, fatal?: boolean) => void;
      setGlobalHandler?: (h: (e: unknown, fatal?: boolean) => void) => void;
    };
  };
  const utils = g.ErrorUtils;
  if (!utils?.setGlobalHandler) return;

  const previous = utils.getGlobalHandler?.();
  utils.setGlobalHandler((error, fatal) => {
    report(error, '', false);
    previous?.(error, fatal);
  });
}
