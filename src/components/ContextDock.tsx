import * as Haptics from 'expo-haptics';
import { useRouter, usePathname } from 'expo-router';
import {
  ArrowLeft,
  BadgeIndianRupee,
  Banknote,
  CalendarClock,
  ChartColumn,
  ClipboardList,
  Layers,
  ListChecks,
  Plus,
  Send,
  Settings2,
  Users,
  Wand,
  type LucideIcon,
} from 'lucide-react-native';
import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { FadeIn, useAnimatedStyle } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { LinearGradient } from 'expo-linear-gradient';

import { AiMark } from '@/components/AiMark';
import { AppText } from '@/components/AppText';
import { GlassSurface } from '@/components/GlassSurface';
import { Press } from '@/components/Press';
import type { BusinessProfile } from '@/domain/model';
import { usesSchedule } from '@/domain/schedule';
import { AI_FIELD } from '@/design/gradients';
import { useBreakpoint } from '@/design/responsive';
import { useColors } from '@/design/theme';
import { layout, radius, space } from '@/design/tokens';
import { useBusiness } from '@/state/business';
import { Island } from '@/components/Island';
import { useLiveActivity } from '@/state/liveActivity';
import { useDockPrimaryValue } from '@/state/dockAction';
import { useAssistant, useAssistantState } from '@/state/assistant';
import { useDockChrome } from '@/state/dockChrome';
import { DockUndo, useUndoHost } from '@/state/undo';

type Action = { icon: LucideIcon; label: string; href: string };

/**
 * What the bar offers on a screen that is not a tab.
 *
 * The tabs answer "where am I going"; an inner screen has already answered that,
 * so the bar's job changes to "what next, from here". Keeping the same bar with
 * the same shape and swapping only its contents means the thumb never has to
 * learn a second place to look — which is the entire reason for a fixed bottom
 * bar in the first place.
 *
 * Deliberately at most three. A bar that lists everything reachable is a menu,
 * and a menu at the bottom of every screen is worse than no bar at all.
 */
function actionsFor(path: string, profile: BusinessProfile | null): Action[] {
  if (!profile) return [];
  const scheduled = usesSchedule(profile);
  const party = profile.vocabulary.party;
  const visit = profile.vocabulary.engagement;

  // Longest prefixes first, so `/person/x` never falls through to a `/` rule.
  if (path.startsWith('/person')) {
    return [
      { icon: Plus, label: visit.one, href: '/capture' },
      { icon: Banknote, label: 'Payment', href: '/capture?mode=payment' },
      { icon: Users, label: 'Groups', href: '/segments' },
    ];
  }
  if (path.startsWith('/capture')) {
    return [
      { icon: Users, label: party.many, href: '/(tabs)/people' },
      { icon: BadgeIndianRupee, label: 'Money', href: '/(tabs)/money' },
    ];
  }
  if (path.startsWith('/ask') || path.startsWith('/assistant')) {
    return [
      { icon: ChartColumn, label: 'Insights', href: '/(tabs)/insights' },
      { icon: Layers, label: 'Memory', href: '/memory' },
      { icon: Settings2, label: 'Setup', href: '/assistant' },
    ];
  }
  if (path.startsWith('/worklist')) {
    return [
      { icon: Send, label: 'Chase', href: '/worklist?kind=collect' },
      { icon: Banknote, label: 'Payment', href: '/capture?mode=payment' },
    ];
  }
  if (path.startsWith('/segments')) {
    return [
      { icon: Users, label: party.many, href: '/(tabs)/people' },
      { icon: Send, label: 'Chase', href: '/worklist?kind=collect' },
    ];
  }
  if (path.startsWith('/schedule')) {
    return [
      { icon: Plus, label: visit.one, href: '/capture' },
      { icon: Users, label: party.many, href: '/(tabs)/people' },
    ];
  }
  if (path.startsWith('/obligations')) {
    return [
      { icon: Banknote, label: 'Expense', href: '/capture?mode=expense' },
      { icon: CalendarClock, label: scheduled ? 'Timetable' : 'Your week', href: scheduled ? '/schedule' : '/capacity' },
    ];
  }
  if (path.startsWith('/team')) {
    return [
      { icon: ClipboardList, label: 'Prices', href: '/manage' },
      { icon: Users, label: party.many, href: '/(tabs)/people' },
    ];
  }
  if (path.startsWith('/memory') || path.startsWith('/automations')) {
    return [
      { icon: Wand, label: 'Rules', href: '/automations' },
      { icon: Layers, label: 'Memory', href: '/memory' },
      { icon: ChartColumn, label: 'Insights', href: '/(tabs)/insights' },
    ];
  }
  if (path.startsWith('/capacity') || path.startsWith('/wrapped')) {
    return [
      { icon: ChartColumn, label: 'Insights', href: '/(tabs)/insights' },
      { icon: Users, label: 'Groups', href: '/segments' },
    ];
  }
  if (path.startsWith('/contacts')) {
    return [
      { icon: Users, label: party.many, href: '/(tabs)/people' },
      { icon: Plus, label: 'By hand', href: '/capture?mode=person' },
    ];
  }
  if (path.startsWith('/account')) {
    return [
      { icon: Settings2, label: 'Settings', href: '/you' },
      { icon: Users, label: profile.vocabulary.person.many, href: '/team' },
      { icon: Layers, label: 'Memory', href: '/memory' },
    ];
  }
  if (path.startsWith('/you')) {
    return [
      { icon: Users, label: profile.vocabulary.person.many, href: '/team' },
      { icon: ClipboardList, label: 'Prices', href: '/manage' },
      { icon: Layers, label: 'Memory', href: '/memory' },
    ];
  }
  if (path.startsWith('/manage')) {
    return [
      { icon: ListChecks, label: 'Due', href: '/obligations' },
      { icon: Users, label: profile.vocabulary.person.many, href: '/team' },
    ];
  }
  return [
    { icon: ListChecks, label: 'Due', href: '/obligations' },
    { icon: ChartColumn, label: 'Insights', href: '/(tabs)/insights' },
  ];
}

/** Screens that own their whole surface and must not have a bar over them. */
const BARE = ['/setup', '/wrapped'];

export function ContextDock() {
  const path = usePathname();
  const { profile } = useBusiness();

  // The tabs have the real dock; setup and the wrapped story are full-bleed.
  const inTabs =
    path === '/' ||
    path === '/people' ||
    path === '/money' ||
    path === '/insights';

  if (!profile || inTabs || BARE.some((b) => path.startsWith(b))) return null;
  return <Bar path={path} profile={profile} />;
}

/**
 * Split from the decision above so the undo host is only claimed while the bar
 * is genuinely on screen — hooks cannot be called conditionally, and claiming it
 * from a component that renders nothing would silently suppress the floating
 * capsule everywhere.
 */
function Bar({ path, profile }: { path: string; profile: BusinessProfile }) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { maxWidth } = useBreakpoint();
  const router = useRouter();
  const undo = useUndoHost();
  const { activities, dismiss } = useLiveActivity();
  const item = activities[0] ?? null;

  const actions = actionsFor(path, profile);
  const primary = useDockPrimaryValue();
  const chrome = useDockChrome();
  const { openChat } = useAssistant();
  const { stage } = useAssistantState();

  /*
    An undo offer or a live activity pins the bar open. Both are time-limited
    things the owner is meant to act on, and a bar that slid away two seconds
    into a five-second undo window would take the only way back with it.
  */

  /*
    Back on screen when the conversation ends.

    This bar unmounts while the sheet is up, and `hidden` is a shared value that
    survives it — so closing the chat after having scrolled down restored a bar
    that was still translated off the bottom, with no way to retrieve it except
    scrolling up. Mounting is the moment to say it should be visible.
  */
  useEffect(() => {
    if (stage === 'closed') chrome?.show();
  }, [stage, chrome]);

  const pinned = Boolean(undo.offer) || Boolean(item);
  const holdBar = chrome?.hold;
  useEffect(() => {
    holdBar?.(pinned);
    return () => holdBar?.(false);
  }, [pinned, holdBar]);
  const onAssistant = path.startsWith('/assistant') || path.startsWith('/ask');

  /*
    Out of the way while reading, back the moment a thumb asks for it.

    Translated rather than unmounted: the bar keeps its place in the tree, so
    the undo offer inside it does not lose its timer and nothing below reflows
    when it leaves. Far enough to clear its own shadow.
  */
  const travel = layout.tabBarHeight + insets.bottom + space.xl;
  const hideStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: (chrome?.hidden.value ?? 0) * travel }],
    opacity: 1 - (chrome?.hidden.value ?? 0) * 0.25,
  }));

  // The sheet takes this bar's place, in the same spot at the same size, so
  // both being on screen would be two bars stacked.
  if (stage !== 'closed') return null;

  return (
    <Animated.View
      style={[styles.wrap, { bottom: insets.bottom + space.sm, maxWidth }, hideStyle]}
      pointerEvents="box-none">
      {/*
        Fades the page out as it reaches the bar, the same way the tabs do.

        It mattered less while the bar ran the full width and hid whatever was
        behind it. Now that it is only as long as its contents, page text runs
        through the gap between the pill and the assistant — legible, at the very
        bottom of the screen, going nowhere.
      */}
      <LinearGradient
        colors={['transparent', colors.bg, colors.bg]}
        locations={[0, 0.55, 1]}
        style={[styles.scrim, { bottom: -(insets.bottom + space.sm) }]}
        pointerEvents="none"
      />

      <View style={styles.deck} pointerEvents="box-none">
        <GlassSurface radius={radius.xl} style={[styles.dock, pinned && styles.dockWide]}>
          {/*
            The same island as the tabs.
            It only existed on the tab bar before, so anything that happened
            while you were inside a screen either went unseen or waited until you
            navigated back — which is exactly when it is least useful.
          */}
          {undo.offer ? (
            <DockUndo offer={undo.offer} onDismiss={undo.dismiss} graceMs={undo.graceMs} />
          ) : item ? (
            <Island
              item={item}
              count={activities.length}
              index={0}
              onDismiss={() => dismiss(item.id)}
            />
          ) : null}

          <View style={styles.row}>
            <Press
              haptic="light"
              scaleTo={0.9}
              onPress={() => router.back()}
              accessibilityLabel="Back"
              style={[styles.back, { backgroundColor: colors.surfaceHigh }]}>
              <ArrowLeft size={19} color={colors.text} strokeWidth={2.2} />
            </Press>

            {/*
              The screen's own action, when it has one, in place of the
              navigation items rather than beside them.

              A screen with a primary action has already said what it is for —
              offering three ways to leave at the same time is what turned a bar
              into a menu. It takes the whole row so the label can be a sentence
              ("Finish · 2 done") rather than a word under an icon.
            */}
            {primary ? (
              <Press
                haptic="medium"
                scaleTo={0.97}
                disabled={primary.disabled}
                onPress={primary.onPress}
                accessibilityRole="button"
                accessibilityLabel={primary.label}
                accessibilityState={{ disabled: Boolean(primary.disabled) }}
                style={[
                  styles.primary,
                  {
                    backgroundColor: primary.disabled
                      ? colors.surfaceHigh
                      : primary.tone === 'warn'
                        ? colors.warn
                        : colors.accent,
                  },
                ]}>
                <AppText
                  variant="callout"
                  numberOfLines={1}
                  tint={primary.disabled ? colors.textFaint : colors.accentText}>
                  {primary.label}
                </AppText>
              </Press>
            ) : null}

            {primary ? null : (
              <View style={styles.actions}>
                {actions.map((action) => (
                  <Press
                    key={action.href + action.label}
                    haptic="light"
                    scaleTo={0.94}
                    onPress={() => router.push(action.href as never)}
                    accessibilityRole="button"
                    accessibilityLabel={action.label}
                    style={styles.action}>
                    <action.icon size={19} color={colors.textDim} strokeWidth={1.9} />
                    <AppText
                      variant="caption"
                      color="textDim"
                      numberOfLines={1}
                      style={styles.actionLabel}>
                      {action.label}
                    </AppText>
                  </Press>
                ))}
              </View>
            )}
          </View>
        </GlassSurface>

        {/* Same position, same size, same gesture as on the tabs — the one
            control that must not move when the rest of the bar changes. */}
        <Press
          haptic="medium"
          scaleTo={0.92}
          /*
            Opens the conversation over this screen rather than navigating to
            one. The settings screen keeps its own route, because that is a
            place with things to change rather than a thing to ask.
          */
          onPress={() => (onAssistant ? router.push('/assistant') : openChat())}
          onLongPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy).catch(() => {});
            router.push('/assistant');
          }}
          delayLongPress={320}
          accessibilityRole="button"
          accessibilityLabel={onAssistant ? 'Assistant settings' : 'Ask about your business'}
          style={styles.ai}>
          {/*
            Flat, and the same on every screen.

            The gloss and the drop shadow made this a ball sitting on top of the
            bar rather than part of it — and both were doing the work of saying
            "tappable", which the shape and the gradient already say. White on
            the field rather than `accentText`, because the field is fixed and
            `accentText` inverts between light and dark.
          */}
          <LinearGradient
            colors={AI_FIELD}
            locations={[0, 0.5, 1]}
            start={{ x: 0.1, y: 0 }}
            end={{ x: 0.9, y: 1 }}
            style={StyleSheet.absoluteFill}
          />
          <Animated.View entering={FadeIn.duration(160)}>
            <AiMark size={26} color="#FFFFFF" />
          </Animated.View>
        </Press>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  /* Fills the row the navigation items would have shared. */
  primary: {
    flexShrink: 1,
    minWidth: 150,
    height: 44,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space.base,
  },
  wrap: { position: 'absolute', left: space.gutter, right: space.gutter, alignSelf: 'center' },
  scrim: { position: 'absolute', left: -space.gutter, right: -space.gutter, top: -space.xxl },
  /*
    The bar is as long as it needs to be.

    `dock` used to take `flex: 1` and so always ran the full gutter-to-gutter
    width, which on a screen offering two actions was a lot of empty pill. It is
    sized to its contents now, and `space-between` keeps the assistant pinned to
    the right edge — that button must not move when the rest of the bar changes
    length, or it stops being one control and becomes a different one per screen.
  */
  deck: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    gap: space.sm,
  },
  dock: { overflow: 'hidden', flexShrink: 1 },
  /*
    Except when it is carrying a message. An undo offer or a live activity is a
    sentence, and a pill that grew and shrank around one would draw the eye to
    the animation rather than to the words.
  */
  dockWide: { flexGrow: 1 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    height: layout.tabBarHeight,
    paddingHorizontal: 6,
    gap: 2,
  },
  back: {
    width: 46,
    height: 46,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionLabel: { fontSize: 11 },
  /*
    Grouped in the middle, not stretched across the bar.

    Each of these used to take `flex: 1`, so two of them each claimed half the
    row and sat marooned in the centre of their own half — the fewer actions a
    screen offered, the further apart they drifted. Sized to their contents and
    centred as a group, two read as a pair and three space themselves the same
    way.
  */
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.xs,
  },
  action: {
    flexShrink: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    height: 46,
    minWidth: 64,
    borderRadius: radius.pill,
    paddingHorizontal: space.xs,
  },
  // Identical to the tabs' bar, from the same token. These drifted apart when
  // each file carried its own number, and a control that changes size as you
  // move between screens reads as two different buttons.
  ai: {
    overflow: 'hidden',
    width: layout.dockAction,
    height: layout.dockAction,
    marginBottom: (layout.tabBarHeight - layout.dockAction) / 2,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
