import { atRiskParties, buildIndex, quietThresholdDays } from '@/domain/analytics';
import { money } from '@/domain/metrics';
import type {
  ActionRecord,
  BusinessData,
  BusinessProfile,
  Rule,
  RuleTrust,
} from '@/domain/model';

/**
 * The automation ladder.
 *
 * The received wisdom is that small businesses want everything automated. They
 * do not. They want to stop *remembering*, which is a different thing — an app
 * that silently messages a customer on their behalf and gets the tone wrong has
 * cost them a relationship to save them thirty seconds. So nothing here starts
 * switched on above `suggest`, every rung is reversible, and a rule that keeps
 * getting undone demotes itself rather than waiting to be caught.
 */

const DAY = 24 * 60 * 60 * 1000;

export const TRUST_ORDER: RuleTrust[] = ['off', 'watch', 'suggest', 'draft', 'auto'];

/**
 * One word per rung.
 *
 * These sit four-across in a control about eighty points wide each, so "Write it
 * for me" wrapped or clipped every time. The full sentence has not been lost —
 * it moved to `TRUST_MEANING` below the control, where there is room for it and
 * where it can change as the selection does.
 */
export const TRUST_LABEL: Record<RuleTrust, string> = {
  off: 'Off',
  watch: 'Watch',
  suggest: 'Tell me',
  draft: 'Draft',
  auto: 'Do it',
};

export const TRUST_MEANING: Record<RuleTrust, string> = {
  off: 'Never runs.',
  watch: 'Counts how often this would have fired, and shows you nothing.',
  suggest: 'Raises it on your home screen. You decide what happens.',
  draft: 'Writes the message for you and waits for you to send it.',
  auto: 'Does it, then tells you. Always undoable.',
};

/** Where a brand-new rule starts. Never above `suggest`, whatever the owner picks. */
export const STARTING_TRUST: RuleTrust = 'suggest';

export type RuleTemplate = {
  trigger: string;
  /** Rendered with the business's own vocabulary. */
  sentence: (profile: BusinessProfile, data: BusinessData) => string;
  /** Whether this rule makes sense for this business at all. */
  applies: (profile: BusinessProfile) => boolean;
  /** The default rung for this trigger. Riskier actions start lower. */
  defaultTrust: RuleTrust;
};

export const RULE_TEMPLATES: Record<string, RuleTemplate> = {
  quietCheckIn: {
    trigger: 'quietCheckIn',
    applies: (p) => p.shape.engagementFreq !== 'low',
    defaultTrust: 'suggest',
    sentence: (p, d) => {
      const days = quietThresholdDays(p, d, buildIndex(d));
      return `When a ${p.vocabulary.party.one.toLowerCase()} has not been in for ${days} days, suggest checking in.`;
    },
  },
  expiryReminder: {
    trigger: 'expiryReminder',
    applies: (p) => p.shape.commitmentWeight > 0.4,
    defaultTrust: 'draft',
    sentence: (p) =>
      `Seven days before a ${p.vocabulary.commitment.one.toLowerCase()} ends, write a renewal reminder.`,
  },
  overdueChase: {
    trigger: 'overdueChase',
    applies: (p) => p.shape.paymentTiming === 'after',
    defaultTrust: 'suggest',
    sentence: (p) => `When a payment is more than 14 days late, add it to the collection list.`,
  },
  welcome: {
    trigger: 'welcome',
    applies: () => true,
    defaultTrust: 'draft',
    sentence: (p) =>
      `When a new ${p.vocabulary.party.one.toLowerCase()} joins, write them a short welcome.`,
  },
  firstVisitMissing: {
    trigger: 'firstVisitMissing',
    applies: (p) => p.shape.engagementFreq !== 'low',
    defaultTrust: 'suggest',
    sentence: (p) =>
      `If a new ${p.vocabulary.party.one.toLowerCase()} has not been in within 10 days, flag it.`,
  },
  dailyBriefing: {
    trigger: 'dailyBriefing',
    applies: () => true,
    defaultTrust: 'auto',
    sentence: () => `Put together the day's summary each morning.`,
  },
  obligationLead: {
    trigger: 'obligationLead',
    applies: () => true,
    defaultTrust: 'suggest',
    sentence: () => `Remind me about rent, licences and tax before they fall due, not after.`,
  },
  winBack: {
    trigger: 'winBack',
    applies: (p) => p.shape.commitmentWeight > 0.3,
    defaultTrust: 'watch',
    sentence: (p) =>
      `Thirty days after a ${p.vocabulary.commitment.one.toLowerCase()} lapses, suggest one win-back attempt.`,
  },
};

/** The starting rule set for a freshly compiled business. */
export function defaultRules(profile: BusinessProfile, now = Date.now()): Rule[] {
  return Object.values(RULE_TEMPLATES)
    .filter((t) => t.applies(profile))
    .map((t, i) => ({
      id: `r${i}-${t.trigger}`,
      sentence: '',
      trigger: t.trigger,
      // Never above `suggest` on day one, whatever the template would prefer.
      trust: TRUST_ORDER.indexOf(t.defaultTrust) > TRUST_ORDER.indexOf(STARTING_TRUST)
        ? STARTING_TRUST
        : t.defaultTrust,
      createdAt: now,
      firedCount: 0,
      undoneCount: 0,
      enabled: true,
    }));
}

/** Renders a rule's sentence against the current business. Never stored. */
export function ruleSentence(rule: Rule, profile: BusinessProfile, data: BusinessData): string {
  const template = RULE_TEMPLATES[rule.trigger];
  if (!template) return rule.sentence || rule.trigger;
  return template.sentence(profile, data);
}

/* ----------------------------------------------------------------- health -- */

export type RuleHealth = {
  rule: Rule;
  undoRate: number;
  verdict: 'good' | 'noisy' | 'unproven' | 'idle';
  /** What the owner should be told, in one line. Null when it is behaving. */
  advice: string | null;
  /** Set when the rule should be demoted, and to what. */
  suggestedTrust?: RuleTrust;
};

/**
 * Whether a rule is earning its place.
 *
 * A rule that has fired forty times and been undone thirty is not a feature, it
 * is a recurring interruption the owner has been too polite to switch off. The
 * app should notice that before they do.
 */
export function ruleHealth(rule: Rule, now = Date.now()): RuleHealth {
  const undoRate = rule.firedCount === 0 ? 0 : rule.undoneCount / rule.firedCount;

  if (rule.firedCount < 4) {
    const stale = rule.lastFiredAt == null && now - rule.createdAt > 45 * DAY;
    return {
      rule,
      undoRate,
      verdict: stale ? 'idle' : 'unproven',
      advice: stale
        ? 'Has never fired. Either it is not relevant to how you work, or the situation has not come up.'
        : null,
    };
  }

  if (undoRate > 0.5) {
    return {
      rule,
      undoRate,
      verdict: 'noisy',
      advice: `Fired ${rule.firedCount} times and you undid ${rule.undoneCount} of them. It is probably wrong about your business.`,
      suggestedTrust: 'watch',
    };
  }

  if (undoRate > 0.25) {
    const current = TRUST_ORDER.indexOf(rule.trust);
    return {
      rule,
      undoRate,
      verdict: 'noisy',
      advice: `You undo about one in three of these. Worth easing it back a step.`,
      suggestedTrust: TRUST_ORDER[Math.max(current - 1, 1)],
    };
  }

  return { rule, undoRate, verdict: 'good', advice: null };
}

/**
 * Whether a rule has earned promotion.
 *
 * Deliberately conservative: fifteen clean firings before the app will even ask.
 * Trust is expensive to build and free to destroy, and the failure mode of
 * promoting too early is the owner turning off automation permanently.
 */
export function promotionOffer(rule: Rule): RuleTrust | null {
  const current = TRUST_ORDER.indexOf(rule.trust);
  if (current >= TRUST_ORDER.length - 1) return null;
  if (rule.trust === 'off') return null;
  if (rule.firedCount < 15) return null;
  if (rule.undoneCount / rule.firedCount > 0.1) return null;
  return TRUST_ORDER[current + 1];
}

/* ------------------------------------------------------------ quiet hours -- */

/** Nothing outbound fires outside these hours, whatever a rule wants. */
export const QUIET_HOURS = { from: 21, to: 8 };

export function inQuietHours(now = Date.now()): boolean {
  const h = new Date(now).getHours();
  return h >= QUIET_HOURS.from || h < QUIET_HOURS.to;
}

/* -------------------------------------------------------------- firing -- */

export type RuleFiring = {
  ruleId: string;
  trigger: string;
  label: string;
  partyIds: string[];
  /** Written for the owner to send, when the rule is at `draft` or above. */
  draft?: string;
};

/**
 * Evaluates every enabled rule against the current records.
 *
 * Pure: it reports what *would* happen. Whether anything is written down is the
 * store's decision, which keeps this testable and means a render can call it
 * without side effects.
 */
export function evaluateRules(
  profile: BusinessProfile,
  data: BusinessData,
  now = Date.now(),
): RuleFiring[] {
  const index = buildIndex(data);
  const out: RuleFiring[] = [];

  // A business behaving strangely is the worst possible moment to let rules run
  // unattended — the readings they depend on are exactly the ones that are off.
  if (isUnusual(data, now)) return out;

  const contactable = (id: string) => index.partyById.get(id)?.contactable !== false;

  for (const rule of data.rules) {
    if (!rule.enabled || rule.trust === 'off' || rule.trust === 'watch') continue;

    switch (rule.trigger) {
      case 'quietCheckIn': {
        const risky = atRiskParties(data, index, now, 0.55)
          .filter((r) => contactable(r.partyId))
          .slice(0, 8);
        if (risky.length === 0) break;
        out.push({
          ruleId: rule.id,
          trigger: rule.trigger,
          label: `Check in with ${risky.length}`,
          partyIds: risky.map((r) => r.partyId),
          draft:
            rule.trust === 'draft' || rule.trust === 'auto'
              ? `Hi {name}, we have not seen you in a while — everything alright? Happy to fit you in whenever suits.`
              : undefined,
        });
        break;
      }

      case 'expiryReminder': {
        const soon = data.commitments.filter(
          (c) => c.status !== 'cancelled' && c.endAt >= now && c.endAt <= now + 7 * DAY,
        );
        const ids = soon.map((c) => c.partyId).filter(contactable);
        if (ids.length === 0) break;
        out.push({
          ruleId: rule.id,
          trigger: rule.trigger,
          label: `Remind ${ids.length} about renewal`,
          partyIds: ids,
          draft:
            rule.trust === 'draft' || rule.trust === 'auto'
              ? `Hi {name}, your ${profile.vocabulary.commitment.one.toLowerCase()} is up in a few days. Want me to carry it on?`
              : undefined,
        });
        break;
      }

      case 'overdueChase': {
        const late = data.money.filter(
          (m) =>
            m.direction === 'in' &&
            m.status === 'due' &&
            (m.dueAt ?? m.at) < now - 14 * DAY &&
            m.partyId &&
            contactable(m.partyId),
        );
        if (late.length === 0) break;
        const total = late.reduce((s, m) => s + m.amount, 0);
        out.push({
          ruleId: rule.id,
          trigger: rule.trigger,
          label: `Collect ${money(total)} from ${new Set(late.map((m) => m.partyId)).size}`,
          partyIds: [...new Set(late.map((m) => m.partyId as string))],
          draft:
            rule.trust === 'draft' || rule.trust === 'auto'
              ? `Hi {name}, just a note that {amount} is still outstanding. Any trouble, tell me and we will sort something out.`
              : undefined,
        });
        break;
      }

      case 'firstVisitMissing': {
        const stalled = data.parties.filter((p) => {
          if (p.archivedAt) return false;
          const age = now - p.joinedAt;
          if (age < 10 * DAY || age > 40 * DAY) return false;
          return !index.engagementsByParty.has(p.id);
        });
        if (stalled.length === 0) break;
        out.push({
          ruleId: rule.id,
          trigger: rule.trigger,
          label: `${stalled.length} never started`,
          partyIds: stalled.map((p) => p.id),
        });
        break;
      }

      case 'obligationLead': {
        const due = data.obligations.filter(
          (o) => !o.done && o.dueAt <= now + (o.leadDays ?? 3) * DAY,
        );
        if (due.length === 0) break;
        out.push({
          ruleId: rule.id,
          trigger: rule.trigger,
          label: due.length === 1 ? due[0].label : `${due.length} things due`,
          partyIds: [],
        });
        break;
      }

      default:
        break;
    }
  }

  return out;
}

/**
 * Whether the business is behaving unusually enough to pause automation.
 *
 * Catches the case that matters: a week with no records at all, which means
 * either a holiday nobody declared or the owner has stopped using the app. Both
 * are states where firing messages at customers would be actively harmful.
 */
export function isUnusual(data: BusinessData, now = Date.now()): boolean {
  const lastWeek = data.engagements.filter((e) => e.at >= now - 7 * DAY).length;
  const priorFour = data.engagements.filter(
    (e) => e.at >= now - 35 * DAY && e.at < now - 7 * DAY,
  ).length;
  if (priorFour < 8) return false; // not enough baseline to call anything unusual
  const weeklyNormal = priorFour / 4;
  return lastWeek < weeklyNormal * 0.25;
}

/* ------------------------------------------------------------- receipts -- */

/** Everything automation has done, newest first. The trust ledger, rendered. */
export function automationReceipts(data: BusinessData, limit = 30): ActionRecord[] {
  return data.actions
    .filter((a) => a.ruleId)
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, limit);
}
