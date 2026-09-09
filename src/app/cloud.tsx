import { useAuth, useSignIn, useSignUp, useUser } from '@clerk/clerk-expo';
import { useRouter } from 'expo-router';
import {
  ArrowLeft,
  CloudOff,
  CloudUpload,
  Check,
  Download,
  LogOut,
  TriangleAlert,
} from 'lucide-react-native';
import { useCallback, useEffect, useState } from 'react';
import { Alert, ScrollView, StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText } from '@/components/AppText';
import { Press } from '@/components/Press';
import { TextField } from '@/components/TextField';
import { useMotion } from '@/design/motion';
import { useColors } from '@/design/theme';
import { radius, space } from '@/design/tokens';
import { SUPPORT_EMAIL } from '@/config';
import { formatDateMedium, formatTime } from '@/lib/time';
import { useBarInset } from '@/state/dock';
import { useBusiness } from '@/state/business';
import { deleteRemote, pull, push, resetWatermarks, type SyncResult } from '@/state/sync';
import {
  clearConfig,
  connectionState,
  loadConfig,
  saveConfig,
  validateAnonKey,
  validateUrl,
  type ConnectionState,
} from '@/state/supabase';

/**
 * Backup and a second device.
 *
 * Written to make the ordering unmistakable: this is optional, the app is whole
 * without it, and nothing on any other screen waits for it. An owner who never
 * opens this page loses no feature — they lose a copy.
 *
 * The honesty here is deliberate. Small business owners have been burned by
 * "cloud" meaning "we hold your data hostage", so the page says plainly what
 * leaves the phone, what stays, and that local always wins.
 */
/**
 * A ten-digit Indian mobile in the form Supabase wants, or null.
 *
 * E.164, because that is the only format the auth API accepts and the commonest
 * reason a code never arrives is a number sent without a country code. Owners
 * type their number however they think of it — `98765 43210`, `+91 98765 43210`,
 * `098765-43210` — and all three are the same person.
 */
function toE164(raw: string): string | null {
  const digits = raw.replace(/\D/g, '');
  if (digits.length === 10) return `+91${digits}`;
  if (digits.length === 11 && digits.startsWith('0')) return `+91${digits.slice(1)}`;
  if (digits.length === 12 && digits.startsWith('91')) return `+${digits}`;
  return null;
}

/**
 * Turns a Clerk failure into something that names the setting to change.
 *
 * Clerk delivers the SMS itself, which is why it is here at all — Indian
 * carriers require the sender and the exact message template registered on a
 * DLT platform before they will carry an OTP, and Clerk sends on registrations
 * it already holds. What that leaves are configuration failures on the Clerk
 * dashboard, and every one of them is invisible from inside the app unless it is
 * named.
 */
function smsHint(message: string): string {
  // India has to be switched on explicitly; the default allowlist is narrow.
  if (/country|not allowed|allowlist|blocked country|unsupported/i.test(message)) {
    return 'Clerk will not send to this country yet. In the Clerk dashboard open Configure → SMS → allowlist and enable India.';
  }

  // Development instances are capped at 20 SMS a month.
  if (/quota|limit|exceeded|too many requests/i.test(message)) {
    return 'Clerk’s development instance allows 20 SMS a month and that is used up, or too many codes were asked for at once. Wait a minute, or use a Clerk test number while building.';
  }

  if (/phone.*not.*enabled|strategy|identifier.*not.*allowed/i.test(message)) {
    return 'Phone sign-in is not switched on for this Clerk instance. Open Configure → Email, phone, username, enable Phone number, and set the verification method to SMS code.';
  }

  if (/taken|already exists/i.test(message)) {
    return 'That number is already registered. Try again — it will sign you in rather than create a second account.';
  }

  return message;
}

/**
 * The most useful sentence out of a Clerk error.
 *
 * Clerk returns an array of errors carrying a `longMessage` written for an end
 * user and a `message` written for a developer. The sign-up failure is preferred
 * because when both flows fail it is nearly always the real cause — the sign-in
 * attempt only established that the number is not on file yet.
 */
function clerkMessage(primary: unknown, fallback: unknown): string {
  for (const candidate of [primary, fallback]) {
    const errors = (candidate as { errors?: { longMessage?: string; message?: string }[] })?.errors;
    const first = errors?.[0];
    if (first?.longMessage || first?.message) return first.longMessage ?? first.message ?? '';
    if (candidate instanceof Error && candidate.message) return candidate.message;
  }
  return 'Please try again.';
}

export default function CloudScreen() {
  const colors = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const barInset = useBarInset();
  const { enter } = useMotion();
  const { profile, data, install } = useBusiness();

  const [state, setState] = useState<ConnectionState>({ status: 'off' });
  const [url, setUrl] = useState('');
  const [anon, setAnon] = useState('');
  /*
    A phone number and a six-digit code, which is how everyone in this market
    already signs in to everything.

    No password. A small-business owner setting this up is standing behind a
    counter, and a password is a thing to invent, mistype, forget and reset — four
    chances to abandon the only step that stands between them and a backup.
    Their number is a thing they already know.
  */
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  /** Set once a code has been sent, so the screen knows which half to show. */
  const [sentTo, setSentTo] = useState<string | null>(null);
  /** Which Clerk flow is in progress, so the right verify call is made. */
  const [mode, setMode] = useState<'in' | 'up'>('in');
  /** Seconds until another code may be requested. */
  const [cooldown, setCooldown] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [last, setLast] = useState<SyncResult | null>(null);

  /*
    Identity comes from Clerk, the project from Supabase, and this screen is the
    only place that needs both — so it reads Clerk here and hands the answer down
    rather than making the Supabase module aware of it.
  */
  const { isSignedIn, signOut: clerkSignOut } = useAuth();
  const { user } = useUser();
  const { signIn, setActive } = useSignIn();
  const { signUp } = useSignUp();

  const who = isSignedIn ? (user?.primaryPhoneNumber?.phoneNumber ?? null) : null;

  const refresh = useCallback(() => {
    connectionState(who)
      .then(setState)
      .catch(() => {});
  }, [who]);

  /*
    A resend, on a timer.

    An SMS that has not arrived after thirty seconds is the commonest failure in
    this whole flow, and without a resend the only escape is backing out and
    starting again — which most people read as the app being broken. The delay is
    there because Supabase rate-limits OTP requests, and a button that can be
    hammered just produces a lockout instead of a code.
  */
  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setInterval(() => setCooldown((n) => Math.max(0, n - 1)), 1000);
    return () => clearInterval(timer);
  }, [cooldown]);

  useEffect(() => {
    loadConfig().then((config) => {
      if (config) {
        setUrl(config.url);
        setAnon(config.anonKey);
      }
    });
    refresh();
  }, [refresh]);

  if (!profile) return null;

  /*
    Checked before anything is stored, and the message says which of the two is
    wrong rather than repeating the same generic sentence for both.

    The old check here was `startsWith('http')`, which accepted plain http — and
    the anon key rides in a header on every request, so that quietly published a
    credential to anyone on the same network. The validators also refuse a
    `postgres://` connection string and a `service_role` key outright; both are
    easy to grab from the same dashboard page and either one hands over every
    tenant's data.
  */
  const connect = async () => {
    const checkedUrl = validateUrl(url);
    if (!checkedUrl.ok) {
      Alert.alert('Check the project URL', checkedUrl.reason);
      return;
    }
    const checkedKey = validateAnonKey(anon);
    if (!checkedKey.ok) {
      Alert.alert('Check the anon key', checkedKey.reason);
      return;
    }

    setBusy('connect');
    try {
      await saveConfig(checkedUrl.url, checkedKey.key);
      setUrl(checkedUrl.url);
      refresh();
    } catch (e) {
      Alert.alert('Could not save that', e instanceof Error ? e.message : 'Please try again.');
    } finally {
      // In `finally` so a rejection cannot leave the button spinning forever.
      setBusy(null);
    }
  };

  /*
    One call for both signing in and signing up.

    `signInWithOtp` creates the account if the number is new and signs it in if
    it is not, so there is no "do you already have an account" question — which
    is a question nobody can answer about an app they are setting up for the
    first time.
  */
  /*
    Sign-up and sign-in are the same button.

    Clerk keeps them as separate flows, and the owner cannot be expected to know
    which one they are in — an app being set up for the first time has no answer
    to "do you already have an account?". So this tries to sign in, and treats the
    "no such user" refusal as the signal to create one instead. Either way a code
    goes to the same number and the next screen is identical.
  */
  const sendCode = async () => {
    const e164 = toE164(phone);
    if (!e164) {
      Alert.alert('Check the number', 'Enter a ten-digit mobile number.');
      return;
    }
    if (!signIn || !signUp) return;

    setBusy('code');
    try {
      const attempt = await signIn.create({ identifier: e164 });
      const factor = attempt.supportedFirstFactors?.find((f) => f.strategy === 'phone_code');
      if (!factor || !('phoneNumberId' in factor)) throw new Error('phone_code unavailable');

      await signIn.prepareFirstFactor({
        strategy: 'phone_code',
        phoneNumberId: factor.phoneNumberId,
      });
      setMode('in');
      setSentTo(e164);
      setCooldown(30);
    } catch (signInError) {
      // Not a known number — create the account and send the same kind of code.
      try {
        await signUp.create({ phoneNumber: e164 });
        await signUp.preparePhoneNumberVerification({ strategy: 'phone_code' });
        setMode('up');
        setSentTo(e164);
        setCooldown(30);
      } catch (signUpError) {
        Alert.alert('Could not send the code', smsHint(clerkMessage(signUpError, signInError)));
      }
    } finally {
      setBusy(null);
    }
  };

  const verify = async () => {
    if (!sentTo || !signIn || !signUp || !setActive) return;

    setBusy('verify');
    try {
      const result =
        mode === 'in'
          ? await signIn.attemptFirstFactor({ strategy: 'phone_code', code: code.trim() })
          : await signUp.attemptPhoneNumberVerification({ code: code.trim() });

      if (result.status !== 'complete') {
        Alert.alert('Not signed in yet', 'Clerk needs another step. Check the phone settings on your Clerk instance.');
        return;
      }

      // Activating the session is what makes `getToken` start returning one, and
      // therefore what lets Supabase see a subject claim at all.
      await setActive({ session: result.createdSessionId });
      setCode('');
      setSentTo(null);
      refresh();
    } catch (e) {
      Alert.alert('That code did not work', 'Check the six digits, or send a new code.');
    } finally {
      setBusy(null);
    }
  };

  const doPush = async () => {
    setBusy('push');
    const result = await push(profile, data);
    setLast(result);
    setBusy(null);
    if (!result.ok) Alert.alert('Backup failed', result.message);
  };

  const doPull = async () => {
    // Named for what it does to the phone, not for what it does to the server.
    Alert.alert(
      'Replace what is on this phone?',
      'This downloads the backup and replaces every record here with it. Anything recorded on this phone and not yet backed up would be lost.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Replace',
          style: 'destructive',
          onPress: async () => {
            setBusy('pull');
            const remote = await pull();
            setBusy(null);
            if (!remote?.profile) {
              Alert.alert('Nothing to restore', 'There is no backup on this account yet.');
              return;
            }
            install(remote.profile, remote.data);
            /*
              The watermarks describe what *this phone* had already sent, and
              the records they described have just been replaced wholesale. Left
              in place they would cause the next push to skip everything older
              than the restore — so the restored history would never reach the
              server from this device.
            */
            resetWatermarks();
            router.back();
          },
        },
      ],
    );
  };

  const signOut = async () => {
    await clerkSignOut();
    refresh();
  };

  /**
   * Deletes the account and everything on the server.
   *
   * Two confirmations, because it cannot be undone and the wording of the first
   * one is easy to skim. The second names what is being destroyed rather than
   * asking "are you sure" a second time — a repeated question trains people to
   * tap through it, a specific one does not.
   *
   * The phone's own records are deliberately left alone, and the copy says so.
   * Somebody deleting a cloud account has not asked to lose their business.
   */
  const deleteAccount = () => {
    Alert.alert(
      'Delete your account?',
      'This removes the backup and the account itself from the server. Everything on this phone stays exactly as it is.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Continue',
          style: 'destructive',
          onPress: () =>
            Alert.alert(
              'This cannot be undone',
              'The backup will be gone. If this phone is lost afterwards, there is no copy to restore from.',
              [
                { text: 'Keep my account', style: 'cancel' },
                {
                  text: 'Delete permanently',
                  style: 'destructive',
                  onPress: async () => {
                    setBusy('delete');
                    const result = await deleteRemote();
                    if (!result.ok) {
                      setBusy(null);
                      Alert.alert('Could not delete it', result.message);
                      return;
                    }
                    /*
                      Clerk owns the identity, so the account is not gone until
                      Clerk's copy is. Deleting the user requires the SDK's own
                      call — signing out would leave a signed-up number behind
                      and the deletion would be a half-truth.

                      And it can genuinely fail: `deleteSelfEnabled` is an
                      instance setting, so an app whose Clerk dashboard has
                      self-deletion switched off gets a rejection here. The data
                      is already gone by then and that is the right order — but
                      the message afterwards has to say which half happened.
                      Reporting "your account is gone" over a surviving identity
                      is the one outcome worse than failing outright, because
                      the owner stops asking.
                    */
                    let identityGone = false;
                    try {
                      if (user?.deleteSelfEnabled === false) {
                        throw new Error('Self-deletion is disabled on this instance.');
                      }
                      await user?.delete();
                      identityGone = true;
                    } catch {
                      // The data is already gone; a stranded identity with
                      // nothing attached is recoverable, losing the data is not.
                    }

                    if (!identityGone) await clerkSignOut().catch(() => {});

                    setBusy(null);
                    refresh();
                    Alert.alert(
                      identityGone ? 'Deleted' : 'Backup deleted',
                      identityGone
                        ? 'Your account and its backup are gone. This phone still has everything.'
                        : `Your backup is gone and you have been signed out, but the sign-in itself could not be removed from here. Email ${SUPPORT_EMAIL} and it will be deleted for you. This phone still has everything.`,
                    );
                  },
                },
              ],
            ),
        },
      ],
    );
  };

  return (
    <View style={[styles.root, { backgroundColor: colors.bg, paddingTop: insets.top }]}>
      <View style={styles.bar}>
        <Press
          haptic="light"
          scaleTo={0.9}
          onPress={() => router.back()}
          accessibilityLabel="Back"
          style={[styles.iconButton, { backgroundColor: colors.surface }]}>
          <ArrowLeft size={19} color={colors.text} strokeWidth={2.2} />
        </Press>
        <View style={styles.barBody}>
          <AppText variant="title3">Backup</AppText>
          <AppText variant="caption" color="textFaint">
            {state.status === 'ready' ? 'Connected' : 'Optional — the app works without it'}
          </AppText>
        </View>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + barInset }]}>
        {/* ------------------------------------------------------ the pitch */}
        <Animated.View entering={enter(0)} style={styles.gutter}>
          <View style={[styles.card, { backgroundColor: colors.surface }]}>
            <AppText variant="footnote" color="textDim" style={styles.body}>
              Everything stays on this phone and keeps working with no signal. This adds a copy, so a
              lost or broken phone does not take the business with it — and lets a second phone see
              the same records.
            </AppText>
            <AppText variant="caption" color="textFaint" style={styles.body}>
              If the two ever disagree, the phone wins. Nothing here can overwrite what you recorded
              in front of a customer.
            </AppText>
          </View>
        </Animated.View>

        {/* -------------------------------------------------------- project */}
        {state.status === 'off' ? (
          <Animated.View entering={enter(1)} style={[styles.gutter, styles.block]}>
            <AppText variant="caption" color="textFaint" style={styles.label}>
              CONNECT A PROJECT
            </AppText>
            <View style={[styles.card, { backgroundColor: colors.surface }]}>
              <View style={styles.form}>
                <TextField
                  label="Project URL"
                  placeholder="https://xxxx.supabase.co"
                  value={url}
                  onChangeText={setUrl}
                  autoCapitalize="none"
                  autoCorrect={false}
                />
                <TextField
                  label="Anon key"
                  placeholder="eyJhbGciOi…"
                  value={anon}
                  onChangeText={setAnon}
                  autoCapitalize="none"
                  autoCorrect={false}
                />
                <AppText variant="caption" color="textFaint" style={styles.hint}>
                  Both are in your Supabase project under Settings → API. The anon key is safe to put
                  here — it is public by design, and the row-level rules in the schema are what keep
                  one business from reading another.
                </AppText>
              </View>

              <Press
                haptic="medium"
                scaleTo={0.97}
                disabled={busy !== null}
                onPress={connect}
                style={[styles.cta, { backgroundColor: colors.accent }]}>
                <AppText variant="callout" tint={colors.accentText}>
                  {busy === 'connect' ? 'Connecting…' : 'Connect'}
                </AppText>
              </Press>
            </View>
          </Animated.View>
        ) : null}

        {/* --------------------------------------------------------- account */}
        {state.status === 'no-account' || state.status === 'error' ? (
          <Animated.View entering={enter(1)} style={[styles.gutter, styles.block]}>
            <AppText variant="caption" color="textFaint" style={styles.label}>
              SIGN IN
            </AppText>

            {state.status === 'error' ? (
              <View style={[styles.warn, { backgroundColor: colors.surfaceHigh }]}>
                <TriangleAlert size={15} color={colors.warn} strokeWidth={2} />
                <AppText variant="caption" color="textDim" style={styles.warnText}>
                  {state.message}
                </AppText>
              </View>
            ) : null}

            <View style={[styles.card, { backgroundColor: colors.surface }]}>
              {sentTo === null ? (
                <>
                  <View style={styles.form}>
                    <TextField
                      label="Mobile number"
                      hint="+91"
                      value={phone}
                      onChangeText={setPhone}
                      keyboardType="phone-pad"
                      autoComplete="tel"
                      placeholder="98765 43210"
                    />
                  </View>

                  <Press
                    haptic="medium"
                    scaleTo={0.97}
                    disabled={busy !== null || toE164(phone) === null}
                    onPress={sendCode}
                    style={[styles.cta, { backgroundColor: colors.accent }]}>
                    <AppText variant="callout" tint={colors.accentText}>
                      {busy === 'code' ? 'Sending…' : 'Send me a code'}
                    </AppText>
                  </Press>

                  <AppText variant="caption" color="textFaint" style={styles.body}>
                    No password. We send a six-digit code to that number; entering it both
                    creates the account and signs you in.
                  </AppText>
                </>
              ) : (
                <>
                  <View style={styles.form}>
                    <TextField
                      label="The six digits"
                      hint={sentTo}
                      value={code}
                      onChangeText={setCode}
                      keyboardType="number-pad"
                      autoComplete="sms-otp"
                      textContentType="oneTimeCode"
                      maxLength={6}
                      autoFocus
                      placeholder="000000"
                    />
                  </View>

                  <Press
                    haptic="medium"
                    scaleTo={0.97}
                    disabled={busy !== null || code.trim().length < 6}
                    onPress={verify}
                    style={[styles.cta, { backgroundColor: colors.accent }]}>
                    <AppText variant="callout" tint={colors.accentText}>
                      {busy === 'verify' ? 'Checking…' : 'Confirm'}
                    </AppText>
                  </Press>

                  <Press
                    haptic="light"
                    scaleTo={0.97}
                    disabled={busy !== null || cooldown > 0}
                    onPress={sendCode}
                    style={[styles.ctaGhost, { borderColor: colors.hairlineStrong }]}>
                    <AppText variant="callout" color="textDim">
                      {cooldown > 0 ? `Send again in ${cooldown}s` : 'Send another code'}
                    </AppText>
                  </Press>

                  <Press
                    haptic="light"
                    scaleTo={0.97}
                    disabled={busy !== null}
                    onPress={() => {
                      setSentTo(null);
                      setCode('');
                      setCooldown(0);
                    }}>
                    <AppText variant="caption" color="textFaint" style={styles.unlink}>
                      Use a different number
                    </AppText>
                  </Press>
                </>
              )}
            </View>

            <Press haptic="light" scaleTo={0.97} onPress={() => clearConfig().then(refresh)}>
              <AppText variant="caption" color="textFaint" style={styles.unlink}>
                Use a different project
              </AppText>
            </Press>
          </Animated.View>
        ) : null}

        {/* ----------------------------------------------------------- ready */}
        {state.status === 'ready' ? (
          <>
            <Animated.View entering={enter(1)} style={[styles.gutter, styles.block]}>
              <View style={[styles.signedIn, { backgroundColor: colors.surface }]}>
                <View style={[styles.tick, { backgroundColor: colors.successSoft }]}>
                  <Check size={15} color={colors.success} strokeWidth={2.6} />
                </View>
                <View style={styles.grow}>
                  <AppText variant="callout">{state.who ?? 'Signed in'}</AppText>
                  <AppText variant="caption" color="textFaint">
                    {last?.ok
                      ? `Last backed up ${formatDateMedium(last.at)} at ${formatTime(last.at)} · ${last.pushed} records`
                      : 'Not backed up yet'}
                  </AppText>
                </View>
                <Press
                  haptic="light"
                  scaleTo={0.9}
                  onPress={signOut}
                  accessibilityLabel="Sign out"
                  style={styles.signOut}>
                  <LogOut size={16} color={colors.textFaint} strokeWidth={2} />
                </Press>
              </View>

              {/* Last, small, and destructive-coloured. Required by Play, and it
                  belongs where an owner would look for it rather than buried. */}
              <Press
                haptic="light"
                scaleTo={0.97}
                disabled={busy !== null}
                onPress={deleteAccount}
                accessibilityLabel="Delete your account and its backup">
                <AppText variant="caption" tint={colors.warn} style={styles.unlink}>
                  {busy === 'delete' ? 'Deleting…' : 'Delete my account and backup'}
                </AppText>
              </Press>
            </Animated.View>

            <Animated.View entering={enter(2)} style={[styles.gutter, styles.block]}>
              <Press
                haptic="medium"
                scaleTo={0.97}
                disabled={busy !== null}
                onPress={doPush}
                style={[styles.cta, { backgroundColor: colors.accent }]}>
                <CloudUpload size={17} color={colors.accentText} strokeWidth={2.2} />
                <AppText variant="callout" tint={colors.accentText}>
                  {busy === 'push' ? 'Backing up…' : 'Back up now'}
                </AppText>
              </Press>

              <Press
                haptic="light"
                scaleTo={0.97}
                disabled={busy !== null}
                onPress={doPull}
                style={[styles.ctaGhost, { borderColor: colors.hairlineStrong }]}>
                <Download size={16} color={colors.textDim} strokeWidth={2} />
                <AppText variant="callout" color="textDim">
                  {busy === 'pull' ? 'Restoring…' : 'Restore onto this phone'}
                </AppText>
              </Press>

              <AppText variant="caption" color="textFaint" style={styles.hint}>
                Backing up never deletes anything on the server, so a mistake here cannot lose
                history. Restoring replaces what is on this phone, which is why it asks first.
              </AppText>
            </Animated.View>
          </>
        ) : null}

        {/* --------------------------------------------------------- offline */}
        <Animated.View entering={enter(3)} style={[styles.gutter, styles.block]}>
          <View style={[styles.offline, { backgroundColor: colors.surface }]}>
            <CloudOff size={16} color={colors.textFaint} strokeWidth={2} />
            <AppText variant="caption" color="textFaint" style={styles.warnText}>
              Nothing on this page is required. Every screen reads from the phone, so the app is
              exactly as fast and exactly as complete with this switched off.
            </AppText>
          </View>
        </Animated.View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.gutter,
    paddingVertical: space.md,
  },
  barBody: { flex: 1, gap: 1 },
  grow: { flex: 1, gap: 2 },
  iconButton: {
    width: 38,
    height: 38,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },

  scroll: { paddingTop: space.sm },
  gutter: { paddingHorizontal: space.gutter },
  block: { marginTop: space.xl },
  label: { letterSpacing: 0.9, marginBottom: space.sm },

  card: { padding: space.base, borderRadius: radius.lg, gap: space.md },
  body: { lineHeight: 19 },
  form: { gap: space.md },
  hint: { lineHeight: 16 },

  signedIn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    padding: space.base,
    borderRadius: radius.lg,
  },
  tick: {
    width: 30,
    height: 30,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  signOut: { padding: space.sm },

  warn: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space.sm,
    padding: space.md,
    borderRadius: radius.md,
    marginBottom: space.sm,
  },
  warnText: { flex: 1, lineHeight: 16 },
  offline: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space.md,
    padding: space.base,
    borderRadius: radius.lg,
  },
  unlink: { textAlign: 'center', marginTop: space.md },

  cta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
    height: 50,
    borderRadius: radius.pill,
  },
  ctaGhost: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
    height: 48,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    marginTop: space.sm,
  },
});
