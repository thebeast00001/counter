import { useRouter } from 'expo-router';
import { ArrowLeft, Phone, Plus, TriangleAlert, UserMinus } from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText } from '@/components/AppText';
import { Bars, Ring } from '@/components/Charts';
import { EmptyState } from '@/components/EmptyState';
import { Press } from '@/components/Press';
import { Segmented } from '@/components/Segmented';
import { Sheet } from '@/components/Sheet';
import { TextField } from '@/components/TextField';
import { Toggle } from '@/components/Toggle';
import { staffRead } from '@/domain/analytics';
import { money } from '@/domain/metrics';
import type { Staff, StaffRole } from '@/domain/model';
import { describeTemplate } from '@/domain/schedule';
import { useMotion } from '@/design/motion';
import { useColors } from '@/design/theme';
import { radius, space } from '@/design/tokens';
import { openCall } from '@/lib/contact';
import { useTick } from '@/lib/time';
import { useBarInset } from '@/state/dock';
import { useBusiness, useIndex } from '@/state/business';
import { useUndo } from '@/state/undo';

/**
 * Access levels, in the owner's terms rather than the software's.
 *
 * "Staff" hiding money is the single most requested thing from owners who will
 * not otherwise let anybody near their books, so it is spelled out rather than
 * left to be inferred from a role name.
 */
const ACCESS: { value: StaffRole; label: string; meaning: string }[] = [
  { value: 'owner', label: 'Owner', meaning: 'Sees everything, including all money and settings.' },
  {
    value: 'manager',
    label: 'Manager',
    meaning: 'Runs the day — records, people and payments, but not the setup.',
  },
  {
    value: 'staff',
    label: 'Staff',
    meaning: 'Records who turned up. Never sees takings, debts or anyone else’s pay.',
  },
];

/**
 * Who works here, and how their part of the business is actually doing.
 *
 * The point of this screen is the second half. A staff list is an address book;
 * what an owner needs is whether the people assigned to someone are staying, and
 * that number is invisible in every tool they have ever used. Takings alone
 * rewards whoever was handed the best customers.
 */
export default function TeamScreen() {
  const colors = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const barInset = useBarInset();
  const { enter } = useMotion();
  const { offerUndo } = useUndo();
  const { profile, data, addStaff, updateStaff, removeStaff } = useBusiness();
  const index = useIndex();
  const now = useTick(300_000);

  const [sheet, setSheet] = useState(false);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');

  const active = useMemo(() => data.staff.filter((s) => s.active !== false), [data.staff]);
  const past = useMemo(() => data.staff.filter((s) => s.active === false), [data.staff]);

  const reads = useMemo(
    () => new Map(data.staff.map((s) => [s.id, staffRead(data, index, s.id, now)])),
    [data, index, now],
  );

  if (!profile) return null;

  const term = profile.vocabulary.person;
  const peak = Math.max(...active.map((s) => reads.get(s.id)?.revenue ?? 0), 1);

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
          <AppText variant="title3">{term.many}</AppText>
          <AppText variant="caption" color="textFaint">
            {active.length} working · last 8 weeks
          </AppText>
        </View>
        <Press
          haptic="medium"
          scaleTo={0.9}
          onPress={() => {
            setName('');
            setPhone('');
            setSheet(true);
          }}
          accessibilityLabel={`Add a ${term.one.toLowerCase()}`}
          style={[styles.iconButton, { backgroundColor: colors.accent }]}>
          <Plus size={18} color={colors.accentText} strokeWidth={2.6} />
        </Press>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + barInset }]}>
        {active.length === 0 ? (
          <EmptyState
            art="tasks"
            title={`Nobody on the books`}
            body={`Add whoever works with you and the app can show ${profile.vocabulary.engagement.many.toLowerCase()}, takings and — the number nobody else measures — whether their people are staying.`}
            action={{ label: `Add a ${term.one.toLowerCase()}`, onPress: () => setSheet(true) }}
          />
        ) : (
          <>
            {/* -------------------------------------------------- comparison */}
            {active.length > 1 ? (
              <Animated.View entering={enter(0)} style={styles.gutter}>
                <AppText variant="caption" color="textFaint" style={styles.label}>
                  TAKINGS BY {term.one.toUpperCase()}
                </AppText>
                <View style={[styles.card, { backgroundColor: colors.surface }]}>
                  <Bars
                    bars={active.map((s) => ({
                      label: s.name.split(' ')[0],
                      value: reads.get(s.id)?.revenue ?? 0,
                      highlight: (reads.get(s.id)?.revenue ?? 0) === peak,
                    }))}
                    height={78}
                    formatPeak={money}
                  />
                  <AppText variant="caption" color="textFaint" style={styles.cardNote}>
                    Attributed from recorded sessions. Whoever is handed the best customers will
                    lead this chart regardless of how well they work — read it beside retention
                    below, never on its own.
                  </AppText>
                </View>
              </Animated.View>
            ) : null}

            {/* ------------------------------------------------------ people */}
            <View style={styles.list}>
              {active.map((member, i) => (
                <Animated.View key={member.id} entering={enter(i + 1)}>
                  <Member
                    member={member}
                    read={reads.get(member.id)}
                    templates={data.templates.filter((t) => t.staffId === member.id && t.active)}
                    onAccess={(access) => updateStaff(member.id, { access })}
                    onActive={(next) => updateStaff(member.id, { active: next })}
                    onRemove={() => {
                      removeStaff(member.id);
                      offerUndo(`${member.name} taken off`, () =>
                        updateStaff(member.id, { active: true }),
                      );
                    }}
                    onSchedule={() => router.push('/schedule' as never)}
                  />
                </Animated.View>
              ))}
            </View>

            {past.length > 0 ? (
              <Animated.View entering={enter(6)} style={[styles.gutter, styles.block]}>
                <AppText variant="caption" color="textFaint" style={styles.label}>
                  NO LONGER WORKING HERE
                </AppText>
                <View style={styles.rows}>
                  {past.map((member) => (
                    <View key={member.id} style={[styles.pastRow, { backgroundColor: colors.surface }]}>
                      <View style={styles.grow}>
                        <AppText variant="footnote" color="textDim">
                          {member.name}
                        </AppText>
                        <AppText variant="caption" color="textFaint">
                          Their sessions and takings are still on the books
                        </AppText>
                      </View>
                      <Press
                        haptic="light"
                        scaleTo={0.95}
                        onPress={() => updateStaff(member.id, { active: true })}
                        style={styles.restore}>
                        <AppText variant="caption" tint={colors.accent}>
                          Bring back
                        </AppText>
                      </Press>
                    </View>
                  ))}
                </View>
              </Animated.View>
            ) : null}
          </>
        )}
      </ScrollView>

      <Sheet
        visible={sheet}
        onClose={() => setSheet(false)}
        title={`Add a ${term.one.toLowerCase()}`}
        footer={
          <Press
            haptic="medium"
            scaleTo={0.97}
            disabled={name.trim().length < 2}
            onPress={() => {
              addStaff({
                name: name.trim(),
                role: term.one,
                phone: phone.trim() || undefined,
                access: 'staff',
              });
              setSheet(false);
            }}
            style={[styles.cta, { backgroundColor: colors.accent }]}>
            <AppText variant="callout" tint={colors.accentText}>
              Add {name.trim() || 'them'}
            </AppText>
          </Press>
        }>
        <View style={styles.form}>
          <TextField label="Name" value={name} onChangeText={setName} autoFocus />
          <TextField
            label="Phone (optional)"
            value={phone}
            onChangeText={setPhone}
            keyboardType="phone-pad"
          />
          <AppText variant="caption" color="textFaint" style={styles.hint}>
            Everyone starts on the restricted level, where they can record who turned up but never
            see takings or debts. You can raise it afterwards.
          </AppText>
        </View>
      </Sheet>
    </View>
  );
}

function Member({
  member,
  read,
  templates,
  onAccess,
  onActive,
  onRemove,
  onSchedule,
}: {
  member: Staff;
  read?: ReturnType<typeof staffRead>;
  templates: { id: string; name: string; weekdays: number[]; minuteOfDay: number }[];
  onAccess: (access: StaffRole) => void;
  onActive: (next: boolean) => void;
  onRemove: () => void;
  onSchedule: () => void;
}) {
  const colors = useColors();
  const [open, setOpen] = useState(false);

  const retention = read?.retention ?? null;
  const tone =
    retention === null ? colors.textFaint : retention > 0.8 ? colors.success : colors.warn;

  return (
    <View style={[styles.member, { backgroundColor: colors.surface }]}>
      <Press
        haptic="light"
        scaleTo={0.99}
        onPress={() => setOpen(!open)}
        accessibilityLabel={`${member.name}, ${open ? 'collapse' : 'expand'}`}
        style={styles.memberHead}>
        {/* Retention as a ring, not a percentage buried in a row. It is the
            number this screen exists for. */}
        <Ring progress={retention ?? 0} size={46} stroke={5} tint={tone}>
          <AppText variant="caption" tabular tint={tone}>
            {retention === null ? '—' : Math.round(retention * 100)}
          </AppText>
        </Ring>

        <View style={styles.grow}>
          <AppText variant="callout" numberOfLines={1}>
            {member.name}
          </AppText>
          <AppText variant="caption" color="textFaint" numberOfLines={1}>
            {read?.parties ?? 0} assigned · {read?.sessions ?? 0} sessions ·{' '}
            {money(read?.revenue ?? 0)}
          </AppText>
        </View>

        {member.phone ? (
          <Press
            haptic="light"
            scaleTo={0.88}
            onPress={() => openCall(member.phone as string)}
            accessibilityLabel={`Call ${member.name}`}
            style={[styles.call, { backgroundColor: colors.surfaceHigh }]}>
            <Phone size={15} color={colors.text} strokeWidth={2} />
          </Press>
        ) : null}
      </Press>

      {read && read.atRisk > 0 ? (
        <View style={styles.risk}>
          <TriangleAlert size={13} color={colors.warn} strokeWidth={2} />
          <AppText variant="caption" tint={colors.warn} style={styles.riskText}>
            {read.atRisk} of their {read.parties} have gone quiet
            {read.noShows > 0 ? `, and ${read.noShows} sessions were no-shows` : ''}.
          </AppText>
        </View>
      ) : null}

      {open ? (
        <View style={[styles.detail, { borderTopColor: colors.hairline }]}>
          <AppText variant="caption" color="textFaint" style={styles.detailLabel}>
            WHAT THEY CAN SEE
          </AppText>
          <Segmented<StaffRole>
            options={ACCESS.map((a) => ({ value: a.value, label: a.label }))}
            value={member.access ?? 'staff'}
            onChange={onAccess}
          />
          <AppText variant="caption" color="textFaint" style={styles.meaning}>
            {ACCESS.find((a) => a.value === (member.access ?? 'staff'))?.meaning}
          </AppText>

          <AppText variant="caption" color="textFaint" style={styles.detailLabel}>
            WHAT THEY RUN
          </AppText>
          {templates.length === 0 ? (
            <Press haptic="light" scaleTo={0.97} onPress={onSchedule} style={styles.assign}>
              <AppText variant="footnote" tint={colors.accent}>
                Not on the timetable — assign them a session
              </AppText>
            </Press>
          ) : (
            <View style={styles.rows}>
              {templates.map((t) => (
                <Press
                  key={t.id}
                  haptic="light"
                  scaleTo={0.98}
                  onPress={onSchedule}
                  style={[styles.templateRow, { backgroundColor: colors.surfaceHigh }]}>
                  <AppText variant="footnote" style={styles.grow} numberOfLines={1}>
                    {t.name}
                  </AppText>
                  <AppText variant="caption" color="textFaint">
                    {describeTemplate(t as never)}
                  </AppText>
                </Press>
              ))}
            </View>
          )}

          <View style={styles.footRow}>
            <View style={styles.grow}>
              <AppText variant="footnote">Currently working</AppText>
              <AppText variant="caption" color="textFaint">
                Turn off to keep their history without assigning new work
              </AppText>
            </View>
            <Toggle value={member.active !== false} onChange={onActive} />
          </View>

          <Press haptic="medium" scaleTo={0.97} onPress={onRemove} style={styles.remove}>
            <UserMinus size={14} color={colors.warn} strokeWidth={2} />
            <AppText variant="caption" tint={colors.warn}>
              Take off the team
            </AppText>
          </Press>
        </View>
      ) : null}
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
  card: { padding: space.base, borderRadius: radius.lg },
  cardNote: { marginTop: space.md, lineHeight: 16 },

  list: { paddingHorizontal: space.gutter, gap: space.sm, marginTop: space.lg },
  rows: { gap: space.sm },
  member: { borderRadius: radius.lg, padding: space.base, gap: space.sm },
  memberHead: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  call: {
    width: 32,
    height: 32,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  risk: { flexDirection: 'row', alignItems: 'flex-start', gap: space.sm },
  riskText: { flex: 1, lineHeight: 16 },

  detail: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: space.base,
    marginTop: space.xs,
    gap: space.sm,
  },
  detailLabel: { letterSpacing: 0.9, marginTop: space.sm },
  meaning: { lineHeight: 16 },
  assign: { paddingVertical: space.sm },
  templateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    borderRadius: radius.sm,
  },
  footRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, marginTop: space.md },
  remove: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    alignSelf: 'flex-start',
    paddingVertical: space.sm,
  },

  pastRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    padding: space.base,
    borderRadius: radius.md,
  },
  restore: { paddingHorizontal: space.sm, paddingVertical: space.xs },

  form: { gap: space.md },
  hint: { lineHeight: 16 },
  cta: { height: 50, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
});
