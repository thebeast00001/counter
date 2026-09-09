import { useFocusEffect, useRouter } from 'expo-router';
import {
  Brain,
  CalendarClock,
  ChevronRight,
  CloudUpload,
  FlaskConical,
  Info,
  ListChecks,
  Lock,
  MessageCircleQuestion,
  RefreshCw,
  HardDriveDownload,
  TriangleAlert,
  HardDriveUpload,
  Share2,
  ShieldCheck,
  Sparkles,
  Store,
  Users,
  Wand,
} from 'lucide-react-native';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Share, StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { Chip } from '@/components/Chip';
import { LargeTitleScreen } from '@/components/LargeTitleScreen';
import { Press } from '@/components/Press';
import { SectionHeader } from '@/components/Section';
import { Segmented } from '@/components/Segmented';
import { Sheet } from '@/components/Sheet';
import { Toggle } from '@/components/Toggle';
import { getKey } from '@/ai/keys';
import { ARCHETYPES } from '@/domain/archetypes';
import { countOf, exportBackup, importBackup } from '@/state/backup';
import { clearCrashes, recentCrashes, type CrashRow } from '@/state/crash';
import { KEYS, loadJSON, saveJSON } from '@/state/persist';
import {
  DEFAULT_REMINDERS,
  armReminders,
  cancelReminders,
  remindersAvailable,
  type ReminderSettings,
  type ReminderTime,
} from '@/state/reminders';
import { buildSeed } from '@/domain/seed';
import { money } from '@/domain/metrics';
import { plural } from '@/domain/words';
import { formatDateFull } from '@/lib/time';
import { useMotion } from '@/design/motion';
import { useTheme, type SchemePreference } from '@/design/theme';
import { radius, space } from '@/design/tokens';
import { LOCALES, useI18n } from '@/lib/i18n';
import { useBusiness } from '@/state/business';
import { useDockInset } from '@/state/dock';
import { useSecurity } from '@/state/security';
import { isSealed } from '@/state/vault';

export default function SettingsScreen() {
  const {
    colors,
    preference,
    setPreference,
    colourSafe,
    setColourSafe,
  } = useTheme();
  const { locale, setLocale, t } = useI18n();
  const { enter } = useMotion();
  const dockInset = useDockInset();
  const router = useRouter();
  const security = useSecurity();
  const { profile, data, reset, install } = useBusiness();

  /*
    Only rendered when there is something to show.

    A permanently visible "0 problems" row teaches an owner to stop reading this
    part of the screen, which is the one place it must not happen — the row
    exists so that the one time something did break, there is a record of it to
    send on.
  */
  const [crashes, setCrashes] = useState<CrashRow[]>([]);
  useEffect(() => {
    recentCrashes().then(setCrashes).catch(() => {});
  }, []);

  const [reminders, setReminders] = useState<ReminderSettings>(DEFAULT_REMINDERS);
  /*
    Read once. In Expo Go the notifications module cannot load at all, and a
    switch that silently does nothing is worse than one that is visibly off
    with a reason beside it.
  */
  const [canRemind] = useState(remindersAvailable);

  useEffect(() => {
    loadJSON<ReminderSettings>(KEYS.reminders, DEFAULT_REMINDERS)
      .then((saved) => setReminders(saved ?? DEFAULT_REMINDERS))
      .catch(() => {});
  }, []);

  /*
    The schedule is rebuilt here rather than only on launch, because the figures
    in tomorrow's notification are read at the moment it is armed — turning the
    setting on with stale numbers would send exactly the wrong first impression
    of what these are for.
  */
  const applyReminders = useCallback(
    async (next: ReminderSettings) => {
      setReminders(next);
      saveJSON(KEYS.reminders, next);

      if (!next.enabled || !profile) {
        await cancelReminders();
        return;
      }
      const armed = await armReminders(profile, data, next.at);
      if (!armed) {
        setReminders(DEFAULT_REMINDERS);
        saveJSON(KEYS.reminders, DEFAULT_REMINDERS);
        Alert.alert(
          'Notifications are off',
          'Android has not given the app permission to notify you. Turn notifications on for Counter in your phone settings, then try again.',
        );
      }
    },
    [profile, data],
  );

  const setRemindersOn = useCallback(
    (on: boolean) => void applyReminders({ ...reminders, enabled: on }),
    [applyReminders, reminders],
  );
  const setRemindersAt = useCallback(
    (at: ReminderTime) => void applyReminders({ ...reminders, at }),
    [applyReminders, reminders],
  );

  /** Which of the two file operations is in flight, so neither can be started twice. */
  const [busy, setBusy] = useState<'export' | 'import' | null>(null);

  const saveBackup = useCallback(async () => {
    if (busy || !profile) return;
    setBusy('export');
    const result = await exportBackup(profile, data);
    setBusy(null);
    if (!result.ok) Alert.alert('Could not save it', result.reason);
  }, [busy, profile, data]);

  /*
    Two prompts, and the second one counts what is about to go.

    A restore replaces the whole business, and the person most likely to tap it
    is the person who has just lost theirs — but the person who taps it by
    mistake is the one with a year of records on the phone. Naming the number
    that would be replaced is what tells those two apart.
  */
  const restoreBackup = useCallback(async () => {
    if (busy) return;
    setBusy('import');
    const result = await importBackup();
    setBusy(null);

    if (!result.ok) {
      if ('cancelled' in result) return;
      Alert.alert('Could not restore', result.reason);
      return;
    }

    const incoming = countOf(result.data);
    const here = countOf(data);
    const when = result.exportedAt
      ? `Saved ${formatDateFull(result.exportedAt)}. `
      : '';

    Alert.alert(
      'Replace everything?',
      `${when}This copy holds ${incoming} records for ${result.profile.name}.` +
        (here > 0
          ? `\n\nThe ${here} records on this phone will be replaced, and that cannot be undone.`
          : ''),
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Replace',
          style: 'destructive',
          onPress: () => {
            install(result.profile, result.data);
            Alert.alert('Restored', `${incoming} records are back.`);
          },
        },
      ],
    );
  }, [busy, data, install]);

  const [confirmReset, setConfirmReset] = useState(false);
  const [confirmSample, setConfirmSample] = useState(false);

  // Reported rather than assumed: a device without a working Keystore stores
  // plaintext, and claiming otherwise would be the one lie this screen cannot
  // afford.
  const [sealed, setSealed] = useState(false);
  useEffect(() => {
    let alive = true;
    isSealed()
      .then((ok) => {
        if (alive) setSealed(ok);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  // Re-read on focus rather than once on mount: the assistant screen is where
  // this gets turned on, and coming back to a row still reading "Optional" would
  // suggest the connection had not taken.
  const [assistantOn, setAssistantOn] = useState(false);
  useFocusEffect(
    useCallback(() => {
      let alive = true;
      getKey()
        .then((k) => {
          if (alive) setAssistantOn(Boolean(k));
        })
        .catch(() => {});
      return () => {
        alive = false;
      };
    }, []),
  );

  if (!profile) return null;

  const archetype = ARCHETYPES[profile.archetype];
  const { shape } = profile;

  /**
   * A one-page position, in plain text.
   *
   * Deliberately prose rather than a data dump. The person on the other end is
   * an accountant, a spouse or a lender, and a JSON file helps none of them —
   * whereas six sentences they can read on a phone is exactly the artefact a
   * small business is always being asked for and never has to hand.
   */
  const summary = (): string => {
    const now = Date.now();
    const monthStart = new Date(now);
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);

    const collected = data.money
      .filter((m) => m.direction === 'in' && m.status === 'settled' && m.at >= monthStart.getTime())
      .reduce((s, m) => s + m.amount, 0);
    const owed = data.money
      .filter((m) => m.direction === 'in' && m.status === 'due')
      .reduce((s, m) => s + m.amount, 0);
    const spent = data.money
      .filter((m) => m.direction === 'out' && m.at >= monthStart.getTime())
      .reduce((s, m) => s + m.amount, 0);
    const active = data.commitments.filter((c) => c.status !== 'cancelled' && c.endAt >= now).length;
    const live = data.parties.filter((p) => !p.archivedAt).length;
    const recent = data.engagements.filter((e) => e.at >= now - 30 * 24 * 60 * 60 * 1000).length;
    const accounts = new Set(
      data.money.filter((m) => m.status === 'due').map((m) => m.partyId),
    ).size;

    return [
      `${profile.name} — position on ${formatDateFull(now)}`,
      '',
      `${live} ${plural(live, profile.vocabulary.party).toLowerCase()} on the books.`,
      shape.commitmentWeight > 0.4
        ? `${active} active ${plural(active, profile.vocabulary.commitment).toLowerCase()}.`
        : '',
      `${money(collected)} collected this month, ${money(spent)} out, ${money(collected - spent)} left over.`,
      owed > 0 ? `${money(owed)} still owed across ${accounts} ${accounts === 1 ? 'account' : 'accounts'}.` : 'Nothing outstanding.',
      `${recent} ${plural(recent, profile.vocabulary.engagement).toLowerCase()} in the last 30 days.`,
      '',
      'Prepared from records held on the owner\'s device.',
    ]
      .filter(Boolean)
      .join('\n');
  };

  return (
    <>
      <LargeTitleScreen title="Settings" bottomInset={dockInset}>
        {/* ------------------------------------------------------ business -- */}
        <Animated.View entering={enter(0)} style={styles.gutter}>
          <Card tone="alt" style={styles.profile}>
            <View style={[styles.mark, { backgroundColor: colors.accentSoft }]}>
              <Store size={20} color={colors.accent} strokeWidth={2} />
            </View>
            <View style={styles.grow}>
              <AppText variant="title2" numberOfLines={1}>
                {profile.name}
              </AppText>
              <AppText variant="footnote" color="textDim">
                {archetype.label} · {data.parties.length} {plural(data.parties.length, profile.vocabulary.party).toLowerCase()}
              </AppText>
            </View>
          </Card>
        </Animated.View>

        {/* --------------------------------------------------------- places -- */}
        <Animated.View entering={enter(1)}>
          <SectionHeader title="Go to" />
          <View style={styles.gutter}>
            <Card tone="surface" padded={false}>
              {[
                {
                  icon: <MessageCircleQuestion size={15} color={colors.accent} strokeWidth={2} />,
                  label: 'Ask about your business',
                  sub: 'Answered on this phone, with no signal needed',
                  href: '/ask',
                },
                {
                  icon: <Users size={15} color={colors.accent} strokeWidth={2} />,
                  label: 'Groups',
                  sub: `Who is drifting, who is best, who owes you`,
                  href: '/segments',
                },
                {
                  icon: <CalendarClock size={15} color={colors.accent} strokeWidth={2} />,
                  label: 'Your week',
                  sub: 'Which hours are full and which are empty',
                  href: '/capacity',
                },
                {
                  icon: <ListChecks size={15} color={colors.accent} strokeWidth={2} />,
                  label: 'Coming up',
                  sub: `${data.obligations.filter((o) => !o.done).length} things due`,
                  href: '/obligations',
                },
                {
                  icon: <Wand size={15} color={colors.accent} strokeWidth={2} />,
                  label: 'What it does on its own',
                  sub: `${data.rules.filter((r) => r.enabled && r.trust !== 'off').length} rules running`,
                  href: '/automations',
                },
                {
                  icon: <Brain size={15} color={colors.accent} strokeWidth={2} />,
                  label: 'What it knows',
                  sub: 'What you said, what the records say, and corrections',
                  href: '/memory',
                },
                ...(profile.shape.engagementFreq !== 'low'
                  ? [
                      {
                        icon: <CalendarClock size={15} color={colors.accent} strokeWidth={2} />,
                        label: 'Timetable',
                        sub: `${data.templates.filter((t) => t.active).length} running · change times, add or remove`,
                        href: '/schedule',
                      },
                    ]
                  : []),
                {
                  icon: <Users size={15} color={colors.accent} strokeWidth={2} />,
                  label: profile.vocabulary.person.many,
                  sub: `${data.staff.filter((s) => s.active !== false).length} working · what each is worth`,
                  href: '/team',
                },
                {
                  icon: <Store size={15} color={colors.accent} strokeWidth={2} />,
                  label: 'What you sell and your costs',
                  sub: 'The records everything else is built from',
                  href: '/manage',
                },
                {
                  icon: <Sparkles size={15} color={colors.accent} strokeWidth={2} />,
                  label: 'Your month',
                  sub: 'The story of it, in a handful of cards',
                  href: '/wrapped',
                },
                {
                  icon: <CloudUpload size={15} color={colors.accent} strokeWidth={2} />,
                  label: 'Backup',
                  sub: 'Optional — a copy, and a second phone',
                  href: '/cloud',
                },
              ].map((row, i) => (
                <Press
                  key={row.href}
                  haptic="light"
                  scaleTo={0.99}
                  onPress={() => router.push(row.href as never)}
                  style={[
                    styles.listRow,
                    i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.hairline },
                  ]}>
                  <View style={[styles.icon, { backgroundColor: colors.accentSoft }]}>{row.icon}</View>
                  <View style={styles.grow}>
                    <AppText variant="callout">{row.label}</AppText>
                    <AppText variant="caption" color="textFaint" numberOfLines={1}>
                      {row.sub}
                    </AppText>
                  </View>
                  <ChevronRight size={16} color={colors.textFaint} strokeWidth={2.2} />
                </Press>
              ))}
            </Card>
          </View>
        </Animated.View>

        {/* ----------------------------------------------------- how it read -- */}
        <Animated.View entering={enter(2)}>
          <SectionHeader title="How it reads your business" />
          <View style={styles.gutter}>
            <Card tone="surface" style={styles.shape}>
              {[
                [
                  'Revenue model',
                  shape.commitmentWeight > 0.4
                    ? `${profile.vocabulary.commitment.many} that renew`
                    : 'Earned per visit',
                ],
                [
                  'Money arrives',
                  shape.paymentTiming === 'after'
                    ? 'After the work'
                    : shape.paymentTiming === 'split'
                      ? 'Part up front, rest after'
                      : shape.paymentTiming === 'before'
                        ? 'In advance'
                        : 'At the time',
                ],
                ['Visits are called', profile.vocabulary.engagement.many],
                [
                  'Assigned staff',
                  shape.staffAttribution ? 'Yes' : 'No',
                ],
              ].map(([label, value]) => (
                <View key={label} style={styles.shapeRow}>
                  <AppText variant="footnote" color="textDim" style={styles.grow}>
                    {label}
                  </AppText>
                  <AppText variant="footnote">{value}</AppText>
                </View>
              ))}
            </Card>
            <AppText variant="caption" color="textFaint" style={styles.hint}>
              Worked out from what you described at setup. Everything on the home screen follows
              from these — change them and the app changes shape.
            </AppText>

            {/*
              Colour carries meaning in this app — warn amber, success green —
              and about one man in twelve cannot separate those two reliably.
              Switching to blue and amber keeps the same signal without relying
              on the one axis that fails.
            */}
            <View style={styles.toggleRow}>
              <View style={styles.grow}>
                <AppText variant="callout">Do not use red and green</AppText>
                <AppText variant="caption" color="textFaint">
                  Uses blue and amber for good and bad instead
                </AppText>
              </View>
              <Toggle value={colourSafe} onChange={setColourSafe} />
            </View>
          </View>
        </Animated.View>

        {/* ----------------------------------------------------- reminders -- */}
        <Animated.View entering={enter(3)}>
          <SectionHeader title="Reminders" />
          <View style={styles.gutter}>
            <Card tone="surface">
              <View style={styles.toggleRow}>
                <View style={styles.grow}>
                  <AppText variant="callout">A daily nudge</AppText>
                  <AppText variant="caption" color="textFaint">
                    {!canRemind
                      ? 'Needs the installed app — Expo Go cannot send notifications'
                      : reminders.enabled
                        ? 'Overdue money and anything to file, once a day'
                        : 'The app can only tell you things while it is open'}
                  </AppText>
                </View>
                <Toggle
                  value={reminders.enabled && canRemind}
                  onChange={setRemindersOn}
                  disabled={!canRemind}
                />
              </View>

              {reminders.enabled && canRemind ? (
                <View style={styles.block}>
                  <Segmented<ReminderTime>
                    options={[
                      { value: 'morning', label: 'Morning' },
                      { value: 'midday', label: 'Midday' },
                      { value: 'evening', label: 'Evening' },
                    ]}
                    value={reminders.at}
                    onChange={setRemindersAt}
                  />
                  {/*
                    Said out loud, because a notification is read on a lock
                    screen by whoever is standing there — and an owner deciding
                    whether to turn this on deserves to know that before they do
                    rather than after somebody reads one over their shoulder.
                  */}
                  <AppText variant="caption" color="textFaint" style={styles.block}>
                    Counts and amounts only — never a customer's name.
                  </AppText>
                </View>
              ) : null}
            </Card>
          </View>
        </Animated.View>

        {/* ---------------------------------------------------- appearance -- */}
        <Animated.View entering={enter(3)}>
          <SectionHeader title={t('you.appearance')} />
          <View style={styles.gutter}>
            <Segmented<SchemePreference>
              options={[
                { value: 'system', label: 'System' },
                { value: 'light', label: 'Light' },
                { value: 'dark', label: 'Dark' },
              ]}
              value={preference}
              onChange={setPreference}
            />
          </View>
        </Animated.View>

        {/* ------------------------------------------------------ language -- */}
        <Animated.View entering={enter(4)}>
          <SectionHeader title={t('you.language')} />
          <View style={styles.gutter}>
            <View style={styles.chipRow}>
              {LOCALES.map((l) => (
                <Chip
                  key={l.value}
                  label={l.native}
                  selected={l.value === locale}
                  onPress={() => setLocale(l.value)}
                />
              ))}
            </View>
          </View>
        </Animated.View>

        {/* ------------------------------------------------------ security -- */}
        <Animated.View entering={enter(5)}>
          <SectionHeader title={t('you.privacy')} />
          <View style={styles.gutter}>
            <Card tone="surface" padded={false}>
              <View style={styles.listRow}>
                <View style={[styles.icon, { backgroundColor: colors.successSoft }]}>
                  <Lock size={15} color={colors.success} strokeWidth={2} />
                </View>
                <View style={styles.grow}>
                  <AppText variant="callout">App lock</AppText>
                  <AppText variant="caption" color="textFaint">
                    {security.available
                      ? `Require ${security.biometricLabel.toLowerCase()} to open`
                      : 'No biometrics set on this device'}
                  </AppText>
                </View>
                <Toggle
                  value={security.lockEnabled}
                  disabled={!security.available}
                  onChange={(next) => security.setLockEnabled(next)}
                />
              </View>

              <View
                style={[
                  styles.listRow,
                  { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.hairline },
                ]}>
                <View style={[styles.icon, { backgroundColor: colors.accentSoft }]}>
                  <ShieldCheck size={15} color={colors.accent} strokeWidth={2} />
                </View>
                <View style={styles.grow}>
                  <AppText variant="callout">Block screenshots</AppText>
                  <AppText variant="caption" color="textFaint">
                    {security.shieldSupported
                      ? 'Hides customer details from screen capture'
                      : 'Not available on this build'}
                  </AppText>
                </View>
                <Toggle
                  value={security.shieldEnabled}
                  disabled={!security.shieldSupported}
                  onChange={security.setShieldEnabled}
                />
              </View>
            </Card>
            {/*
              Offline-first is only reassuring if you can see it working. Without
              a visible confirmation that the last change was written down, "it
              never leaves your phone" reads as "it might not be anywhere".

              Built as a card rather than a dot beside a paragraph: the previous
              version reused the generic hint style, which carries its own top
              margin, so the dot floated a dozen points above text that had no
              flex to wrap against.
            */}
            <View style={[styles.saved, { backgroundColor: colors.surface }]}>
              <View style={[styles.savedDot, { backgroundColor: colors.success }]} />
              <View style={styles.savedBody}>
                <AppText variant="footnote">
                  {(
                    data.parties.length +
                    data.money.length +
                    data.engagements.length
                  ).toLocaleString()}{' '}
                  records, saved on this phone
                </AppText>
                <AppText variant="caption" color="textFaint" style={styles.savedNote}>
                  {sealed
                    ? 'Encrypted with a key held in this phone’s secure hardware. No account, no upload, no server — nothing to lose connection to, and nothing for anyone else to breach.'
                    : 'No account, no upload, no server. This device cannot encrypt at rest, so the records are stored as plain text — turn on the app lock below.'}
                </AppText>
              </View>
            </View>
          </View>
        </Animated.View>

        {/* ----------------------------------------------------- assistant -- */}
        <Animated.View entering={enter(6)}>
          <SectionHeader title="Assistant" />
          <View style={styles.gutter}>
            <Card tone="surface" padded={false}>
              <Press
                haptic="light"
                scaleTo={0.99}
                onPress={() => router.push('/assistant')}
                style={styles.listRow}>
                <View style={[styles.icon, { backgroundColor: colors.accentSoft }]}>
                  <Sparkles size={15} color={colors.accent} strokeWidth={2} />
                </View>
                <View style={styles.grow}>
                  <AppText variant="callout">Connect a model</AppText>
                  <AppText variant="caption" color="textFaint">
                    {assistantOn
                      ? 'Connected — helps with questions this phone cannot parse'
                      : 'Optional. Nothing identifying ever leaves this phone'}
                  </AppText>
                </View>
                <ChevronRight size={16} color={colors.textFaint} strokeWidth={2} />
              </Press>
            </Card>
          </View>
        </Animated.View>

        {/* ---------------------------------------------------------- data -- */}
        <Animated.View entering={enter(8)}>
          <SectionHeader title={t('you.data')} />
          <View style={styles.gutter}>
            <Card tone="surface" padded={false}>
              <Press
                haptic="medium"
                scaleTo={0.99}
                onPress={() => Share.share({ message: summary() }).catch(() => {})}
                style={styles.listRow}>
                <View style={[styles.icon, { backgroundColor: colors.accentSoft }]}>
                  <Share2 size={15} color={colors.accent} strokeWidth={2} />
                </View>
                <View style={styles.grow}>
                  <AppText variant="callout">Share a summary</AppText>
                  <AppText variant="caption" color="textFaint">
                    One page for an accountant, a partner, or a lender
                  </AppText>
                </View>
              </Press>

              {/*
                Above the sample-data row and below the summary, because it is
                the only thing on this screen that protects the records rather
                than describing them.
              */}
              <Press
                haptic="medium"
                scaleTo={0.99}
                onPress={saveBackup}
                accessibilityLabel="Save a copy of everything"
                style={styles.listRow}>
                <View style={[styles.icon, { backgroundColor: colors.accentSoft }]}>
                  <HardDriveDownload size={15} color={colors.accent} strokeWidth={2} />
                </View>
                <View style={styles.grow}>
                  <AppText variant="callout">Save a copy of everything</AppText>
                  <AppText variant="caption" color="textFaint">
                    {busy === 'export'
                      ? 'Writing the file…'
                      : `One file, ${countOf(data)} records — keep it somewhere private`}
                  </AppText>
                </View>
              </Press>

              <Press
                haptic="medium"
                scaleTo={0.99}
                onPress={restoreBackup}
                accessibilityLabel="Restore from a saved copy"
                style={styles.listRow}>
                <View style={[styles.icon, { backgroundColor: colors.accentSoft }]}>
                  <HardDriveUpload size={15} color={colors.accent} strokeWidth={2} />
                </View>
                <View style={styles.grow}>
                  <AppText variant="callout">Restore from a copy</AppText>
                  <AppText variant="caption" color="textFaint">
                    {busy === 'import' ? 'Reading the file…' : 'Replaces everything on this phone'}
                  </AppText>
                </View>
              </Press>

              {crashes.length > 0 ? (
                <Press
                  haptic="medium"
                  scaleTo={0.99}
                  onPress={() => {
                    const newest = crashes[0];
                    Alert.alert(
                      `${crashes.length} ${crashes.length === 1 ? 'problem' : 'problems'} recorded`,
                      `Most recent, ${formatDateFull(newest.at)}:\n\n${newest.message}\n\nSending these on is what makes them fixable.`,
                      [
                        { text: 'Close', style: 'cancel' },
                        {
                          text: 'Clear',
                          style: 'destructive',
                          onPress: () => {
                            void clearCrashes();
                            setCrashes([]);
                          },
                        },
                        {
                          text: 'Send',
                          onPress: () => {
                            Share.share({
                              message: crashes
                                .map((c) => `${formatDateFull(c.at)}\n${c.message}\n${c.stack}`)
                                .join('\n\n---\n\n'),
                            }).catch(() => {});
                          },
                        },
                      ],
                    );
                  }}
                  style={styles.listRow}>
                  <View style={[styles.icon, { backgroundColor: colors.surfaceHigh }]}>
                    <TriangleAlert size={15} color={colors.warn} strokeWidth={2} />
                  </View>
                  <View style={styles.grow}>
                    <AppText variant="callout">Something went wrong recently</AppText>
                    <AppText variant="caption" color="textFaint">
                      {crashes.length} {crashes.length === 1 ? 'problem' : 'problems'} recorded on
                      this phone — send them on so they can be fixed
                    </AppText>
                  </View>
                </Press>
              ) : null}

              {/*
                Sample data is opt-in and clearly labelled as sample.
                Setup used to install a fabricated history by default, which made
                a new account look convincing and every derived figure wrong.
                Demonstrating the app still needs a populated one, so the option
                stays — it simply cannot happen by accident any more.
              */}
              <Press
                haptic="medium"
                scaleTo={0.99}
                onPress={() => setConfirmSample(true)}
                style={[
                  styles.listRow,
                  { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.hairline },
                ]}>
                <View style={[styles.icon, { backgroundColor: colors.accentSoft }]}>
                  <FlaskConical size={15} color={colors.accent} strokeWidth={2} />
                </View>
                <View style={styles.grow}>
                  <AppText variant="callout">Load sample data</AppText>
                  <AppText variant="caption" color="textFaint">
                    {data.parties.length > 0
                      ? 'Replaces everything currently here'
                      : 'A made-up month, to see what a full app looks like'}
                  </AppText>
                </View>
              </Press>

              <Press
                haptic="medium"
                scaleTo={0.99}
                onPress={() => setConfirmReset(true)}
                style={[
                  styles.listRow,
                  { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.hairline },
                ]}>
                <View style={[styles.icon, { backgroundColor: `${colors.warn}22` }]}>
                  <RefreshCw size={15} color={colors.warn} strokeWidth={2} />
                </View>
                <View style={styles.grow}>
                  <AppText variant="callout">Start over</AppText>
                  <AppText variant="caption" color="textFaint">
                    Describe a different business from scratch
                  </AppText>
                </View>
              </Press>
            </Card>
          </View>
        </Animated.View>

        <Animated.View entering={enter(9)}>
          <SectionHeader title={t('you.about')} />
          <View style={styles.gutter}>
            <Card tone="surface" style={styles.about}>
              <Info size={17} color={colors.textDim} strokeWidth={1.9} />
              <View style={styles.grow}>
                <AppText variant="callout">Built around what you said</AppText>
                <AppText variant="caption" color="textFaint" numberOfLines={4}>
                  “{profile.description}”
                </AppText>
              </View>
            </Card>
          </View>
        </Animated.View>
      </LargeTitleScreen>

      <Sheet
        visible={confirmSample}
        onClose={() => setConfirmSample(false)}
        title="Load sample data?"
        footer={
          <Button
            label="Load it"
            onPress={() => {
              install(profile, buildSeed(profile, { parties: 60 }));
              setConfirmSample(false);
            }}
          />
        }>
        <AppText variant="footnote" color="textDim" style={styles.confirmNote}>
          A made-up business with a few months of history, so every screen has something in it.
          Anything you have entered yourself will be replaced, and the figures it shows are
          invented rather than yours.
        </AppText>
      </Sheet>

      <Sheet
        visible={confirmReset}
        onClose={() => setConfirmReset(false)}
        title="Start over?"
        footer={
          <>
            <Button
              label="Describe a new business"
              variant="danger"
              onPress={() => {
                reset();
                setConfirmReset(false);
                router.replace('/setup');
              }}
            />
            <Button label="Cancel" variant="secondary" onPress={() => setConfirmReset(false)} />
          </>
        }>
        {/*
          Names what will be lost, counted, before it happens. "Are you sure?"
          asks a question the person cannot answer without knowing what is at
          stake, which is exactly what a confirmation is supposed to tell them.
        */}
        <AppText variant="body" color="textDim" style={styles.confirmBody}>
          This permanently deletes {profile.name} and takes you back to setup.
        </AppText>

        <View style={[styles.losing, { backgroundColor: colors.surface }]}>
          {[
            [
              `${data.parties.filter((p) => !p.archivedAt).length}`,
              plural(data.parties.filter((p) => !p.archivedAt).length, profile.vocabulary.party).toLowerCase(),
            ],
            [
              `${data.engagements.length}`,
              plural(data.engagements.length, profile.vocabulary.engagement).toLowerCase(),
            ],
            [`${data.money.length}`, 'money entries'],
            [`${data.facts.filter((f) => f.origin === 'corrected').length}`, 'corrections you made'],
          ].map(([count, what]) => (
            <View key={what} style={styles.losingRow}>
              <AppText variant="callout" tabular tint={colors.warn}>
                {count}
              </AppText>
              <AppText variant="footnote" color="textDim">
                {what}
              </AppText>
            </View>
          ))}
        </View>

        <AppText variant="caption" color="textFaint" style={styles.confirmNote}>
          There is no undo for this one, and nothing is backed up anywhere else. Share a summary
          first if you want a record of where things stood.
        </AppText>
      </Sheet>
    </>
  );
}

const styles = StyleSheet.create({
  gutter: { paddingHorizontal: space.gutter },
  block: { marginTop: space.md },
  grow: { flex: 1, gap: 2 },
  profile: { flexDirection: 'row', alignItems: 'center', gap: space.base },
  mark: {
    width: 44,
    height: 44,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  shape: { gap: space.md },
  shapeRow: { flexDirection: 'row', alignItems: 'baseline', gap: space.md },
  hint: { marginTop: space.md, lineHeight: 17 },

  autoCard: { marginBottom: space.md },
  swatchRow: { flexDirection: 'row', flexWrap: 'wrap', gap: space.md, marginTop: space.base },
  swatch: {
    width: 40,
    height: 40,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2.5,
  },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },

  listRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.base,
    paddingVertical: space.base,
  },
  icon: {
    width: 30,
    height: 30,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  about: { flexDirection: 'row', gap: space.md, alignItems: 'flex-start' },

  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    marginTop: space.base,
  },
  saved: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space.md,
    marginTop: space.md,
    padding: space.base,
    borderRadius: radius.md,
  },
  // Nudged to sit on the first line's optical centre rather than its box top.
  savedDot: { width: 7, height: 7, borderRadius: radius.pill, marginTop: 6 },
  savedBody: { flex: 1, gap: 3 },
  savedNote: { lineHeight: 16 },

  confirmBody: { lineHeight: 22 },
  losing: { padding: space.base, borderRadius: radius.md, gap: space.sm, marginTop: space.base },
  losingRow: { flexDirection: 'row', alignItems: 'baseline', gap: space.sm },
  confirmNote: { marginTop: space.base, lineHeight: 17 },
});
