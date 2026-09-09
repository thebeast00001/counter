import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import {
  ArrowRight,
  ChartNoAxesColumn,
  ChevronLeft,
  Info,
  TrendingDown,
  TrendingUp,
} from 'lucide-react-native';
import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { AppText } from '@/components/AppText';
import { Sparkline } from '@/components/Charts';
import { Press, type PressProps } from '@/components/Press';
import { Ring } from '@/components/Charts';
import { Sheet } from '@/components/Sheet';
import { buildIndex } from '@/domain/analytics';
import { explainMetric, explainParty, type Explanation } from '@/domain/explain';
import type { Insight } from '@/domain/insights';
import { money } from '@/domain/metrics';
import { useColors } from '@/design/theme';
import { radius, space } from '@/design/tokens';
import { formatDateMedium, formatDateShort, formatDayMonth } from '@/lib/time';
import { useBusiness } from '@/state/business';
import { useUndo } from '@/state/undo';

/**
 * Long-press to open the thing behind the number.
 *
 * The rule this enforces is that the app never asserts a figure it cannot break
 * open. Every tile, row, card and bar is wrapped in one of these, and they all
 * resolve to the same sheet, so the gesture means exactly one thing everywhere:
 * *show me why*.
 *
 * One provider owns one sheet. Letting each call site own its own modal was the
 * obvious first attempt and produced two sheets stacked on top of each other the
 * moment a deep dive contained a row that was itself long-pressable.
 */

export type DeepTarget =
  | { kind: 'metric'; metricKey: string }
  | { kind: 'party'; partyId: string }
  | { kind: 'money'; moneyId: string }
  | { kind: 'insight'; insight: Insight }
  | {
      kind: 'note';
      title: string;
      eyebrow?: string;
      body: string;
      rows?: { label: string; value: string }[];
    };

type DeepValue = {
  open: (target: DeepTarget) => void;
  close: () => void;
  /** Steps back one level in a nested dive. */
  back: () => void;
  depth: number;
  /** True when the reader has asked for the plain-English version. */
  plain: boolean;
  setPlain: (next: boolean) => void;
};

const DeepContext = createContext<DeepValue | null>(null);

export function useDeep(): DeepValue {
  const ctx = useContext(DeepContext);
  if (!ctx) throw new Error('useDeep must be used inside <DeepProvider>');
  return ctx;
}

export function DeepProvider({ children }: { children: React.ReactNode }) {
  /**
   * A stack, not a single target.
   *
   * Deep dives nest constantly — a metric lists its contributors, a contributor
   * is a person, that person's record lists their payments. With one slot each
   * step overwrote the last and the back gesture dropped you all the way out to
   * the screen. The stack gives every level a way back to the one above, which
   * the sheet renders as a breadcrumb.
   */
  const [stack, setStack] = useState<DeepTarget[]>([]);
  const [visible, setVisible] = useState(false);
  const [plain, setPlain] = useState(false);

  const open = useCallback((next: DeepTarget) => {
    setStack((prev) => (prev.length === 0 ? [next] : [...prev, next]));
    setVisible(true);
  }, []);

  const back = useCallback(() => {
    setStack((prev) => (prev.length > 1 ? prev.slice(0, -1) : prev));
  }, []);

  // The stack survives the dismiss animation; clearing it immediately would
  // blank the sheet's contents while it is still sliding down.
  const close = useCallback(() => {
    setVisible(false);
    setStack([]);
  }, []);

  const value = useMemo(
    () => ({ open, close, back, depth: stack.length, plain, setPlain }),
    [open, close, back, stack.length, plain],
  );

  return (
    <DeepContext.Provider value={value}>
      {children}
      <DeepSheet target={stack[stack.length - 1] ?? null} visible={visible} onClose={close} />
    </DeepContext.Provider>
  );
}

/* ------------------------------------------------------------- the wrapper */

export type DeepProps = Omit<PressProps, 'onLongPress'> & {
  target: DeepTarget;
};

const HOLD_MS = 300;

/**
 * Anything that can be interrogated.
 *
 * Fires its own heavy haptic on the long press rather than relying on the press
 * haptic, because the two gestures need to feel different: a tap is a light tick,
 * a press-and-hold is a distinct thud that says something else is about to
 * happen.
 *
 * There was a filling ring under the finger here, meant to advertise the hold.
 * It could not tell a hold from a tap — press-in is the only signal available at
 * that moment — so it flashed on every single touch anywhere in the app, and a
 * progress indicator that appears when nothing is loading reads as the app
 * struggling. The coach mark on the home screen teaches the gesture once instead,
 * which is the right number of times.
 */
export function Deep({ target, children, onPress, ...rest }: DeepProps) {
  const { open } = useDeep();

  return (
    <Press
      delayLongPress={HOLD_MS}
      onLongPress={() => {
        // Straight to the breakdown.
        // There was a preview stage here — hold for a card, keep holding for the
        // sheet. It read as a stutter rather than a feature: the gesture already
        // means "show me why", and answering it twice makes the first answer
        // look like something failing to load.
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy).catch(() => {});
        open(target);
      }}
      onPress={onPress ?? (() => open(target))}
      {...rest}>
      {children}
    </Press>
  );
}

/* -------------------------------------------------------------- the sheet */

function DeepSheet({
  target,
  visible,
  onClose,
}: {
  target: DeepTarget | null;
  visible: boolean;
  onClose: () => void;
}) {
  const { profile, data } = useBusiness();

  if (!target || !profile) {
    return <Sheet visible={false} onClose={onClose}>{null}</Sheet>;
  }

  switch (target.kind) {
    case 'metric':
      return (
        <MetricDeep
          explanation={explainMetric(target.metricKey, profile, data)}
          visible={visible}
          onClose={onClose}
        />
      );
    case 'party':
      return <PartyDeep partyId={target.partyId} visible={visible} onClose={onClose} />;
    case 'money':
      return <MoneyDeep moneyId={target.moneyId} visible={visible} onClose={onClose} />;
    case 'insight':
      return <InsightDeep insight={target.insight} visible={visible} onClose={onClose} />;
    case 'note':
      return (
        <Sheet visible={visible} onClose={onClose} title={target.title} eyebrow={target.eyebrow}>
          <AppText variant="body" color="textDim" style={styles.body}>
            {target.body}
          </AppText>
          {target.rows?.length ? (
            <View style={styles.rows}>
              {target.rows.map((row) => (
                <Row key={row.label} label={row.label} value={row.value} />
              ))}
            </View>
          ) : null}
        </Sheet>
      );
  }
}

/* -------------------------------------------------------------- fragments */

function Row({
  label,
  sub,
  value,
  tint,
  onPress,
}: {
  label: string;
  sub?: string;
  value?: string;
  tint?: string;
  onPress?: () => void;
}) {
  const colors = useColors();
  const body = (
    <View style={[styles.row, { borderBottomColor: colors.hairline }]}>
      <View style={styles.rowBody}>
        <AppText variant="callout" numberOfLines={1}>
          {label}
        </AppText>
        {sub ? (
          <AppText variant="caption" color="textFaint" numberOfLines={1}>
            {sub}
          </AppText>
        ) : null}
      </View>
      {value ? (
        <AppText variant="callout" tabular tint={tint}>
          {value}
        </AppText>
      ) : null}
    </View>
  );

  return onPress ? (
    <Press haptic="light" scaleTo={0.985} onPress={onPress}>
      {body}
    </Press>
  ) : (
    body
  );
}

function SectionLabel({ children }: { children: string }) {
  return (
    <AppText variant="caption" color="textFaint" style={styles.sectionLabel}>
      {children.toUpperCase()}
    </AppText>
  );
}

/**
 * The controls that sit at the top of every dive.
 *
 * A way back up when the dive is nested, and a plain-English switch. The switch
 * is not a beginner mode — it is for the owner who knows their trade perfectly
 * well and has never had a reason to learn what a cohort is.
 */
function DeepControls() {
  const colors = useColors();
  const { back, depth, plain, setPlain } = useDeep();

  if (depth <= 1 && !plain) {
    return (
      <Press
        haptic="light"
        scaleTo={0.96}
        onPress={() => setPlain(true)}
        accessibilityLabel="Explain this in plain words"
        style={styles.controlsRight}>
        <AppText variant="caption" color="textFaint">
          Explain simply
        </AppText>
      </Press>
    );
  }

  return (
    <View style={styles.controls}>
      {depth > 1 ? (
        <Press
          haptic="light"
          scaleTo={0.94}
          onPress={back}
          accessibilityLabel="Back one level"
          style={styles.crumb}>
          <ChevronLeft size={14} color={colors.accent} strokeWidth={2.4} />
          <AppText variant="caption" tint={colors.accent}>
            Back
          </AppText>
        </Press>
      ) : (
        <View />
      )}

      <Press
        haptic="light"
        scaleTo={0.96}
        onPress={() => setPlain(!plain)}
        accessibilityRole="switch"
        accessibilityState={{ checked: plain }}
        accessibilityLabel="Explain this in plain words"
        style={[
          styles.crumb,
          plain && { backgroundColor: colors.accentSoft, borderRadius: radius.pill },
        ]}>
        <AppText variant="caption" tint={plain ? colors.accent : colors.textFaint}>
          {plain ? 'Plain words on' : 'Explain simply'}
        </AppText>
      </Press>
    </View>
  );
}

/* --------------------------------------------------------------- metric -- */

function MetricDeep({
  explanation,
  visible,
  onClose,
}: {
  explanation: Explanation;
  visible: boolean;
  onClose: () => void;
}) {
  const colors = useColors();
  const router = useRouter();
  const { open, plain } = useDeep();
  const [scrub, setScrub] = useState<number | null>(null);

  const e = explanation;

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      size="tall"
      eyebrow={e.title}
      title={e.value}
      footer={
        e.action ? (
          <Press
            haptic="medium"
            scaleTo={0.97}
            onPress={() => {
              onClose();
              router.push(e.action!.href as never);
            }}
            style={[styles.cta, { backgroundColor: colors.accent }]}>
            <AppText variant="callout" tint={colors.accentText}>
              {e.action.label}
            </AppText>
            <ArrowRight size={16} color={colors.accentText} strokeWidth={2.4} />
          </Press>
        ) : null
      }>
      <DeepControls />

      <AppText variant="body" color="textDim" style={styles.body}>
        {e.definition}
      </AppText>

      {e.series.length > 2 ? (
        <View style={styles.block}>
          <Sparkline values={e.series} height={56} onScrub={setScrub} />
          <AppText variant="caption" color="textFaint" style={styles.caption}>
            {scrub !== null && e.series[scrub] !== undefined
              ? `${e.series.length - scrub} day${e.series.length - scrub === 1 ? '' : 's'} ago · ${
                  e.key === 'revenue' || e.key === 'due'
                    ? money(e.series[scrub])
                    : String(e.series[scrub])
                }`
              : e.seriesLabel}
          </AppText>
        </View>
      ) : null}

      {e.causes.length > 0 ? (
        <View style={styles.block}>
          <SectionLabel>Why it moved</SectionLabel>
          {e.causes.map((cause) => (
            <View key={cause.label} style={styles.cause}>
              {cause.amount >= 0 ? (
                <TrendingUp size={15} color={colors.success} strokeWidth={2} />
              ) : (
                <TrendingDown size={15} color={colors.warn} strokeWidth={2} />
              )}
              <AppText variant="footnote" style={styles.causeText}>
                {cause.label}
              </AppText>
              <AppText
                variant="footnote"
                tabular
                tint={cause.amount >= 0 ? colors.success : colors.warn}>
                {cause.amount >= 0 ? '+' : '−'}
                {money(Math.abs(cause.amount))}
              </AppText>
            </View>
          ))}
        </View>
      ) : null}

      {e.comparisons.length > 0 ? (
        <View style={styles.block}>
          <SectionLabel>Compared with</SectionLabel>
          {e.comparisons.map((c) => (
            <Row
              key={c.label}
              label={c.label}
              value={
                c.delta === null
                  ? c.value
                  : `${c.value}   ${c.delta >= 0 ? '+' : '−'}${Math.round(Math.abs(c.delta) * 100)}%`
              }
              tint={
                c.delta === null ? undefined : c.delta >= 0 ? colors.success : colors.warn
              }
            />
          ))}
        </View>
      ) : null}

      {e.contributors.length > 0 ? (
        <View style={styles.block}>
          <SectionLabel>{e.contributorsLabel}</SectionLabel>
          {e.contributors.map((c) => (
            <Row
              key={c.id}
              label={c.label}
              sub={c.sub}
              value={c.value}
              onPress={c.partyId ? () => open({ kind: 'party', partyId: c.partyId as string }) : undefined}
            />
          ))}
        </View>
      ) : null}

      <View style={styles.block}>
        <SectionLabel>How it is worked out</SectionLabel>
        <AppText variant="footnote" color="textDim" style={styles.formula}>
          {e.formula}
        </AppText>
        {plain ? (
          <AppText variant="footnote" color="textDim" style={styles.plain}>
            In short: the app adds up the records you have already entered. It does not estimate,
            round, or fill in anything you have not recorded — so if a number looks low, the first
            thing to check is whether everything got written down.
          </AppText>
        ) : null}
      </View>

      {e.soWhat ? (
        <View style={[styles.note, { backgroundColor: colors.accentSoft }]}>
          <Info size={15} color={colors.accent} strokeWidth={2} />
          <AppText variant="footnote" style={styles.noteText}>
            {e.soWhat}
          </AppText>
        </View>
      ) : null}

      {e.caveat ? (
        <View style={[styles.note, { backgroundColor: colors.surfaceHigh }]}>
          <Info size={15} color={colors.textFaint} strokeWidth={2} />
          <AppText variant="footnote" color="textDim" style={styles.noteText}>
            {e.caveat}
          </AppText>
        </View>
      ) : null}
    </Sheet>
  );
}

/* ---------------------------------------------------------------- party -- */

function PartyDeep({
  partyId,
  visible,
  onClose,
}: {
  partyId: string;
  visible: boolean;
  onClose: () => void;
}) {
  const colors = useColors();
  const router = useRouter();
  const { profile, data } = useBusiness();

  const read = useMemo(
    () => (profile ? explainParty(profile, data, partyId) : null),
    [profile, data, partyId],
  );

  if (!read || !profile) return <Sheet visible={false} onClose={onClose}>{null}</Sheet>;

  const riskTone = read.churn.risk > 0.6 ? colors.warn : read.churn.risk > 0.35 ? colors.warn : colors.success;

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      size="tall"
      eyebrow={profile.vocabulary.party.one}
      title={read.name}
      footer={
        <Press
          haptic="medium"
          scaleTo={0.97}
          onPress={() => {
            onClose();
            router.push(`/person/${partyId}` as never);
          }}
          style={[styles.cta, { backgroundColor: colors.accent }]}>
          <AppText variant="callout" tint={colors.accentText}>
            Open full record
          </AppText>
          <ArrowRight size={16} color={colors.accentText} strokeWidth={2.4} />
        </Press>
      }>
      <DeepControls />

      <View style={styles.headline}>
        <Ring progress={1 - read.churn.risk} size={58} stroke={6} tint={riskTone}>
          <AppText variant="footnote" tabular tint={riskTone}>
            {Math.round((1 - read.churn.risk) * 100)}
          </AppText>
        </Ring>
        <View style={styles.headlineBody}>
          <AppText variant="callout">{read.lastSeenLabel}</AppText>
          <AppText variant="caption" color="textDim">
            {read.typicalGapLabel} · joined {read.joinedLabel}
          </AppText>
        </View>
      </View>

      {read.churn.reasons.length > 0 ? (
        <View style={[styles.note, { backgroundColor: colors.surfaceHigh }]}>
          <Info size={15} color={colors.warn} strokeWidth={2} />
          <View style={styles.noteText}>
            {read.churn.reasons.map((reason) => (
              <AppText key={reason} variant="footnote" color="textDim">
                {reason}
              </AppText>
            ))}
          </View>
        </View>
      ) : null}

      <View style={styles.block}>
        <SectionLabel>Money</SectionLabel>
        <Row label="Paid all time" value={read.lifetime} />
        <Row label="Running at" value={read.runRate} />
        <Row
          label="Outstanding"
          value={read.outstanding}
          tint={read.outstanding === 'Nothing' ? undefined : colors.warn}
        />
        <Row label="Payment habit" value={read.reliabilityLabel} />
      </View>

      {read.series.some((v) => v > 0) ? (
        <View style={styles.block}>
          <SectionLabel>{`${profile.vocabulary.engagement.many}, last 90 days`}</SectionLabel>
          <Sparkline values={read.series} height={44} fill={false} />
        </View>
      ) : null}

      <View style={styles.block}>
        <SectionLabel>History</SectionLabel>
        {read.timeline.slice(0, 14).map((item) => (
          <Row
            key={item.id}
            label={item.label}
            sub={formatDateMedium(item.at)}
            value={item.value}
            tint={item.kind === 'due' ? colors.warn : undefined}
          />
        ))}
      </View>
    </Sheet>
  );
}

/* ---------------------------------------------------------------- money -- */

function MoneyDeep({
  moneyId,
  visible,
  onClose,
}: {
  moneyId: string;
  visible: boolean;
  onClose: () => void;
}) {
  const colors = useColors();
  const { profile, data, settleMoney, unsettleMoney, splitIntoInstalments, refund, snapshot, replaceAll } =
    useBusiness();
  const { offerUndo } = useUndo();
  const { open } = useDeep();

  const entry = data.money.find((m) => m.id === moneyId);
  const index = useMemo(() => buildIndex(data), [data]);

  if (!entry || !profile) return <Sheet visible={false} onClose={onClose}>{null}</Sheet>;

  const party = entry.partyId ? index.partyById.get(entry.partyId) : null;
  const history = entry.partyId ? (index.moneyByParty.get(entry.partyId) ?? []) : [];
  const age = entry.dueAt ? Math.floor((Date.now() - entry.dueAt) / (24 * 60 * 60 * 1000)) : null;

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      size="tall"
      eyebrow={entry.direction === 'in' ? 'Owed to you' : 'Paid out'}
      title={money(entry.amount)}
      footer={
        entry.status === 'due' ? (
          <>
            <Press
              haptic="medium"
              scaleTo={0.97}
              onPress={() => {
                settleMoney(entry.id);
                offerUndo(`${money(entry.amount)} marked paid`, () => unsettleMoney(entry.id));
                onClose();
              }}
              style={[styles.cta, { backgroundColor: colors.accent }]}>
              <AppText variant="callout" tint={colors.accentText}>
                Mark as paid
              </AppText>
            </Press>
            <Press
              haptic="light"
              scaleTo={0.97}
              onPress={() => {
                // Splitting destroys the original entry and creates three, so
                // undo restores the whole set rather than trying to reassemble it.
                const before = snapshot();
                splitIntoInstalments(entry.id, 3, 30);
                offerUndo('Split into 3 parts', () => replaceAll(before));
                onClose();
              }}
              style={[styles.ctaGhost, { borderColor: colors.hairlineStrong }]}>
              <AppText variant="callout" color="textDim">
                Split into 3 monthly parts
              </AppText>
            </Press>
          </>
        ) : (
          <Press
            haptic="light"
            scaleTo={0.97}
            onPress={() => {
              const before = snapshot();
              refund(entry.id);
              offerUndo(`${money(entry.amount)} refunded`, () => replaceAll(before));
              onClose();
            }}
            style={[styles.ctaGhost, { borderColor: colors.hairlineStrong }]}>
            <AppText variant="callout" color="textDim">
              Record a refund
            </AppText>
          </Press>
        )
      }>
      <View style={styles.block}>
        <Row label="For" value={entry.label} />
        {party ? (
          <Row
            label={profile.vocabulary.party.one}
            value={party.name}
            onPress={() => open({ kind: 'party', partyId: party.id })}
          />
        ) : null}
        <Row
          label="Status"
          value={entry.status === 'due' ? (age && age > 0 ? `${age} days overdue` : 'Not yet due') : 'Paid'}
          tint={entry.status === 'due' && age && age > 0 ? colors.warn : colors.success}
        />
        {entry.dueAt ? (
          <Row
            label="Due"
            value={formatDayMonth(entry.dueAt)}
          />
        ) : null}
        {entry.method ? <Row label="Paid by" value={entry.method.toUpperCase()} /> : null}
      </View>

      {history.length > 1 ? (
        <View style={styles.block}>
          <SectionLabel>{`Everything from ${party?.name ?? 'this account'}`}</SectionLabel>
          {history
            .slice()
            .sort((a, b) => b.at - a.at)
            .slice(0, 12)
            .map((m) => (
              <Row
                key={m.id}
                label={m.label}
                sub={formatDateShort(m.at)}
                value={money(m.amount)}
                tint={m.status === 'due' ? colors.warn : undefined}
              />
            ))}
        </View>
      ) : null}
    </Sheet>
  );
}

/* -------------------------------------------------------------- insight -- */

function InsightDeep({
  insight,
  visible,
  onClose,
}: {
  insight: Insight;
  visible: boolean;
  onClose: () => void;
}) {
  const colors = useColors();
  const router = useRouter();
  const { data } = useBusiness();
  const { open } = useDeep();
  const index = useMemo(() => buildIndex(data), [data]);

  const strength =
    insight.score > 0.45 ? 'Strong signal' : insight.score > 0.25 ? 'Moderate signal' : 'Weak signal';

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      size="tall"
      eyebrow={strength}
      title={insight.title}
      footer={
        insight.action ? (
          <Press
            haptic="medium"
            scaleTo={0.97}
            onPress={() => {
              onClose();
              router.push(
                `/worklist?insight=${encodeURIComponent(insight.id)}&kind=${insight.action!.kind}` as never,
              );
            }}
            style={[styles.cta, { backgroundColor: colors.accent }]}>
            <AppText variant="callout" tint={colors.accentText}>
              {insight.action.label}
            </AppText>
            <ArrowRight size={16} color={colors.accentText} strokeWidth={2.4} />
          </Press>
        ) : null
      }>
      <DeepControls />

      <AppText variant="body" color="textDim" style={styles.body}>
        {insight.detail}
      </AppText>

      {insight.action?.partyIds.length ? (
        <View style={styles.block}>
          <SectionLabel>Who this is about</SectionLabel>
          {insight.action.partyIds.slice(0, 12).map((id) => {
            const party = index.partyById.get(id);
            if (!party) return null;
            const seen = index.lastSeen.get(id);
            return (
              <Row
                key={id}
                label={party.name}
                sub={
                  seen
                    ? `Last in ${formatDateShort(seen)}`
                    : 'Never been in'
                }
                onPress={() => open({ kind: 'party', partyId: id })}
              />
            );
          })}
        </View>
      ) : null}

      <View style={styles.block}>
        <SectionLabel>How this was scored</SectionLabel>
        <AppText variant="footnote" color="textDim" style={styles.formula}>
          Findings are rated on three things multiplied together: how unusual this is for your business,
          how much money or how many people it touches, and whether there is anything you can still do
          about it. A zero on any one of them removes the finding entirely. This one scored{' '}
          {insight.score.toFixed(2)} — {strength.toLowerCase()}.
        </AppText>
      </View>

      {insight.evidence ? (
        <Press
          haptic="light"
          scaleTo={0.97}
          onPress={() => {
            onClose();
            router.push(insight.evidence!.href as never);
          }}
          style={[styles.ctaGhost, { borderColor: colors.hairlineStrong }]}>
          <ChartNoAxesColumn size={15} color={colors.textDim} strokeWidth={2} />
          <AppText variant="callout" color="textDim">
            {insight.evidence.label}
          </AppText>
        </Press>
      ) : null}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  controls: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: space.md,
  },
  controlsRight: { alignSelf: 'flex-end', marginBottom: space.md, paddingVertical: 2 },
  crumb: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    paddingVertical: 4,
    paddingHorizontal: space.sm,
  },
  plain: { marginTop: space.md, lineHeight: 19, fontStyle: 'italic' },
  body: { lineHeight: 22, marginBottom: space.base },
  block: { marginTop: space.lg },
  sectionLabel: { letterSpacing: 0.8, marginBottom: space.sm },
  caption: { marginTop: space.xs },
  formula: { lineHeight: 19 },

  rows: { marginTop: space.md },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingVertical: space.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rowBody: { flex: 1, gap: 2 },

  cause: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingVertical: space.sm },
  causeText: { flex: 1 },

  headline: { flexDirection: 'row', alignItems: 'center', gap: space.base, marginBottom: space.base },
  headlineBody: { flex: 1, gap: 2 },

  note: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space.md,
    padding: space.base,
    borderRadius: radius.md,
    marginTop: space.base,
  },
  noteText: { flex: 1, lineHeight: 19 },

  cta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.xs,
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
