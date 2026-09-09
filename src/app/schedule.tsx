import { useRouter } from 'expo-router';
import {
  ArrowLeft,
  CalendarOff,
  Check,
  Pencil,
  Plus,
  TriangleAlert,
} from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText } from '@/components/AppText';
import { Calendar } from '@/components/Calendar';
import { EmptyState } from '@/components/EmptyState';
import { Press } from '@/components/Press';
import { Sheet } from '@/components/Sheet';
import { TextField } from '@/components/TextField';
import { Toggle } from '@/components/Toggle';
import { startOfDay } from '@/domain/analytics';
import type { Template } from '@/domain/model';
import { plural } from '@/domain/words';
import {
  clashes,
  clockToMinutes,
  describeTemplate,
  minutesToClock,
  occurrencesBetween,
  unrecorded,
  WEEKDAY_LONG,
  WEEKDAY_SHORT,
} from '@/domain/schedule';
import { useMotion } from '@/design/motion';
import { useColors } from '@/design/theme';
import { radius, space } from '@/design/tokens';
import { formatDateMedium, formatTime, useTick } from '@/lib/time';
import { useBarInset } from '@/state/dock';
import { useBusiness } from '@/state/business';
import { useUndo } from '@/state/undo';

const DAY = 24 * 60 * 60 * 1000;

type Draft = {
  id?: string;
  name: string;
  clock: string;
  weekdays: number[];
  durationMin: string;
  staffId: string | null;
  partyIds: string[];
};

const EMPTY: Draft = {
  name: '',
  clock: '17:30',
  weekdays: [1, 3, 5],
  durationMin: '60',
  staffId: null,
  partyIds: [],
};

/**
 * The timetable.
 *
 * Two views of the same thing, because owners ask two different questions of a
 * schedule. "What is on today" is a calendar; "when does Batch A actually run"
 * is a list of rules. Answering only the first makes changing a time impossible;
 * answering only the second makes it impossible to see a week.
 */
export default function ScheduleScreen() {
  const colors = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const barInset = useBarInset();
  const { enter } = useMotion();
  const { offerUndo } = useUndo();
  const {
    profile,
    data,
    addTemplate,
    updateTemplate,
    removeTemplate,
    addClosure,
    removeClosure,
  } = useBusiness();
  const now = useTick(60_000);

  const [monthOf, setMonthOf] = useState(() => startOfDay(Date.now()));
  const [selected, setSelected] = useState(() => startOfDay(Date.now()));
  const [editing, setEditing] = useState<Draft | null>(null);

  const dayOccurrences = useMemo(
    () => occurrencesBetween(data, selected, selected + DAY - 1),
    [data, selected],
  );
  const missed = useMemo(() => unrecorded(data, now), [data, now]);
  const conflicts = useMemo(() => clashes(data), [data]);

  const closure = data.closures.find((c) => startOfDay(c.date) === selected);

  if (!profile) return null;

  const term = profile.vocabulary.engagement;

  const save = () => {
    if (!editing) return;
    const minuteOfDay = clockToMinutes(editing.clock);
    if (minuteOfDay === null || editing.name.trim().length < 2) return;

    const patch = {
      name: editing.name.trim(),
      minuteOfDay,
      weekdays: editing.weekdays.slice().sort(),
      durationMin: Number(editing.durationMin) || 60,
      staffId: editing.staffId,
      partyIds: editing.partyIds,
      active: true,
    };

    if (editing.id) updateTemplate(editing.id, patch);
    else addTemplate({ ...patch, offeringId: null, resourceId: null });

    setEditing(null);
  };

  const openFor = (template: Template) =>
    setEditing({
      id: template.id,
      name: template.name,
      clock: minutesToClock(template.minuteOfDay),
      weekdays: template.weekdays,
      durationMin: String(template.durationMin ?? 60),
      staffId: template.staffId ?? null,
      partyIds: template.partyIds,
    });

  const validClock = clockToMinutes(editing?.clock ?? '') !== null;
  const validDraft = Boolean(editing && editing.name.trim().length >= 2 && validClock);

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
          <AppText variant="title3">Timetable</AppText>
          <AppText variant="caption" color="textFaint">
            {data.templates.filter((t) => t.active).length} running
          </AppText>
        </View>
        <Press
          haptic="medium"
          scaleTo={0.9}
          onPress={() => setEditing({ ...EMPTY, name: '' })}
          accessibilityLabel={`Add a ${term.one.toLowerCase()}`}
          style={[styles.iconButton, { backgroundColor: colors.accent }]}>
          <Plus size={18} color={colors.accentText} strokeWidth={2.6} />
        </Press>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + barInset }]}>
        {/* ------------------------------------------------------ calendar */}
        <Animated.View entering={enter(0)} style={styles.gutter}>
          <Calendar
            data={data}
            monthOf={monthOf}
            selected={selected}
            now={now}
            onSelect={setSelected}
            onMonth={(delta) => {
              const d = new Date(monthOf);
              d.setMonth(d.getMonth() + delta, 1);
              setMonthOf(d.getTime());
            }}
          />
        </Animated.View>

        {/* ----------------------------------------------------- the day -- */}
        <Animated.View entering={enter(1)} style={[styles.gutter, styles.block]}>
          <View style={styles.sectionHead}>
            <AppText variant="caption" color="textFaint" style={styles.label}>
              {formatDateMedium(selected).toUpperCase()}
            </AppText>
            <Press
              haptic="light"
              scaleTo={0.96}
              onPress={() => {
                if (closure) {
                  removeClosure(closure.id);
                  offerUndo('Marked open', () =>
                    addClosure({ date: selected, label: closure.label }),
                  );
                } else {
                  addClosure({ date: selected, label: 'Closed' });
                  offerUndo('Marked closed', () => {
                    const made = data.closures.find((c) => startOfDay(c.date) === selected);
                    if (made) removeClosure(made.id);
                  });
                }
              }}
              style={styles.closeToggle}>
              <CalendarOff size={13} color={colors.textFaint} strokeWidth={2} />
              <AppText variant="caption" color="textFaint">
                {closure ? 'Mark open' : 'Mark closed'}
              </AppText>
            </Press>
          </View>

          {closure ? (
            <View style={[styles.notice, { backgroundColor: colors.surfaceHigh }]}>
              <AppText variant="footnote" color="textDim">
                Closed for {closure.label}. Nothing is expected, and no quiet-day findings are
                raised for it.
              </AppText>
            </View>
          ) : dayOccurrences.length === 0 ? (
            <View style={[styles.notice, { backgroundColor: colors.surface }]}>
              <AppText variant="footnote" color="textFaint">
                Nothing scheduled. Add a {term.one.toLowerCase()} and it appears on every matching
                day from now on.
              </AppText>
            </View>
          ) : (
            <View style={styles.rows}>
              {dayOccurrences.map((o) => {
                const staff = o.staffId ? data.staff.find((s) => s.id === o.staffId) : null;
                const past = o.at < now;
                return (
                  <View
                    key={o.id}
                    style={[styles.occurrence, { backgroundColor: colors.surface }]}>
                    <View style={styles.occTime}>
                      <AppText variant="callout" tabular>
                        {formatTime(o.at)}
                      </AppText>
                      <AppText variant="caption" color="textFaint">
                        {o.durationMin}m
                      </AppText>
                    </View>

                    <View style={styles.occBody}>
                      <AppText variant="callout" numberOfLines={1}>
                        {o.name}
                      </AppText>
                      <AppText variant="caption" color="textFaint" numberOfLines={1}>
                        {o.partyIds.length} {plural(o.partyIds.length, profile.vocabulary.party).toLowerCase()}
                        {staff ? ` · ${staff.name}` : ''}
                      </AppText>
                    </View>

                    {o.recorded ? (
                      <View style={[styles.tick, { backgroundColor: colors.successSoft }]}>
                        <Check size={14} color={colors.success} strokeWidth={2.6} />
                      </View>
                    ) : past ? (
                      <Press
                        haptic="medium"
                        scaleTo={0.94}
                        onPress={() => router.push('/capture' as never)}
                        style={[styles.recordCta, { backgroundColor: colors.accentSoft }]}>
                        <AppText variant="caption" tint={colors.accent}>
                          Record
                        </AppText>
                      </Press>
                    ) : null}
                  </View>
                );
              })}
            </View>
          )}
        </Animated.View>

        {/* --------------------------------------------------- unrecorded -- */}
        {missed.length > 0 ? (
          <Animated.View entering={enter(2)} style={[styles.gutter, styles.block]}>
            <AppText variant="caption" color="textFaint" style={styles.label}>
              RAN BUT NEVER RECORDED
            </AppText>
            <View style={[styles.notice, { backgroundColor: colors.surface }]}>
              <AppText variant="footnote" color="textDim" style={styles.noticeText}>
                {missed.length} {missed.length === 1 ? 'session' : 'sessions'} in the last fortnight
                left no attendance behind. Every number in this app reads those records, so gaps
                here quietly make everything else look worse than it is.
              </AppText>
              <Press
                haptic="medium"
                scaleTo={0.97}
                onPress={() => router.push('/capture' as never)}
                style={[styles.catchUp, { backgroundColor: colors.accent }]}>
                <AppText variant="footnote" tint={colors.accentText}>
                  Catch up
                </AppText>
              </Press>
            </View>
          </Animated.View>
        ) : null}

        {/* ---------------------------------------------------- the rules -- */}
        <Animated.View entering={enter(3)} style={[styles.gutter, styles.block]}>
          <AppText variant="caption" color="textFaint" style={styles.label}>
            WHEN THINGS RUN
          </AppText>

          {data.templates.length === 0 ? (
            <EmptyState
              art="calendar"
              title="No timetable yet"
              body={`Set up when your ${term.many.toLowerCase()} run and the app can record a whole session with one tap instead of one entry per person.`}
              action={{
                label: `Add a ${term.one.toLowerCase()}`,
                onPress: () => setEditing({ ...EMPTY }),
              }}
            />
          ) : (
            <View style={styles.rows}>
              {data.templates.map((template) => {
                const conflict = conflicts.find(
                  (c) => c.a.id === template.id || c.b.id === template.id,
                );
                const staff = template.staffId
                  ? data.staff.find((s) => s.id === template.staffId)
                  : null;

                return (
                  <View key={template.id} style={[styles.rule, { backgroundColor: colors.surface }]}>
                    <Press
                      haptic="light"
                      scaleTo={0.99}
                      onPress={() => openFor(template)}
                      accessibilityLabel={`Edit ${template.name}`}
                      style={styles.ruleHead}>
                      <View style={styles.ruleBody}>
                        <AppText variant="callout" numberOfLines={1}>
                          {template.name}
                        </AppText>
                        <AppText variant="caption" color="textFaint" numberOfLines={1}>
                          {describeTemplate(template)} · {template.partyIds.length}{' '}
                          {plural(template.partyIds.length, profile.vocabulary.party).toLowerCase()}
                          {staff ? ` · ${staff.name}` : ''}
                        </AppText>
                      </View>
                      <Pencil size={15} color={colors.textFaint} strokeWidth={2} />
                      <Toggle
                        value={template.active}
                        onChange={(next) => updateTemplate(template.id, { active: next })}
                      />
                    </Press>

                    {conflict ? (
                      <View style={styles.conflict}>
                        <TriangleAlert size={13} color={colors.warn} strokeWidth={2} />
                        <AppText variant="caption" tint={colors.warn} style={styles.conflictText}>
                          Overlaps {conflict.a.id === template.id ? conflict.b.name : conflict.a.name}{' '}
                          on {WEEKDAY_LONG[conflict.weekday]} — same{' '}
                          {conflict.a.staffId && conflict.a.staffId === conflict.b.staffId
                            ? 'person'
                            : 'room'}.
                        </AppText>
                      </View>
                    ) : null}
                  </View>
                );
              })}
            </View>
          )}
        </Animated.View>
      </ScrollView>

      {/* ------------------------------------------------------- the editor */}
      <Sheet
        visible={editing !== null}
        onClose={() => setEditing(null)}
        size="tall"
        eyebrow={editing?.id ? 'Edit' : 'New'}
        title={editing?.id ? editing.name || term.one : `Add a ${term.one.toLowerCase()}`}
        footer={
          <>
            <Press
              haptic="medium"
              scaleTo={0.97}
              disabled={!validDraft}
              onPress={save}
              style={[styles.cta, { backgroundColor: colors.accent }]}>
              <AppText variant="callout" tint={colors.accentText}>
                {editing?.id ? 'Save changes' : 'Add it'}
              </AppText>
            </Press>

            {editing?.id ? (
              <Press
                haptic="medium"
                scaleTo={0.97}
                onPress={() => {
                  const template = data.templates.find((t) => t.id === editing.id);
                  removeTemplate(editing.id as string);
                  setEditing(null);
                  offerUndo(`${template?.name ?? 'Schedule'} removed`, () => {
                    if (template) addTemplate({ ...template });
                  });
                }}
                style={[styles.ctaGhost, { borderColor: colors.hairlineStrong }]}>
                <AppText variant="callout" tint={colors.warn}>
                  Remove this schedule
                </AppText>
              </Press>
            ) : null}
          </>
        }>
        {editing ? (
          <View style={styles.form}>
            <TextField
              label="What is it called"
              placeholder={`Batch A, Evening ${term.one.toLowerCase()}`}
              value={editing.name}
              onChangeText={(name) => setEditing({ ...editing, name })}
            />

            <View style={styles.pair}>
              <View style={styles.pairItem}>
                <TextField
                  label="Starts at"
                  placeholder="17:30"
                  value={editing.clock}
                  onChangeText={(clock) => setEditing({ ...editing, clock })}
                  keyboardType="numbers-and-punctuation"
                />
              </View>
              <View style={styles.pairItem}>
                <TextField
                  label="Minutes"
                  placeholder="60"
                  value={editing.durationMin}
                  onChangeText={(durationMin) => setEditing({ ...editing, durationMin })}
                  keyboardType="numeric"
                />
              </View>
            </View>

            {editing.clock.length > 0 && !validClock ? (
              <AppText variant="caption" tint={colors.warn}>
                Use a 24-hour time like 17:30.
              </AppText>
            ) : null}

            <AppText variant="caption" color="textFaint" style={styles.fieldLabel}>
              WHICH DAYS
            </AppText>
            <View style={styles.days}>
              {WEEKDAY_SHORT.map((letter, i) => {
                const on = editing.weekdays.includes(i);
                return (
                  <Press
                    key={i}
                    haptic="selection"
                    scaleTo={0.9}
                    onPress={() =>
                      setEditing({
                        ...editing,
                        weekdays: on
                          ? editing.weekdays.filter((d) => d !== i)
                          : [...editing.weekdays, i],
                      })
                    }
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: on }}
                    accessibilityLabel={WEEKDAY_LONG[i]}
                    style={[
                      styles.dayChip,
                      { backgroundColor: on ? colors.accent : colors.surfaceHigh },
                    ]}>
                    <AppText variant="footnote" tint={on ? colors.accentText : colors.textDim}>
                      {letter}
                    </AppText>
                  </Press>
                );
              })}
            </View>

            {data.staff.filter((s) => s.active !== false).length > 0 ? (
              <>
                <AppText variant="caption" color="textFaint" style={styles.fieldLabel}>
                  WHO RUNS IT
                </AppText>
                <View style={styles.chips}>
                  {data.staff
                    .filter((s) => s.active !== false)
                    .map((s) => {
                      const on = editing.staffId === s.id;
                      return (
                        <Press
                          key={s.id}
                          haptic="selection"
                          scaleTo={0.95}
                          onPress={() => setEditing({ ...editing, staffId: on ? null : s.id })}
                          accessibilityRole="radio"
                          accessibilityState={{ selected: on }}
                          style={[
                            styles.chip,
                            { backgroundColor: on ? colors.accent : colors.surfaceHigh },
                          ]}>
                          <AppText variant="footnote" tint={on ? colors.accentText : colors.text}>
                            {s.name}
                          </AppText>
                        </Press>
                      );
                    })}
                </View>
              </>
            ) : null}

            <View style={styles.sectionHead}>
              <AppText variant="caption" color="textFaint" style={styles.fieldLabel}>
                WHO IS IN IT · {editing.partyIds.length}
              </AppText>
              <Press
                haptic="light"
                scaleTo={0.96}
                onPress={() =>
                  setEditing({
                    ...editing,
                    partyIds:
                      editing.partyIds.length === 0
                        ? data.parties.filter((p) => !p.archivedAt).map((p) => p.id)
                        : [],
                  })
                }
                style={styles.selectAll}>
                <AppText variant="caption" tint={colors.accent}>
                  {editing.partyIds.length === 0 ? 'Add everyone' : 'Clear'}
                </AppText>
              </Press>
            </View>

            <View style={styles.chips}>
              {data.parties
                .filter((p) => !p.archivedAt)
                .slice(0, 40)
                .map((p) => {
                  const on = editing.partyIds.includes(p.id);
                  return (
                    <Press
                      key={p.id}
                      haptic="selection"
                      scaleTo={0.95}
                      onPress={() =>
                        setEditing({
                          ...editing,
                          partyIds: on
                            ? editing.partyIds.filter((id) => id !== p.id)
                            : [...editing.partyIds, p.id],
                        })
                      }
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: on }}
                      style={[
                        styles.chip,
                        { backgroundColor: on ? colors.accent : colors.surfaceHigh },
                      ]}>
                      <AppText variant="footnote" tint={on ? colors.accentText : colors.text}>
                        {p.name}
                      </AppText>
                    </Press>
                  );
                })}
            </View>

            <AppText variant="caption" color="textFaint" style={styles.hint}>
              Changing a time changes it from today onwards. Sessions already recorded keep the time
              they actually ran at.
            </AppText>
          </View>
        ) : null}
      </Sheet>
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
  label: { letterSpacing: 0.9 },
  sectionHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: space.sm,
  },
  closeToggle: { flexDirection: 'row', alignItems: 'center', gap: space.xs, paddingVertical: 2 },

  rows: { gap: space.sm },
  notice: { padding: space.base, borderRadius: radius.md, gap: space.md },
  noticeText: { lineHeight: 18 },
  catchUp: {
    alignSelf: 'flex-start',
    paddingHorizontal: space.base,
    height: 32,
    borderRadius: radius.pill,
    justifyContent: 'center',
  },

  occurrence: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    padding: space.base,
    borderRadius: radius.md,
  },
  occTime: { width: 62, gap: 1 },
  occBody: { flex: 1, gap: 2 },
  tick: {
    width: 28,
    height: 28,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  recordCta: {
    paddingHorizontal: space.md,
    height: 30,
    borderRadius: radius.pill,
    justifyContent: 'center',
  },

  rule: { borderRadius: radius.lg, padding: space.base, gap: space.sm },
  ruleHead: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  ruleBody: { flex: 1, gap: 2 },
  conflict: { flexDirection: 'row', alignItems: 'flex-start', gap: space.sm },
  conflictText: { flex: 1, lineHeight: 16 },

  form: { gap: space.md },
  fieldLabel: { letterSpacing: 0.9 },
  pair: { flexDirection: 'row', gap: space.md },
  pairItem: { flex: 1 },
  days: { flexDirection: 'row', gap: space.xs },
  dayChip: {
    flex: 1,
    height: 40,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  chip: {
    paddingHorizontal: space.md,
    height: 34,
    borderRadius: radius.pill,
    justifyContent: 'center',
  },
  selectAll: { paddingVertical: 2 },
  hint: { lineHeight: 16, marginTop: space.xs },

  cta: { height: 50, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  ctaGhost: {
    height: 48,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
  },
});
