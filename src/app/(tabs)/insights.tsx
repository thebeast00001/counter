import { useRouter } from 'expo-router';
import {
  Activity,
  ArrowRight,
  Bell,
  CalendarDays,
  CalendarX,
  Clock,
  Crown,
  Info,
  Users,
  Sparkles,
  type LucideIcon,
} from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  useAnimatedRef,
  useSharedValue,
  type AnimatedRef,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText } from '@/components/AppText';
import { Bars, CohortGrid, StackedBar } from '@/components/Charts';
import { Deep } from '@/components/Deep';
import { EmptyState } from '@/components/EmptyState';
import {
  BarsWidget,
  INSIGHTS_HERO_COLLAPSED,
  INSIGHTS_HERO_HEIGHT,
  InsightsHero,
  ProgressWidget,
  StatWidget,
  WidgetRow,
} from '@/components/Widgets';
import { Press } from '@/components/Press';
import { agingBuckets, cohorts, noShows, seasonality } from '@/domain/analytics';
import { calibration } from '@/domain/intel';
import { generateInsights } from '@/domain/insights';
import { captureRead } from '@/domain/memory';
import { sessionRead, sessionWords } from '@/domain/sessions';
import { engagementsBetween, money, revenueBetween } from '@/domain/metrics';
import { INSIGHTS_FIELD } from '@/design/gradients';
import { useMotion } from '@/design/motion';
import { useColors } from '@/design/theme';
import { radius, space } from '@/design/tokens';
import { monthName, useTick } from '@/lib/time';
import { useBusiness, useIndex } from '@/state/business';
import { useBarScrollHandler } from '@/state/dockChrome';
import { useBarInset, useDockInset } from '@/state/dock';

const DAY = 24 * 60 * 60 * 1000;
const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

/**
 * Everything the system has noticed, not just what fitted on the home screen.
 *
 * This is a report, and it is built to look like one. Home leads with a sentence
 * and an arc; this leads with prose and bars, sits on a flat ground, and never
 * shows a clock. The two screens used to share a card component and became
 * indistinguishable — the density difference here is deliberate and load-bearing.
 *
 * The confidence marker on each finding is also deliberate. A finding presented
 * without its strength reads as a fact, and some of these are closer to a hunch.
 */
export default function InsightsScreen() {
  const colors = useColors();
  const router = useRouter();
  const { enter } = useMotion();
  const dockInset = useDockInset();
  const { profile, data, term } = useBusiness();
  const index = useIndex();

  // Hourly is plenty for a screen about months. A per-minute tick here would
  // recompute cohorts and seasonality sixty times an hour for no visible change.
  const now = useTick(3_600_000);

  const insights = useMemo(
    () => (profile ? generateInsights(profile, data, { now, limit: 8, index }) : []),
    [profile, data, now, index],
  );

  const weeks = useMemo(() => {
    const out: { label: string; value: number }[] = [];
    for (let w = 11; w >= 0; w--) {
      const to = now - w * 7 * DAY;
      const from = to - 7 * DAY;
      out.push({ label: '', value: revenueBetween(data, from, to) });
    }
    return out;
  }, [data, now]);

  const byWeekday = useMemo(() => {
    const counts = new Array(7).fill(0);
    for (const e of engagementsBetween(data, now - 56 * DAY, now)) {
      if (!e.noShow) counts[new Date(e.at).getDay()] += 1;
    }
    return counts;
  }, [data, now]);

  /** Top five payers all time, and what share of everything they represent. */
  const concentration = useMemo(() => {
    const byParty = new Map<string, number>();
    let total = 0;
    for (const m of data.money) {
      if (m.direction !== 'in' || m.status !== 'settled' || !m.partyId) continue;
      byParty.set(m.partyId, (byParty.get(m.partyId) ?? 0) + m.amount);
      total += m.amount;
    }
    const ranked = [...byParty.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([id, value]) => ({ id, name: index.partyById.get(id)?.name ?? 'Unknown', value }));

    const topTotal = ranked.reduce((s, r) => s + r.value, 0);
    return { top: ranked, topShare: total > 0 ? topTotal / total : 0 };
  }, [data.money, index]);

  const aging = useMemo(() => agingBuckets(data, now), [data, now]);

  /** Arrivals per month for the last six, oldest first. */
  const joining = useMemo(() => {
    const out: number[] = [];
    for (let back = 5; back >= 0; back--) {
      const from = new Date(now);
      from.setMonth(from.getMonth() - back, 1);
      from.setHours(0, 0, 0, 0);
      const to = new Date(from);
      to.setMonth(to.getMonth() + 1);
      out.push(
        data.parties.filter((p) => p.joinedAt >= from.getTime() && p.joinedAt < to.getTime()).length,
      );
    }
    return out;
  }, [data.parties, now]);

  /**
   * Payment methods over ninety days.
   *
   * Only counts entries where a method was actually recorded — an unlabelled
   * payment is a gap in the records, not evidence of cash, and quietly bucketing
   * it as cash would make the chart confidently wrong.
   */
  const methodMix = useMemo(() => {
    const map = new Map<string, number>();
    let total = 0;
    for (const m of data.money) {
      if (m.direction !== 'in' || m.status !== 'settled' || !m.method) continue;
      if (m.at < now - 90 * DAY) continue;
      map.set(m.method, (map.get(m.method) ?? 0) + m.amount);
      total += m.amount;
    }
    return [...map.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([method, amount]) => ({
        label: method.toUpperCase(),
        amount,
        share: total > 0 ? amount / total : 0,
      }));
  }, [data.money, now]);

  const groups = useMemo(() => cohorts(data, index, now, 6), [data, index, now]);
  const season = useMemo(() => seasonality(data, now), [data, now]);
  const calib = useMemo(() => calibration(data, now), [data, now]);
  const capture = useMemo(() => captureRead(data, now), [data, now]);
  const missed = useMemo(() => noShows(data, now), [data, now]);

  /*
    Sessions and attendances, which are not the same number.

    Fourteen students at one class is fourteen engagement records, so every
    count of engagements in this app was answering "how many attendances" while
    being labelled with the word for the event. `sessionRead` counts the events;
    `grouped` says whether this business runs anything group-shaped, so a garage
    — where one job is one customer — never sees a widget stating the same
    figure twice.
  */
  const sessions = useMemo(() => sessionRead(data, now - 56 * DAY, now), [data, now]);
  const words = useMemo(() => (profile ? sessionWords(profile) : null), [profile]);

  /**
   * The last six months of takings, oldest first.
   *
   * Calendar months rather than rolling thirty-day windows, because the strip is
   * labelled with month names and a bar labelled "Jul" that runs from the 12th
   * to the 11th is a quiet lie. The current month is partial by definition; the
   * caption says so rather than letting a short last bar read as a collapse.
   */
  const months = useMemo(() => {
    const out: { label: string; value: number; partial: boolean }[] = [];
    for (let back = 5; back >= 0; back--) {
      const from = new Date(now);
      from.setMonth(from.getMonth() - back, 1);
      from.setHours(0, 0, 0, 0);
      const to = new Date(from);
      to.setMonth(to.getMonth() + 1);
      out.push({
        label: monthName(from.getMonth()).slice(0, 3),
        value: revenueBetween(data, from.getTime(), to.getTime()),
        partial: back === 0,
      });
    }
    return out;
  }, [data, now]);

  /** Which month the header is showing. Defaults to this one. */
  const [monthAt, setMonthAt] = useState(5);

  const insets = useSafeAreaInsets();
  const barInset = useBarInset();

  /**
   * The bell scrolls to the findings rather than navigating.
   *
   * It used to push `/worklist`, which needs an `insight` parameter to have
   * anything to show — so the badge promised eight things and the screen it
   * opened was always empty. The findings are already on this page, further
   * down; taking the reader to them is both the truthful answer to "what needs
   * me" and one that cannot go stale.
   */
  const listRef = useAnimatedRef<Animated.ScrollView>();
  const [findingsY, setFindingsY] = useState<number | null>(null);

  const showFindings = () => {
    if (findingsY === null) return;
    // Stop just under the collapsed header, so the first finding is not sitting
    // beneath the colour when the scroll settles.
    listRef.current?.scrollTo({ y: Math.max(findingsY - insets.top - INSIGHTS_HERO_COLLAPSED - space.md, 0), animated: true });
  };

  /** Collapses the header, and takes the floating bar with it. */
  const scrollY = useSharedValue(0);
  const onScroll = useBarScrollHandler(scrollY);

  if (!profile) return null;

  const peakDay = Math.max(...byWeekday, 1);
  const autoShare = capture.total > 0 ? capture.automatic / capture.total : 0;
  const thisWeek = weeks[weeks.length - 1].value;

  /*
    Named only if there is a name to use.

    Falling back to the business name produced "Hi Gym, here's what's happening
    in Gym or fitness studio" — the trade name split at the first space and used
    as a person's, then repeated. Onboarding does not insist on an owner's name,
    so the unnamed case is the common one and has to read properly on its own.
  */
  const firstName = profile.ownerName?.trim().split(/\s+/)[0];
  const greeting = firstName
    ? `Hi ${firstName}, here's what's happening in ${profile.name}.`
    : `Here's what's happening in ${profile.name}.`;

  const picked = months[monthAt];
  const before = monthAt > 0 ? months[monthAt - 1] : undefined;
  const monthCaption = picked.partial
    ? `${picked.label} so far${
        before ? `, against ${money(before.value)} in all of ${before.label}` : ''
      }.`
    : before
      ? `${picked.label}, ${
          picked.value >= before.value ? 'up on' : 'down on'
        } ${before.label}'s ${money(before.value)}.`
      : `Everything taken in ${picked.label}.`;

  /*
    The one line the collapsed header keeps.

    Everything that named the figure — greeting, month strip, caption — is gone
    by the end of the collapse, which left a colour field with a number on it
    and no way to tell which month the number was. This says both, and it is
    the only thing on that band, so it has to be right rather than merely
    arithmetically true: four days of September against the whole of August
    reads as an 82% collapse, which is what every month does until its last
    week. A month still running is measured against the same days of the one
    before it, and the line says that is what it did.
  */
  const monthMeta = (() => {
    if (!picked) return '';
    if (!before) return picked.label;

    const from = new Date(now);
    from.setMonth(from.getMonth() - (months.length - 1 - monthAt), 1);
    from.setHours(0, 0, 0, 0);
    const to = new Date(from);
    to.setMonth(to.getMonth() + 1);

    const priorFrom = new Date(from);
    priorFrom.setMonth(priorFrom.getMonth() - 1);
    // Clamped at the month boundary, because the earlier month can be the
    // shorter one — thirty days into March would otherwise reach into March.
    const priorEnd = picked.partial
      ? Math.min(priorFrom.getTime() + (Math.min(to.getTime(), now) - from.getTime()), from.getTime())
      : from.getTime();

    const was = revenueBetween(data, priorFrom.getTime(), priorEnd);
    if (was <= 0) return picked.label;

    const change = Math.round(((picked.value - was) / was) * 100);
    const against = picked.partial ? `the same days in ${before.label}` : before.label;
    return `${picked.label} · ${change >= 0 ? '+' : ''}${change}% on ${against}`;
  })();

  return (
    /*
      Laid out by hand rather than through `LargeTitleScreen`, for the same
      reason home is: that scaffold owns the top of the screen — title, gutter,
      safe-area pad — and this screen's first element has to run edge to edge and
      up behind the status bar.

      The header is painted over the list rather than laid out beside it, and
      the list reserves its full height as top padding. That is what lets the
      header shrink in place first and only then scroll away — and it keeps the
      collapse out of the list's layout, which is what was making this screen
      lag.
    */
    <View style={styles.screen}>
      <Animated.ScrollView
        ref={listRef as AnimatedRef<Animated.ScrollView>}
        style={styles.scroller}
        showsVerticalScrollIndicator={false}
        scrollEventThrottle={16}
        onScroll={onScroll}
        contentContainerStyle={{
          paddingTop: insets.top + INSIGHTS_HERO_HEIGHT + space.lg,
          paddingBottom: insets.bottom + barInset + dockInset,
        }}>

      {/* --------------------------------------------------------- widgets -- */}
      {/*
        A deck of small readings before the prose.
        The findings below are the app's argument; these are the facts it is
        arguing from, and putting them first means a reader who disagrees with a
        finding can see what produced it rather than having to take it on trust.

        Colour is rationed deliberately. One feature widget carries a full
        gradient band, one progress bar carries a gradient fill, and everything
        else is plain surface — a screen where every card is a gradient is a
        wallpaper, and nothing on it can stand out.
      */}
      <Animated.View entering={enter(0)} style={[styles.gutter, styles.deck]}>
        {/*
          Two figures where there used to be one, and only when they differ.

          "Recorded per week" counted engagement records and labelled them with
          the word for the event — so a tuition centre running six classes a week
          for fourteen students each was told it ran eighty-four classes. The
          left widget now counts the events; the right one counts the heads.
        */}
        {sessions.grouped && words ? (
          <WidgetRow>
            <StatWidget
              label={`${words.session.many} per week`}
              value={String(Math.round(sessions.sessions / 8))}
              sub={`${sessions.sessions} in eight weeks`}
              icon={Activity}
              target={{
                kind: 'note',
                eyebrow: `${words.session.many} per week`,
                title: String(Math.round(sessions.sessions / 8)),
                body: `How many ${words.session.many.toLowerCase()} actually ran, averaged over the last eight weeks. This counts the events, not the people at them — everyone ticked off for one ${words.session.one.toLowerCase()} is a single ${words.session.one.toLowerCase()} here, however many of them there were.`,
                rows: [
                  { label: `${words.session.many} that ran`, value: String(sessions.sessions) },
                  { label: 'Attendances recorded', value: String(sessions.attendances) },
                  { label: 'Marked absent', value: String(sessions.noShows) },
                ],
              }}
            />
            <StatWidget
              label={`${term('party', true)} per ${words.session.one.toLowerCase()}`}
              value={sessions.perSession.toFixed(1)}
              sub={`${sessions.best} at the fullest`}
              icon={Users}
              target={{
                kind: 'note',
                eyebrow: `${term('party', true)} per ${words.session.one.toLowerCase()}`,
                title: sessions.perSession.toFixed(1),
                body: `The average number present when a ${words.session.one.toLowerCase()} runs. This is the figure that says whether the timetable fits the demand: a falling average with a steady headcount means the same people spread thinner, which costs the same to run and earns less.`,
                rows: [
                  { label: 'Fullest', value: String(sessions.best) },
                  { label: 'Attendances', value: String(sessions.attendances) },
                  { label: `${words.session.many} counted`, value: String(sessions.sessions) },
                ],
              }}
            />
          </WidgetRow>
        ) : null}

        <WidgetRow>
          <StatWidget
            label="Recorded per week"
            value={String(Math.round(engagementsBetween(data, now - 56 * DAY, now).length / 8))}
            sub={
              sessions.grouped && words
                ? `${words.attendance.many.toLowerCase()} on average`
                : `${term('engagement', true).toLowerCase()} on average`
            }
            icon={Activity}
            target={{
              kind: 'note',
              eyebrow: 'Recorded per week',
              title: String(Math.round(engagementsBetween(data, now - 56 * DAY, now).length / 8)),
              body: 'The average number of visits recorded per week over the last eight weeks. A falling average is usually a recording problem before it is a business problem — the visits happen and nobody writes them down.',
            }}
          />
          <StatWidget
            label="No-shows"
            value={`${Math.round(missed.rate * 100)}%`}
            sub={missed.count > 0 ? `${money(missed.cost)} of slots` : 'None recorded'}
            icon={CalendarX}
            target={{
              kind: 'note',
              eyebrow: 'No-shows',
              title: `${Math.round(missed.rate * 100)}%`,
              body: 'Booked and not attended, over the last eight weeks. A no-show consumed a slot somebody else could have had, so it costs more than an empty diary.',
            }}
          />
        </WidgetRow>

        {/* The only other gradient on the screen, and only across the fill. */}
        <ProgressWidget
          label="Recorded without typing"
          value={`${Math.round(autoShare * 100)}%`}
          caption={
            capture.zeroTypingDays > 0
              ? `${capture.zeroTypingDays} day${capture.zeroTypingDays === 1 ? '' : 's'} in the last thirty needed no typing at all.`
              : 'Everything in the last thirty days was entered by hand.'
          }
          progress={autoShare}
          gradient={['#2FD6C0', '#4CC97F']}
          target={{
            kind: 'note',
            eyebrow: 'Recorded without typing',
            title: `${Math.round(autoShare * 100)}%`,
            body: 'Of the records added in the last thirty days, the share that arrived from a schedule or a rule rather than being typed. This is the honest measure of whether the app is doing its job — every point of it is time an owner did not spend on admin.',
            rows: [
              { label: 'Arrived on their own', value: String(capture.automatic) },
              { label: 'Typed by hand', value: String(capture.manual) },
              { label: 'Days with no typing', value: String(capture.zeroTypingDays) },
            ],
          }}
        />

        <BarsWidget
          label="Busiest days"
          value={`${term('engagement', true).toLowerCase()}, 8 weeks`}
          bars={byWeekday.map((n) => n / peakDay)}
          labels={['S', 'M', 'T', 'W', 'T', 'F', 'S']}
          highlight={byWeekday.indexOf(Math.max(...byWeekday))}
          target={{
            kind: 'note',
            eyebrow: 'Busiest days',
            title: 'By weekday',
            body: 'Every visit recorded in the last eight weeks, grouped by the day of the week it fell on. Useful for staffing, and for knowing which day a quiet spell is actually coming from.',
          }}
        />

        <WidgetRow>
          <StatWidget
            label="Top five share"
            value={`${Math.round(concentration.topShare * 100)}%`}
            sub="of everything taken"
            icon={Crown}
            target={{
              kind: 'note',
              eyebrow: 'Top five share',
              title: `${Math.round(concentration.topShare * 100)}%`,
              body: 'What share of all money taken came from the five biggest payers. A high number is not automatically bad, but it is a concentration of risk: losing one of five is a very different event from losing one of fifty.',
            }}
          />
          <StatWidget
            label="Overdue"
            value={money(aging.filter((b) => b.label !== 'Not yet due').reduce((sum, b) => sum + b.amount, 0))}
            sub={`${aging.filter((b) => b.label !== 'Not yet due').reduce((sum, b) => sum + b.count, 0)} unpaid`}
            icon={Clock}
            target={{ kind: 'metric', metricKey: 'outstanding' }}
          />
        </WidgetRow>
      </Animated.View>

      {/* ------------------------------------------------------- findings -- */}
      <View onLayout={(e) => setFindingsY(e.nativeEvent.layout.y)} />
      {insights.length === 0 ? (
        <EmptyState
          art="sessions"
          title="Nothing stands out"
          body="Everything is tracking the way it normally does. This screen fills up when something moves — silence here is the app working, not the app empty."
        />
      ) : (
        <View style={styles.list}>
          {insights.map((insight, i) => (
            <Animated.View key={insight.id} entering={enter(i)}>
              <Deep
                target={{ kind: 'insight', insight }}
                haptic="light"
                scaleTo={0.99}
                style={[styles.finding, { backgroundColor: colors.surface }]}>
                <View style={styles.findingHead}>
                  <View
                    style={[
                      styles.dot,
                      {
                        backgroundColor:
                          insight.tone === 'good'
                            ? colors.success
                            : insight.tone === 'attention'
                              ? colors.warn
                              : colors.textFaint,
                      },
                    ]}
                  />
                  <AppText variant="caption" color="textFaint">
                    {insight.score > 0.45 ? 'strong' : insight.score > 0.25 ? 'moderate' : 'weak'} signal
                  </AppText>
                </View>

                <AppText variant="title3" style={styles.findingTitle}>
                  {insight.title}
                </AppText>
                <AppText variant="footnote" color="textDim" style={styles.findingDetail}>
                  {insight.detail}
                </AppText>

                {insight.action ? (
                  <Press
                    haptic="medium"
                    scaleTo={0.97}
                    onPress={() =>
                      router.push(
                        `/worklist?insight=${encodeURIComponent(insight.id)}&kind=${insight.action!.kind}` as never,
                      )
                    }
                    style={styles.findingLink}>
                    <AppText variant="footnote" tint={colors.accent}>
                      {insight.action.label}
                    </AppText>
                    <ArrowRight size={14} color={colors.accent} strokeWidth={2.4} />
                  </Press>
                ) : null}
              </Deep>
            </Animated.View>
          ))}
        </View>
      )}

      {/* -------------------------------------------------------- takings -- */}
      <Report
        index={0}
        title="Takings"
        trailing="12 weeks"
        note={`${money(thisWeek)} this week.`}
        explain={`Each bar is one week of money that actually arrived — settled payments only, so nothing invoiced and unpaid is counted here. Weeks run backwards from today rather than Monday to Sunday, which means the last bar is always a full seven days and never a part-week that looks like a collapse.`}
        rows={[
          { label: 'This week', value: money(thisWeek) },
          { label: 'Best of the twelve', value: money(Math.max(...weeks.map((w) => w.value))) },
          {
            label: 'Weekly average',
            value: money(weeks.reduce((s, w) => s + w.value, 0) / weeks.length),
          },
        ]}>
        <Bars
          bars={weeks.map((w, i) => ({ value: w.value, highlight: i === weeks.length - 1 }))}
          height={92}
        />
        {/*
          An axis row rather than a label on each bar. Twelve bars leaves about
          twenty-six points per cell, which is narrower than the word "now" —
          so the label clipped, and before the chart reserved a uniform label
          row it also pushed that single bar up above the others.
        */}
        <View style={styles.axis}>
          <AppText variant="caption" color="textFaint">
            12 weeks ago
          </AppText>
          <AppText variant="caption" color="textFaint">
            this week
          </AppText>
        </View>
      </Report>

      {/* --------------------------------------------------------- rhythm -- */}
      <Report
        index={1}
        title={`${term('engagement', true)} by day`}
        trailing="8 weeks"
        note={
          byWeekday.every((c) => c === 0)
            ? 'Nothing recorded yet.'
            : `${['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][byWeekday.indexOf(peakDay)]} is your busiest.`
        }
        explain={`Counted over the last eight weeks, with no-shows excluded — a booking nobody attended is not a busy day, and counting it would tell you to staff up for people who are not coming.\n\nThis is the number the quiet-day findings are measured against, so a genuinely closed day you have not declared will drag its weekday down and make every comparison to it look worse than it is.`}
        rows={[
          { label: 'Total over 8 weeks', value: String(byWeekday.reduce((s, c) => s + c, 0)) },
          { label: 'Busiest day', value: String(peakDay) },
          { label: 'Quietest day', value: String(Math.min(...byWeekday)) },
          { label: 'No-shows excluded', value: String(missed.count) },
        ]}>
        <Bars
          bars={byWeekday.map((count, i) => ({
            label: WEEKDAYS[i],
            value: count,
            highlight: count === peakDay,
          }))}
          height={92}
          tint={colors.success}
        />
      </Report>

      {/* -------------------------------------------------------- cohorts -- */}
      {groups.length >= 3 ? (
        <Report
          index={2}
          title="Who stays"
          trailing="by joining month"
          note="Each row is a month's intake; each column is how many were still coming that many months later. A column that fades faster than the ones above it is the earliest possible warning of a retention problem."
          explain={`Read it left to right: M0 is the month somebody joined, M1 the month after, and so on. The number is the percentage of that intake who came in at all during that month.\n\nCompare rows vertically, not horizontally. Every cohort fades — that is normal. What matters is whether a recent row is fading faster than an older one at the same age, because that is a change in your business rather than the ordinary passage of time.\n\nBlank cells are months that have not happened yet. They are not zeroes, and treating them as such is how retention charts get read as disasters.`}
          rows={[
            { label: 'Cohorts tracked', value: String(groups.length) },
            {
              label: 'Largest intake',
              value: `${Math.max(...groups.map((g) => g.size))} people`,
            },
          ]}>
          <CohortGrid rows={groups.slice(-7)} />
        </Report>
      ) : null}

      {/* ----------------------------------------------------- seasonality -- */}
      <Report
        index={3}
        title="Your year"
        trailing={season.usable ? 'all history' : 'not enough yet'}
        note={
          season.usable
            ? 'Built from your own history rather than from what is normal for your trade. Two businesses on the same street have different years.'
            : 'Needs more than a year of records before this means anything. Showing a confident curve through a few months would be an invention.'
        }>
        {season.usable ? (
          <Bars
            bars={season.points.map((p) => ({
              label: p.label.slice(0, 1),
              value: p.total,
              highlight: p.month === new Date(now).getMonth(),
            }))}
            height={80}
          />
        ) : (
          <View style={styles.pending}>
            <AppText variant="footnote" color="textFaint">
              {monthName(new Date(now).getMonth())} is the only version of this month it has seen.
            </AppText>
          </View>
        )}
      </Report>

      {/* ---------------------------------------------------- how accurate -- */}
      <Report
        index={4}
        title="How accurate this is"
        trailing={calib.samples > 0 ? `${calib.samples} checked` : 'untested'}
        note={calib.verdict}>
        <AppText variant="caption" color="textFaint" style={styles.reportBody}>
          Every night the app predicts the next day's takings and then checks itself against what
          actually happened. Most business software makes forecasts and never mentions how they did.
        </AppText>
      </Report>

      {/* ------------------------------------------------------- recording -- */}
      <Report
        index={5}
        title="How much you are typing"
        trailing="last 30 days"
        note={
          capture.total === 0
            ? 'Nothing recorded in the last month.'
            : `${Math.round((capture.automatic / capture.total) * 100)}% of records arrived without being typed. ${capture.zeroTypingDays} day${capture.zeroTypingDays === 1 ? '' : 's'} needed no typing at all.`
        }>
        <AppText variant="caption" color="textFaint" style={styles.reportBody}>
          The honest measure of whether this is working. Everything else on these screens is a proxy
          for it.
        </AppText>
      </Report>

      {/* -------------------------------------------------------- no-shows -- */}
      {missed.count > 0 ? (
        <Report
          index={6}
          title="No-shows"
          trailing="8 weeks"
          note={`${missed.count} booked and did not arrive — about ${Math.round(missed.rate * 100)}% of everything booked${missed.cost > 0 ? `, worth roughly ${money(missed.cost)}` : ''}.`}>
          <AppText variant="caption" color="textFaint" style={styles.reportBody}>
            A held slot nobody used costs more than an empty one, because somebody else could have
            had it.
          </AppText>
        </Report>
      ) : null}

      {/* ------------------------------------------------------ where money -- */}
      {concentration.top.length > 0 ? (
        <Report
          index={7}
          title="Where the money comes from"
          trailing="all time"
          note={
            concentration.topShare > 0.4
              ? `Your top five are ${Math.round(concentration.topShare * 100)}% of everything ever taken. That is a strong base and a real exposure at the same time.`
              : `Your top five are ${Math.round(concentration.topShare * 100)}% of everything ever taken — spread widely enough that no single departure would hurt much.`
          }
          explain={`Ranked by what each person has actually paid, all time, not by what they were charged or what a plan says they are worth.\n\nThe share is the number to watch rather than the names. Under about a fifth means no single customer can damage you; over about a half means the business has quietly become a handful of relationships, and losing one is an event rather than an inconvenience.`}>
          <View style={styles.ranks}>
            {concentration.top.map((row, i) => (
              <View key={row.id} style={styles.rankRow}>
                <AppText variant="caption" color="textFaint" tabular style={styles.rankNum}>
                  {i + 1}
                </AppText>
                <AppText variant="footnote" numberOfLines={1} style={styles.rankName}>
                  {row.name}
                </AppText>
                <View style={styles.rankTrack}>
                  <View
                    style={[
                      styles.rankFill,
                      {
                        width: `${(row.value / concentration.top[0].value) * 100}%`,
                        backgroundColor: i === 0 ? colors.accent : colors.surfaceHigh,
                      },
                    ]}
                  />
                </View>
                <AppText variant="caption" tabular color="textDim" style={styles.rankValue}>
                  {money(row.value)}
                </AppText>
              </View>
            ))}
          </View>
        </Report>
      ) : null}

      {/* ------------------------------------------------------- what is owed -- */}
      {aging.some((b) => b.amount > 0) ? (
        <Report
          index={8}
          title="How old the debt is"
          trailing={money(aging.reduce((s, b) => s + b.amount, 0))}
          note={
            aging[3].amount > 0
              ? `${money(aging[3].amount)} is past sixty days. Debt that old rarely settles without a conversation.`
              : 'Nothing has been outstanding longer than two months.'
          }
          explain={`Each band is how long past its due date the money has been sitting, not how long ago the work was done.\n\nAge predicts collection far better than size does. A large invoice raised last week is ordinary; a small one from four months ago is usually a sign that something went wrong in the relationship, and chasing it as though it were merely late tends not to work.`}
          rows={aging.map((b) => ({ label: b.label, value: money(b.amount) }))}>
          <StackedBar
            parts={[
              { value: aging[0].amount, color: colors.surfaceHigh },
              { value: aging[1].amount, color: colors.accent },
              { value: aging[2].amount, color: colors.warn },
              { value: aging[3].amount, color: colors.warn },
            ]}
            height={12}
          />
          <View style={styles.agingLegend}>
            {aging.map((bucket) => (
              <View key={bucket.label} style={styles.agingItem}>
                <AppText variant="footnote" tabular>
                  {money(bucket.amount)}
                </AppText>
                <AppText variant="caption" color="textFaint" numberOfLines={1}>
                  {bucket.label}
                </AppText>
              </View>
            ))}
          </View>
        </Report>
      ) : null}

      {/* ----------------------------------------------------- who arrives -- */}
      {joining.some((v) => v > 0) ? (
        <Report
          index={9}
          title="Who is arriving"
          trailing="6 months"
          note={
            joining[joining.length - 1] >= joining[joining.length - 2]
              ? `${joining[joining.length - 1]} joined this month, holding up against last.`
              : `${joining[joining.length - 1]} joined this month, down from ${joining[joining.length - 2]}.`
          }
          explain={`New arrivals per month. Read it next to the retention grid above — a business can look healthy on headcount while replacing everyone it loses, and the two charts together are the only way to see that happening.\n\nA month that has not finished yet will always look short. The last bar is partial until the month closes.`}>
          <Bars
            bars={joining.map((count, i) => ({
              label: monthName((new Date(now).getMonth() - 5 + i + 12) % 12).slice(0, 1),
              value: count,
              highlight: i === joining.length - 1,
            }))}
            height={78}
            formatPeak={(v) => String(Math.round(v))}
          />
        </Report>
      ) : null}

      {/* ------------------------------------------------------ paid how -- */}
      {methodMix.length > 0 ? (
        <Report
          index={10}
          title="How people pay"
          trailing="90 days"
          note={`${methodMix[0].label} is most of it — ${Math.round(methodMix[0].share * 100)}% of what came in.`}
          explain={`Counted from payments where a method was recorded. Anything settled without one is left out rather than guessed at, so this is a picture of what you have written down.\n\nWorth watching for drift rather than a snapshot: a shop whose cash share falls steadily is one whose till float and banking routine should change with it.`}
          rows={methodMix.map((m) => ({
            label: m.label,
            value: `${money(m.amount)} · ${Math.round(m.share * 100)}%`,
          }))}>
          <StackedBar
            parts={methodMix.map((m, i) => ({
              value: m.amount,
              color: [colors.accent, colors.success, colors.warn, colors.textFaint][i % 4],
            }))}
            height={12}
          />
          <View style={styles.methodLegend}>
            {methodMix.map((m, i) => (
              <View key={m.label} style={styles.methodItem}>
                <View
                  style={[
                    styles.methodDot,
                    {
                      backgroundColor: [
                        colors.accent,
                        colors.success,
                        colors.warn,
                        colors.textFaint,
                      ][i % 4],
                    },
                  ]}
                />
                <AppText variant="caption" color="textDim">
                  {m.label}
                </AppText>
              </View>
            ))}
          </View>
        </Report>
      ) : null}

      {/* ---------------------------------------------------------- wrapped -- */}
      <Animated.View entering={enter(11)} style={[styles.gutter, styles.block]}>
        <Press
          haptic="medium"
          scaleTo={0.97}
          onPress={() => router.push('/wrapped' as never)}
          accessibilityLabel="Open the story of your month"
          style={[styles.wrapEntry, { backgroundColor: colors.accentSoft }]}>
          <Sparkles size={18} color={colors.accent} strokeWidth={2} />
          <View style={styles.wrapBody}>
            <AppText variant="callout" tint={colors.accent}>
              Your month, as a story
            </AppText>
            <AppText variant="caption" color="textFaint">
              What came in, who was new, who came back — worth showing someone
            </AppText>
          </View>
          <ArrowRight size={16} color={colors.accent} strokeWidth={2.2} />
        </Press>
      </Animated.View>

      {/* ------------------------------------------------------- explainer -- */}
      <Animated.View entering={enter(7)} style={[styles.gutter, styles.block]}>
        <View style={[styles.explainer, { backgroundColor: colors.surface }]}>
          <Info size={16} color={colors.textDim} strokeWidth={1.9} />
          <AppText variant="caption" color="textFaint" style={styles.explainerText}>
            Findings are scored on three things multiplied together: how unusual they are for this
            business, how much money or how many people they touch, and whether there is anything
            still to be done about them. A zero on any one removes the finding entirely. Weak signals
            appear here but never on the home screen — long-press any of them to see the evidence.
          </AppText>
        </View>
      </Animated.View>
      </Animated.ScrollView>

      {/* After the list, so it paints over it. */}
      <InsightsHero
        greeting={greeting}
        months={months}
        at={monthAt}
        onPick={setMonthAt}
        value={money(months[monthAt].value)}
        caption={monthCaption}
        topInset={insets.top}
        scrollY={scrollY}
        meta={monthMeta}
        gradient={INSIGHTS_FIELD}
        target={{ kind: 'metric', metricKey: 'revenue' }}
        right={
          <>
            <HeadButton
              icon={CalendarDays}
              label="What is booked"
              onPress={() => router.push('/schedule' as never)}
            />
            <HeadButton
              icon={Bell}
              label={
                insights.length > 0 ? `${insights.length} findings to look at` : 'Nothing needs you'
              }
              count={insights.length}
              onPress={showFindings}
            />
          </>
        }
      />
    </View>
  );
}

/**
 * One of the two round controls in the header.
 *
 * Both go somewhere real. The reference this header follows had a mail icon,
 * which this app has no mail to put behind — an icon that opens nothing is a
 * screenshot, not an interface, so it is a diary and a findings count instead.
 */
function HeadButton({
  icon: Icon,
  label,
  count,
  onPress,
}: {
  icon: LucideIcon;
  label: string;
  count?: number;
  onPress: () => void;
}) {
  return (
    <Press
      haptic="light"
      scaleTo={0.9}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={styles.headButton}>
      <Icon size={18} color="#FFFFFF" strokeWidth={2} />
      {count && count > 0 ? (
        <View style={styles.headCount}>
          <AppText variant="caption" tint="#0B0B0F" style={styles.headCountText}>
            {count > 9 ? '9+' : count}
          </AppText>
        </View>
      ) : null}
    </Press>
  );
}

/**
 * A section of the report.
 *
 * Chart first, then the sentence that says what it means. The sentence is not
 * optional: a chart nobody can read is decoration, and the one line underneath
 * is usually the only part that changes behaviour.
 */
function Report({
  index,
  title,
  trailing,
  note,
  explain,
  rows,
  children,
}: {
  index: number;
  title: string;
  trailing?: string;
  note?: string;
  /** Long-press body. Every chart on this screen can be interrogated. */
  explain?: string;
  rows?: { label: string; value: string }[];
  children: React.ReactNode;
}) {
  const colors = useColors();
  const { enter } = useMotion();

  const body = (
    <>
      {children}
      {note ? (
        <AppText variant="footnote" color="textDim" style={styles.reportNote}>
          {note}
        </AppText>
      ) : null}
    </>
  );

  return (
    <Animated.View entering={enter(index)} style={[styles.gutter, styles.block]}>
      <View style={styles.reportHead}>
        <AppText variant="title3">{title}</AppText>
        {trailing ? (
          <AppText variant="caption" color="textFaint">
            {trailing}
          </AppText>
        ) : null}
      </View>

      {explain ? (
        <Deep
          target={{ kind: 'note', eyebrow: trailing ?? 'Chart', title, body: explain, rows }}
          haptic="light"
          scaleTo={0.99}
          accessibilityLabel={`${title}. Long press to read how this is worked out.`}
          style={[styles.report, { backgroundColor: colors.surface }]}>
          {body}
        </Deep>
      ) : (
        <View style={[styles.report, { backgroundColor: colors.surface }]}>{body}</View>
      )}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  gutter: { paddingHorizontal: space.gutter },
  headButton: {
    width: 36,
    height: 36,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.22)',
  },
  headCount: {
    position: 'absolute',
    top: -2,
    right: -2,
    minWidth: 16,
    height: 16,
    borderRadius: radius.pill,
    paddingHorizontal: 4,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
  },
  headCountText: { fontSize: 10 },
  block: { marginTop: space.xl },

  list: { paddingHorizontal: space.gutter, gap: space.sm },
  screen: { flex: 1 },
  scroller: { flex: 1 },
  deck: { gap: space.sm, marginBottom: space.lg },
  finding: { borderRadius: radius.lg, padding: space.base },
  findingHead: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  dot: { width: 6, height: 6, borderRadius: radius.pill },
  findingTitle: { marginTop: space.sm },
  findingDetail: { marginTop: 4, lineHeight: 19 },
  findingLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    marginTop: space.md,
    alignSelf: 'flex-start',
  },

  reportHead: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    marginBottom: space.md,
  },
  report: { borderRadius: radius.lg, padding: space.base },
  reportNote: { marginTop: space.base, lineHeight: 18 },
  axis: { flexDirection: 'row', justifyContent: 'space-between', marginTop: space.sm },

  ranks: { gap: space.sm },
  rankRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  rankNum: { width: 12 },
  rankName: { width: 92 },
  rankTrack: { flex: 1, height: 8, borderRadius: radius.pill, overflow: 'hidden' },
  rankFill: { height: '100%', borderRadius: radius.pill },
  rankValue: { width: 52, textAlign: 'right' },

  agingLegend: { flexDirection: 'row', gap: space.sm, marginTop: space.md },
  agingItem: { flex: 1, gap: 1 },

  methodLegend: { flexDirection: 'row', flexWrap: 'wrap', gap: space.md, marginTop: space.md },
  methodItem: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  methodDot: { width: 8, height: 8, borderRadius: radius.pill },

  wrapEntry: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    padding: space.base,
    borderRadius: radius.lg,
  },
  wrapBody: { flex: 1, gap: 2 },
  reportBody: { lineHeight: 17 },
  pending: { paddingVertical: space.lg, alignItems: 'center' },

  explainer: {
    flexDirection: 'row',
    gap: space.md,
    alignItems: 'flex-start',
    padding: space.base,
    borderRadius: radius.lg,
  },
  explainerText: { flex: 1, lineHeight: 17 },
});
