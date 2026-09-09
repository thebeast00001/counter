import { useRouter } from 'expo-router';
import { ArrowRight, Check, ChevronLeft, ChevronRight, Sparkles, Users } from 'lucide-react-native';
import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Pressable,
  Platform,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import Animated, { FadeIn, FadeInRight, FadeOutLeft } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText } from '@/components/AppText';
import { Chip } from '@/components/Chip';
import { Press } from '@/components/Press';
import { MeshBackground } from '@/components/MeshBackground';
import { TextField } from '@/components/TextField';
import { readContacts, type DeviceContact } from '@/lib/contacts';
import { ARCHETYPES } from '@/domain/archetypes';
import { FOLLOW_UPS, buildProfile, compile, refine, type UnresolvedKey } from '@/domain/compile';
import { emptyData } from '@/domain/seed';
import { useColors } from '@/design/theme';
import { radius, space } from '@/design/tokens';
import { useBusiness } from '@/state/business';

const EXAMPLES = [
  'I run a gym with around 400 members. Monthly, quarterly and yearly memberships. Five trainers.',
  'I teach maths to 120 students across six batches. Fees are collected monthly.',
  'Small salon, three stylists, mostly haircuts and colour. Clients pay at the time.',
  'I have a garage. Customers bring cars, we service them and they pay after.',
];

/**
 * Onboarding as a compiler.
 *
 * The owner describes the business in her own words; the system works out what
 * it is and only asks about the things it genuinely could not infer. Nothing
 * here collects records — getting the roster in is a separate job that must
 * never stand between a new owner and her first useful screen.
 */
export default function SetupScreen() {
  const colors = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { install } = useBusiness();

  const [step, setStep] = useState(0);
  const [description, setDescription] = useState('');
  const [answers, setAnswers] = useState<Partial<Record<UnresolvedKey, string>>>({});
  const [name, setName] = useState('');
  const [ownerName, setOwnerName] = useState('');

  /** The address book, once the owner has agreed to it being read. */
  const [contacts, setContacts] = useState<DeviceContact[] | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [contactState, setContactState] = useState<'idle' | 'asking' | 'denied' | 'unavailable'>(
    'idle',
  );
  const [contactQuery, setContactQuery] = useState('');

  /** All of them, narrowed by what has been typed. */
  const shownContacts = useMemo(() => {
    if (!contacts) return [];
    const needle = contactQuery.trim().toLowerCase();
    if (!needle) return contacts;
    return contacts.filter((c) => c.name.toLowerCase().includes(needle));
  }, [contacts, contactQuery]);

  const syncContacts = async () => {
    setContactState('asking');
    const result = await readContacts();
    if (result.ok) {
      setContacts(result.contacts);
      setContactState('idle');
      return;
    }
    setContactState(result.reason === 'denied' ? 'denied' : 'unavailable');
  };

  const toggleContact = (id: string) => {
    // Computed outside the updater: React may run an updater twice, and a `Set`
    // mutated in place would then drop or double a selection.
    const next = new Set(picked);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setPicked(next);
  };

  const result = useMemo(() => (description.trim() ? compile(description) : null), [description]);
  const archetype = result ? ARCHETYPES[result.archetype] : null;

  /** The compiled shape with every answered follow-up folded in. */
  const shape = useMemo(() => {
    if (!result) return null;
    return (Object.keys(answers) as UnresolvedKey[]).reduce(
      (acc, key) => refine(acc, key, answers[key] ?? ''),
      result.shape,
    );
  }, [result, answers]);

  const finish = () => {
    if (!result || !shape) return;
    const profile = buildProfile({
      name,
      ownerName,
      description,
      archetype: result.archetype,
      shape,
    });
    /*
      Real records only.
      Setup used to generate a plausible history — ninety members, months of
      visits, a ledger — and it made every screen look convincing on day one.
      It also made every number a lie: the churn reads, the forecasts and the
      findings were all derived from invented data, and an owner cannot tell
      which figures are theirs. An empty app that fills up is worth more than a
      full one that is wrong.

      Imported contacts arrive with a name and a number and nothing else. A
      contact is somebody the owner knows, not somebody the app has a history
      for.
    */
    const chosen = (contacts ?? []).filter((c) => picked.has(c.id));
    const imported = chosen.map((c, i) => ({
      id: `p_import_${Date.now().toString(36)}_${i}`,
      name: c.name,
      phone: c.phone,
      joinedAt: Date.now(),
    }));

    install(profile, { ...emptyData(), parties: imported });
    router.replace('/');
  };

  const steps = [
    /* 0 ------------------------------------------------------------ intro */
    {
      cta: 'Get started',
      canAdvance: true,
      render: () => (
        <View style={styles.intro}>
          <View style={styles.brand}>
            <Sparkles size={17} color={colors.text} strokeWidth={2.2} />
            <AppText variant="callout">Counter</AppText>
          </View>

          <View style={styles.introText}>
            <AppText variant="body" color="textDim">
              Welcome to
            </AppText>
            {/*
              Two weights in one line, the way the reference does it: the phrase
              that names the thing carries the emphasis and the rest stays quiet.
              It reads as one sentence, not as a slogan.
            */}
            <AppText variant="largeTitle" style={styles.introHead}>
              A business that{'\n'}
              <AppText variant="largeTitle" tint={colors.accent}>
                explains itself
              </AppText>
            </AppText>
            <AppText variant="body" color="textDim" style={styles.introBlurb}>
              Describe what you do in your own words. It works out what to track, what to call
              things, and what matters — before you enter a single record.
            </AppText>
          </View>
        </View>
      ),
    },

    /* 1 ------------------------------------------------------ description */
    {
      cta: description.trim().length > 12 ? 'Continue' : 'Type a little more',
      canAdvance: description.trim().length > 12,
      render: () => (
        <View style={styles.body}>
          <AppText variant="title1">What kind of business do you run?</AppText>
          <AppText variant="footnote" color="textDim" style={styles.blurb}>
            A sentence or two is plenty. Mention roughly how many customers and how they pay.
          </AppText>
          <View style={styles.field}>
            <TextField
              placeholder="I run a gym with about 400 members…"
              value={description}
              onChangeText={setDescription}
              multiline
              maxLength={280}
              autoFocus
            />
          </View>

          <AppText variant="caption" color="textFaint" style={styles.exampleLabel}>
            Or start from one of these
          </AppText>
          <View style={styles.examples}>
            {EXAMPLES.map((example) => (
              <Press
                key={example}
                haptic="light"
                scaleTo={0.98}
                onPress={() => setDescription(example)}
                style={[styles.example, { backgroundColor: colors.surfaceHigh }]}>
                <AppText variant="footnote" color="textDim" numberOfLines={2}>
                  {example}
                </AppText>
              </Press>
            ))}
          </View>
        </View>
      ),
    },

    /* 2 --------------------------------------------------------- compiled */
    {
      cta: 'Looks right',
      canAdvance: true,
      render: () => (
        <View style={styles.body}>
          <AppText variant="footnote" color="textDim">
            {result?.confidence === 'high'
              ? 'This looks like'
              : result?.confidence === 'medium'
                ? 'This seems closest to'
                : 'Not certain, but closest to'}
          </AppText>
          <AppText variant="largeTitle" style={styles.compiled}>
            {archetype?.label}
          </AppText>

          <View style={[styles.summary, { backgroundColor: colors.surface }]}>
            {[
              ['Customers are called', archetype?.vocabulary.party.many],
              ['Visits are called', archetype?.vocabulary.engagement.many],
              [
                'Revenue is',
                (shape?.commitmentWeight ?? 0) > 0.4 ? 'mostly plans you renew' : 'earned per visit',
              ],
              [
                'Money arrives',
                shape?.paymentTiming === 'after'
                  ? 'after the work, sometimes late'
                  : shape?.paymentTiming === 'split'
                    ? 'part up front, the rest after'
                    : shape?.paymentTiming === 'before'
                      ? 'in advance'
                      : 'at the time',
              ],
              ...(result?.scale.parties
                ? [[`${archetype?.vocabulary.party.many}`, `about ${result.scale.parties}`]]
                : []),
            ].map(([label, value]) => (
              <View key={String(label)} style={styles.summaryRow}>
                <AppText variant="footnote" color="textDim" style={styles.summaryLabel}>
                  {label}
                </AppText>
                <AppText variant="footnote" style={styles.summaryValue}>
                  {value}
                </AppText>
              </View>
            ))}
          </View>

          {result && result.unresolved.length > 0 ? (
            <View style={styles.follow}>
              <AppText variant="footnote" color="textDim" style={styles.exampleLabel}>
                Two quick things it could not tell from that
              </AppText>
              {result.unresolved.slice(0, 2).map((key) => (
                <View key={key} style={styles.question}>
                  <AppText variant="callout">{FOLLOW_UPS[key].question}</AppText>
                  <View style={styles.answers}>
                    {FOLLOW_UPS[key].options.map((option) => (
                      <Chip
                        key={option.value}
                        label={option.label}
                        selected={answers[key] === option.value}
                        onPress={() => setAnswers((a) => ({ ...a, [key]: option.value }))}
                      />
                    ))}
                  </View>
                </View>
              ))}
            </View>
          ) : null}
        </View>
      ),
    },

    /* 3 --------------------------------------------------------- contacts */
    {
      cta: picked.size > 0 ? `Bring in ${picked.size}` : 'Skip for now',
      canAdvance: true,
      render: () => (
        <View style={styles.body}>
          <AppText variant="title1">Bring in who you already know</AppText>
          <AppText variant="footnote" color="textDim" style={styles.blurb}>
            Straight from this phone&apos;s contacts. Only the names and numbers you tick are
            copied, they stay on this device, and nothing is sent anywhere.
          </AppText>

          {contacts === null ? (
            <View style={styles.field}>
              {contactState === 'denied' || contactState === 'unavailable' ? (
                <AppText variant="footnote" color="textDim" style={styles.blurb}>
                  {contactState === 'denied'
                    ? 'No access to contacts. You can add people by hand at any time — nothing here depends on it.'
                    : 'Contacts are not available on this device. You can add people by hand instead.'}
                </AppText>
              ) : null}
              <Press
                haptic="medium"
                scaleTo={0.97}
                disabled={contactState === 'asking'}
                onPress={syncContacts}
                style={[styles.contactCta, { backgroundColor: colors.surfaceHigh }]}>
                {contactState === 'asking' ? (
                  <ActivityIndicator size="small" color={colors.textDim} />
                ) : (
                  <Users size={17} color={colors.accent} strokeWidth={2.2} />
                )}
                <AppText variant="callout" tint={colors.accent}>
                  {contactState === 'asking'
                    ? 'Reading contacts…'
                    : contactState === 'denied'
                      ? 'Try again'
                      : 'Choose from contacts'}
                </AppText>
              </Press>
            </View>
          ) : contacts.length === 0 ? (
            <AppText variant="footnote" color="textDim" style={styles.blurb}>
              No named contacts on this phone. You can add people by hand instead.
            </AppText>
          ) : (
            <>
              <View style={styles.field}>
                <TextField
                  placeholder="Search contacts"
                  value={contactQuery}
                  onChangeText={setContactQuery}
                  autoCorrect={false}
                />
              </View>

              <View style={styles.contactHead}>
                <AppText variant="caption" color="textFaint">
                  {picked.size > 0
                    ? `${picked.size} SELECTED`
                    : `${shownContacts.length} ${shownContacts.length === 1 ? 'CONTACT' : 'CONTACTS'}`}
                </AppText>
                <Pressable
                  onPress={() =>
                    setPicked(
                      picked.size > 0 ? new Set() : new Set(shownContacts.map((c) => c.id)),
                    )
                  }
                  hitSlop={8}
                  style={styles.contactAll}>
                  <AppText variant="caption" tint={colors.accent}>
                    {picked.size > 0 ? 'Clear' : 'Select all'}
                  </AppText>
                </Pressable>
              </View>

              {/*
                Every contact, not a slice.
                Rows here are plain `Pressable`s rather than the app's `Press`,
                which carries a shared value and an animated style each — fine for
                a dozen, ruinous for the two hundred an address book actually
                holds. No spring on a checkbox is a trade worth making to avoid
                capping the list at forty and telling the owner the rest are
                somewhere else.
              */}
              {shownContacts.map((contact) => {
                const on = picked.has(contact.id);
                return (
                  <Pressable
                    key={contact.id}
                    onPress={() => toggleContact(contact.id)}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: on }}
                    accessibilityLabel={contact.name}
                    style={[
                      styles.contactRow,
                      { backgroundColor: on ? colors.accentSoft : colors.surface },
                    ]}>
                    <View
                      style={[
                        styles.tick,
                        {
                          backgroundColor: on ? colors.accent : 'transparent',
                          borderColor: on ? colors.accent : colors.hairlineStrong,
                        },
                      ]}>
                      {on ? <Check size={12} color={colors.accentText} strokeWidth={3} /> : null}
                    </View>
                    <View style={styles.contactBody}>
                      <AppText variant="callout" numberOfLines={1}>
                        {contact.name}
                      </AppText>
                      {contact.phone ? (
                        <AppText variant="caption" color="textFaint" numberOfLines={1}>
                          {contact.phone}
                        </AppText>
                      ) : null}
                    </View>
                  </Pressable>
                );
              })}

              {shownContacts.length === 0 ? (
                <AppText variant="footnote" color="textDim" style={styles.blurb}>
                  Nobody by that name.
                </AppText>
              ) : null}
            </>
          )}
        </View>
      ),
    },

    /* 4 ------------------------------------------------------------- name */
    {
      cta: 'Build it',
      canAdvance: true,
      render: () => (
        <View style={styles.body}>
          <AppText variant="title1">Last thing</AppText>
          <AppText variant="footnote" color="textDim" style={styles.blurb}>
            What the business is called, and what to call you.
          </AppText>
          <View style={styles.field}>
            <TextField
              label="Business name"
              /*
                The archetype label is a decent hint for a recognised trade
                ("Gym or fitness studio") and meaningless for the fallback,
                where it reads "Something else" — which is not a name anybody
                would type.
              */
              placeholder={
                archetype && archetype.key !== 'generic' ? archetype.label : 'Your business name'
              }
              value={name}
              onChangeText={setName}
              maxLength={40}
              autoFocus
            />
          </View>
          <View style={styles.field}>
            <TextField
              label="Your name"
              placeholder="Optional"
              value={ownerName}
              onChangeText={setOwnerName}
              maxLength={24}
            />
          </View>
        </View>
      ),
    },
  ];

  const current = steps[step];
  const next = () => (step === steps.length - 1 ? finish() : setStep((s) => s + 1));

  return (
    <KeyboardAvoidingView
      style={[styles.root, { backgroundColor: colors.bg }]}
      // iOS does not resize the window, so the padding has to be added by hand.
      // Android already resized it above; adding padding there would double-count
      // and leave a keyboard-sized gap.
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      {/*
        A different gradient each step.
        Setup is the one flow with no data to colour itself from, and a flat
        field for five screens makes the whole thing feel like a form. Reusing
        the wrap's palettes means it is the same visual language rather than a
        second one invented for onboarding.
      */}
      <MeshBackground index={step} />

      <View style={{ height: insets.top + space.lg }} />

      {/*
        `flex: 1` on the scroll view itself, not just its content.
        Android resizes the window when the keyboard opens; without an explicit
        flex the scroll view keeps its content height, so the shrunken window
        clips the bottom of the form and the field you are typing into is the
        first thing to go. With it, the view shrinks and the bottom-aligned
        content stays against the keyboard.
      */}
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
        showsVerticalScrollIndicator={false}>
        <Animated.View
          key={step}
          entering={FadeInRight.springify().damping(26).stiffness(200)}
          exiting={FadeOutLeft.duration(140)}>
          {current.render()}
        </Animated.View>
      </ScrollView>

      <Animated.View
        entering={FadeIn}
        style={[styles.footer, { paddingBottom: insets.bottom + space.lg }]}>
        {/*
          Progress as dashes, sitting with the controls rather than pinned to the
          top. A row of dots in a far corner is a decoration you stop seeing; a
          measured rule directly above the button you are about to press is read
          every time, because it is already in the path of the eye going there.
        */}
        <View style={styles.dashes} accessibilityLabel={`Step ${step + 1} of ${steps.length}`}>
          {steps.map((_, i) => (
            <View
              key={i}
              style={[
                styles.dash,
                {
                  backgroundColor: i <= step ? colors.text : colors.hairlineStrong,
                  width: i === step ? 34 : 16,
                },
              ]}
            />
          ))}
        </View>

        <View style={[styles.controls, { backgroundColor: colors.surface }]}>
          <Press
            haptic="light"
            scaleTo={0.9}
            disabled={step === 0}
            accessibilityLabel="Back"
            onPress={() => setStep((s) => Math.max(0, s - 1))}
            style={[
              styles.circle,
              { borderColor: colors.hairlineStrong, opacity: step === 0 ? 0.35 : 1 },
            ]}>
            <ChevronLeft size={18} color={colors.text} strokeWidth={2.2} />
          </Press>

          <Press
            haptic="medium"
            scaleTo={0.92}
            disabled={!current.canAdvance}
            accessibilityLabel={current.cta}
            onPress={next}
            style={[
              styles.circleFilled,
              { backgroundColor: current.canAdvance ? colors.accent : colors.surfaceHigh },
            ]}>
            <ArrowRight
              size={18}
              color={current.canAdvance ? colors.accentText : colors.textFaint}
              strokeWidth={2.4}
            />
          </Press>

          <Press
            haptic="medium"
            scaleTo={0.98}
            disabled={!current.canAdvance}
            onPress={next}
            style={styles.ctaWide}>
            <AppText
              variant="callout"
              color={current.canAdvance ? 'text' : 'textFaint'}
              numberOfLines={1}
              style={styles.grow}>
              {current.cta}
            </AppText>
            {/* Three chevrons at falling opacity — motion implied without any. */}
            <View style={styles.chevrons}>
              {[0.9, 0.55, 0.25].map((o) => (
                <ChevronRight
                  key={o}
                  size={14}
                  color={colors.textDim}
                  strokeWidth={2.4}
                  opacity={current.canAdvance ? o : o * 0.4}
                />
              ))}
            </View>
          </Press>
        </View>
      </Animated.View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  scrollView: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space.gutter,
    paddingBottom: space.base,
  },
  backBtn: {
    width: 44,
    height: 36,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dots: { flexDirection: 'row', gap: 5, alignItems: 'center' },
  dot: { height: 6, borderRadius: radius.pill },

  scroll: {
    flexGrow: 1,
    justifyContent: 'flex-end',
    paddingHorizontal: space.gutter,
    paddingVertical: space.lg,
  },
  center: { alignItems: 'center', gap: space.sm },
  body: { gap: space.sm },
  mark: {
    width: 72,
    height: 72,
    borderRadius: radius.pill,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: space.lg,
  },
  headline: { marginTop: space.sm },
  blurb: { lineHeight: 21, marginTop: 2 },
  field: { marginTop: space.base },
  contactCta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
    paddingVertical: space.base,
    borderRadius: radius.md,
  },
  contactHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: space.base,
    marginBottom: space.sm,
  },
  contactAll: { paddingVertical: space.xs, paddingHorizontal: space.sm },
  contactRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    padding: space.md,
    borderRadius: radius.sm,
    marginBottom: space.sm,
  },
  tick: {
    width: 22,
    height: 22,
    borderRadius: radius.pill,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  contactBody: { flex: 1, gap: 1 },

  exampleLabel: { marginTop: space.xl, marginBottom: space.sm },
  examples: { gap: space.sm },
  example: { padding: space.base, borderRadius: radius.md },

  compiled: { marginTop: 2, marginBottom: space.lg },
  summary: { borderRadius: radius.lg, padding: space.base, gap: space.md },
  summaryRow: { flexDirection: 'row', alignItems: 'baseline', gap: space.md },
  summaryLabel: { flex: 1 },
  summaryValue: { flexShrink: 0 },

  follow: { marginTop: space.sm },
  question: { marginTop: space.base, gap: space.sm },
  answers: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },

  footer: { paddingHorizontal: space.gutter, paddingTop: space.md, gap: space.base },

  dashes: { flexDirection: 'row', gap: 6, alignItems: 'center', paddingLeft: space.xs },
  dash: { height: 3, borderRadius: radius.pill },

  controls: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    padding: 6,
    borderRadius: radius.pill,
  },
  circle: {
    width: 46,
    height: 46,
    borderRadius: radius.pill,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  circleFilled: {
    width: 46,
    height: 46,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ctaWide: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    height: 46,
    paddingHorizontal: space.base,
  },
  grow: { flex: 1 },
  chevrons: { flexDirection: 'row', alignItems: 'center', marginLeft: 'auto' },

  intro: { gap: space.xxl },
  brand: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  introText: { gap: space.xs },
  introHead: { lineHeight: 42, marginTop: space.xs },
  introBlurb: { lineHeight: 23, marginTop: space.md },
});
