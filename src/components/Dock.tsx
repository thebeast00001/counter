import * as Haptics from 'expo-haptics';
import { AiMark } from '@/components/AiMark';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter, type Tabs } from 'expo-router';
import {
  BadgeIndianRupee,
  ChartColumn,
  ChevronRight,
  House,
  Users,
  type LucideIcon,
} from 'lucide-react-native';
import { useEffect, useState, type ComponentProps } from 'react';
import { Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  FadeIn,
  FadeInDown,
  FadeOutDown,
  LinearTransition,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText } from '@/components/AppText';
import { GlassSurface } from '@/components/GlassSurface';
import { Press } from '@/components/Press';
import type { BusinessData, BusinessProfile } from '@/domain/model';
import { usesSchedule } from '@/domain/schedule';
import { useMotion } from '@/design/motion';
import { AI_FIELD } from '@/design/gradients';
import { useBreakpoint } from '@/design/responsive';
import { useColors } from '@/design/theme';
import { duration, layout, radius, space, spring } from '@/design/tokens';
import { useBusiness } from '@/state/business';
import { useLiveActivity } from '@/state/liveActivity';
import { Island, ISLAND_HEIGHT } from '@/components/Island';
import { useAssistant, useAssistantState } from '@/state/assistant';
import { useDockChrome } from '@/state/dockChrome';
import { DockUndo, useUndoHost } from '@/state/undo';

type TabBarProps = Parameters<NonNullable<ComponentProps<typeof Tabs>['tabBar']>>[0];

const ICONS: Record<string, LucideIcon> = {
  index: House,
  people: Users,
  money: BadgeIndianRupee,
  insights: ChartColumn,
};

const FALLBACK_LABELS: Record<string, string> = {
  index: 'Today',
  people: 'People',
  money: 'Money',
  insights: 'Insights',
};

type Jump = { label: string; sub: string; href: string };

/**
 * What each tab holds, in this business's own terms.
 *
 * Built from the profile rather than hardcoded. The fixed version offered a
 * garage "Take attendance — a whole session in one screen", which is nonsense
 * for a trade where customers arrive one at a time with a broken car, and
 * pointed at a timetable a garage does not keep. Anything shaped like a
 * timetable now appears only for businesses that run to one.
 */
function jumpsFor(
  profile: BusinessProfile | null,
  data: BusinessData | null,
  route: string,
): Jump[] {
  if (!profile) return [];

  const scheduled = usesSchedule(profile, data ?? undefined);
  const party = profile.vocabulary.party;
  const visit = profile.vocabulary.engagement;

  switch (route) {
    case 'index':
      return [
        { label: 'Ask about your business', sub: 'Answered on this phone', href: '/ask' },
        { label: 'Coming up', sub: 'Rent, licences, anything dated', href: '/obligations' },
        {
          label: 'What it does on its own',
          sub: 'Automation and its track record',
          href: '/automations',
        },
      ];

    case 'people':
      return [
        {
          label: `Record a ${visit.one.toLowerCase()}`,
          sub: scheduled
            ? 'A whole session in one screen'
            : `Who it was for, what it came to, and whether they paid`,
          href: '/capture',
        },
        { label: 'Groups', sub: 'Drifting, best, owing, new', href: '/segments' },
        scheduled
          ? { label: 'Timetable', sub: 'When things run, and who is in them', href: '/schedule' }
          : {
              label: `Add a ${party.one.toLowerCase()}`,
              sub: 'Name and nothing else compulsory',
              href: '/capture?mode=person',
            },
      ];

    case 'money':
      return [
        {
          label: 'Record a payment',
          sub: 'Or settle something already owed',
          href: '/capture?mode=payment',
        },
        {
          label: 'Record an expense',
          sub: 'Keeps the break-even line honest',
          href: '/capture?mode=expense',
        },
        { label: 'UPI', sub: 'Collect, and read in your statements', href: '/upi' },
      ];

    case 'insights':
      return [
        { label: 'Your week', sub: 'Which hours are full and which are empty', href: '/capacity' },
        { label: 'Groups', sub: 'Who is drifting, who is best', href: '/segments' },
        { label: 'What it knows', sub: 'Declared, observed and corrected', href: '/memory' },
      ];

    case 'you':
      return [
        scheduled
          ? { label: 'Timetable', sub: 'Change times, add or remove sessions', href: '/schedule' }
          : { label: 'What you sell', sub: 'Offerings and fixed costs', href: '/manage' },
        {
          label: profile.vocabulary.person.many,
          sub: 'Who works here and how they are doing',
          href: '/team',
        },
        { label: 'What it knows', sub: 'And how to correct it', href: '/memory' },
      ];

    default:
      return [];
  }
}

const PAD = 6;
const SWIPE_THRESHOLD = 56;

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

/**
 * The floating dock: navigation plus a retractable activity row.
 *
 * The People tab takes its name from the business — Members, Students, Clients —
 * so the navigation itself speaks the owner's vocabulary rather than the
 * product's. It is a small thing that does more than any settings screen to make
 * the app feel like it was built for one trade.
 */
export function Dock({ state, navigation }: TabBarProps) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const { maxWidth } = useBreakpoint();
  const { activities, dismiss } = useLiveActivity();
  const { profile, data } = useBusiness();
  const router = useRouter();
  const [jumpFor, setJumpFor] = useState<string | null>(null);

  // The dock draws undo offers while it is mounted, so the bar at the bottom of
  // the screen is the single place where "that just happened" appears.
  const undo = useUndoHost();
  const { reduced } = useMotion();

  const labelFor = (route: string) => {
    if (route === 'people' && profile) return profile.vocabulary.party.many;
    return FALLBACK_LABELS[route] ?? route;
  };

  /* ---------------------------------------------------------- activities -- */
  const count = activities.length;
  const [index, setIndex] = useState(0);
  useEffect(() => {
    if (index >= count && count > 0) setIndex(0);
  }, [count, index]);

  const item = count > 0 ? activities[Math.min(index, count - 1)] : null;
  const chrome = useDockChrome();
  const { openChat } = useAssistant();
  const { stage } = useAssistantState();

  // Same reasoning as the contextual bar: an undo window nobody can reach is
  // worse than a bar that stays put for five seconds.

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

  // Undo outranks the activity strip: it is time-limited and the strip is not,
  // so a five-second window must never be the thing that gets queued behind a
  // streak counter.
  const showUndo = undo.offer !== null;
  const rowOpen = showUndo || count > 0;

  const expand = useSharedValue(0);
  useEffect(() => {
    expand.value = withSpring(rowOpen ? 1 : 0, spring.standard);
  }, [rowOpen, expand]);

  /*
    The bar grows; nothing appears above it.
    That distinction is the whole reason the Dynamic Island reads as one object
    rather than as a notification — the surface you were already looking at
    changes shape to hold the news.
  */
  const rowHeight = showUndo ? layout.nowBarHeight : ISLAND_HEIGHT;
  const rowStyle = useAnimatedStyle(() => ({
    height: expand.value * rowHeight,
    opacity: expand.value,
  }));

  /* --------------------------------------------------------------- swipe -- */
  const dx = useSharedValue(0);
  const fade = useSharedValue(1);

  const cycle = (direction: 1 | -1) => {
    setIndex((i) => (i + direction + count) % count);
    dx.value = 0;
    fade.value = 0;
    fade.value = withTiming(1, { duration: duration.normal });
  };

  const pan = Gesture.Pan()
    .activeOffsetX([-12, 12])
    .failOffsetY([-10, 10])
    .enabled(count > 1)
    .onUpdate((e) => {
      dx.value = e.translationX;
    })
    .onEnd((e) => {
      if (Math.abs(e.translationX) > SWIPE_THRESHOLD || Math.abs(e.velocityX) > 700) {
        const dir = e.translationX < 0 ? 1 : -1;
        dx.value = withTiming(e.translationX < 0 ? -width : width, { duration: 140 }, (done) => {
          if (done) runOnJS(cycle)(dir as 1 | -1);
        });
      } else {
        dx.value = withSpring(0, spring.standard);
      }
    });

  const contentStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: dx.value }],
    opacity: fade.value,
  }));

  /*
    Out of the way while reading, back the moment a thumb asks for it. See
    `dockChrome.tsx` — translated rather than unmounted so the undo timer
    inside it survives the trip.
  */
  const travel = layout.tabBarHeight + insets.bottom + space.xl;
  const hideStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: (chrome?.hidden.value ?? 0) * travel }],
    opacity: 1 - (chrome?.hidden.value ?? 0) * 0.25,
  }));

  // The sheet takes this bar's place. See `AssistantSheet`.
  if (stage !== 'closed') return null;

  return (
    <Animated.View
      style={[styles.wrap, { bottom: insets.bottom + space.sm, maxWidth }, hideStyle]}
      pointerEvents="box-none">
      {/* Fades content out as it approaches the dock, so nothing is left half
          visible in the gap underneath it. */}
      <LinearGradient
        colors={['transparent', colors.bg, colors.bg]}
        locations={[0, 0.55, 1]}
        style={[styles.scrim, { bottom: -(insets.bottom + space.sm) }]}
        pointerEvents="none"
      />

      <View style={styles.deck} pointerEvents="box-none">
      <GlassSurface radius={radius.xl} style={styles.dock}>
        <Animated.View style={[styles.activityRow, rowStyle]}>
          {showUndo && undo.offer ? (
            <DockUndo offer={undo.offer} onDismiss={undo.dismiss} graceMs={undo.graceMs} />
          ) : item ? (
            <GestureDetector gesture={pan}>
              <Animated.View style={contentStyle}>
                <Island
                  item={item}
                  count={count}
                  index={index}
                  onDismiss={() => dismiss(item.id)}
                  onAct={
                    // Only when there is somewhere sensible to go. An arrow that
                    // lands on the screen you are already looking at is worse
                    // than no arrow.
                    state.routes[state.index]?.name === 'index'
                      ? undefined
                      : () => navigation.navigate('index')
                  }
                />
              </Animated.View>
            </GestureDetector>
          ) : null}
        </Animated.View>

        {/*
          Only the selected tab carries its label.
          Five labels across a floating bar leaves each one about sixty points
          wide, which is why "Settings" kept needing to be rescued from its own
          highlight. Showing one label at a time gives it room, makes the
          selection unmissable, and is what the bar was always trying to be.
        */}
        <View style={styles.tabRow}>
          {state.routes.map((route, i) => {
            // Settings has left the bar. Five tabs left every label about sixty
            // points of room and made the selected pill fight its own text; the
            // one that is opened least often is the one that should give way,
            // and it now lives behind the profile circle in the header.
            if (!(route.name in ICONS)) return null;
            const focused = state.index === i;
            const Icon = ICONS[route.name] ?? House;
            return (
              <TabItem
                key={route.key}
                Icon={Icon}
                label={labelFor(route.name)}
                focused={focused}
                onPress={() => {
                  const event = navigation.emit({
                    type: 'tabPress',
                    target: route.key,
                    canPreventDefault: true,
                  });
                  if (focused || event.defaultPrevented) return;
                  Haptics.selectionAsync().catch(() => {});
                  navigation.navigate(route.name);
                }}
                onLongPress={
                  jumpsFor(profile, data, route.name).length
                    ? () => {
                        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy).catch(() => {});
                        setJumpFor(route.name);
                      }
                    : undefined
                }
              />
            );
          })}
        </View>
      </GlassSurface>

      {/*
        The assistant sits outside the bar rather than in it, because it is not a
        place — it is an action, and it stays available from whichever tab you
        are on. Putting it inside would have made it a sixth tab competing for
        the same selected-pill highlight it can never own.
      */}
      <Press
        haptic="medium"
        scaleTo={0.92}
        onPress={openChat}
        onLongPress={() => {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy).catch(() => {});
          router.push('/assistant');
        }}
        delayLongPress={320}
        accessibilityRole="button"
        accessibilityLabel="Ask about your business"
        accessibilityHint="Long press for assistant settings"
        style={styles.ai}>
        {/*
          A lit sphere rather than a flat coloured circle.
          The flat version read as a placeholder because nothing in the physical
          world is a single uniform colour — a highlight at the top-left and a
          deeper edge at the bottom-right is the whole difference between a
          shape and an object.
        */}
        {/* Flat and fixed — see the note on the same control in `ContextDock`. */}
        <LinearGradient
          colors={AI_FIELD}
          locations={[0, 0.5, 1]}
          start={{ x: 0.1, y: 0 }}
          end={{ x: 0.9, y: 1 }}
          style={StyleSheet.absoluteFill}
        />
        <AiMark size={26} color="#FFFFFF" />
      </Press>
      </View>

      {/*
        Hold a tab to reach what is inside it without landing on the tab first.
        The three destinations per tab are the ones that would otherwise cost a
        tab switch, a scroll and a tap.
      */}
      {/*
        A popover, not a modal.
        This was a <Sheet>, which is a native <Modal> — a whole additional window
        that Android creates and tears down on every open and close. For a
        three-item menu that costs more than everything it shows, and the teardown
        is exactly the stutter you feel when dismissing it. Rendered inline it is
        two views and a fade.
      */}
      {jumpFor ? (
        <>
          <Pressable
            style={styles.menuScrim}
            onPress={() => setJumpFor(null)}
            accessibilityLabel="Close menu"
          />
          <Animated.View
            entering={reduced ? FadeIn.duration(120) : FadeInDown.duration(180)}
            exiting={FadeOutDown.duration(130)}
            style={styles.popover}>
            <GlassSurface radius={radius.lg} style={styles.popoverCard}>
              <AppText variant="caption" color="textFaint" style={styles.popoverHead}>
                {labelFor(jumpFor).toUpperCase()}
              </AppText>
              {jumpsFor(profile, data, jumpFor).map((jump) => (
                <Press
                  key={jump.href}
                  haptic="medium"
                  scaleTo={0.97}
                  onPress={() => {
                    setJumpFor(null);
                    router.push(jump.href as never);
                  }}
                  style={styles.jump}>
                  <View style={styles.jumpBody}>
                    <AppText variant="callout">{jump.label}</AppText>
                    <AppText variant="caption" color="textFaint" numberOfLines={1}>
                      {jump.sub}
                    </AppText>
                  </View>
                  <ChevronRight size={16} color={colors.textFaint} strokeWidth={2.2} />
                </Press>
              ))}
            </GlassSurface>
          </Animated.View>
        </>
      ) : null}
    </Animated.View>
  );
}

/**
 * One tab. Selected, it becomes a filled pill carrying its own label; otherwise
 * it is an icon and nothing else.
 *
 * The width change is driven by Reanimated's layout transition rather than an
 * animated style, because the row is a flex layout — the neighbours have to give
 * up their space as this one takes it, and only a layout animation moves all of
 * them together.
 */
function TabItem({
  Icon,
  label,
  focused,
  onPress,
  onLongPress,
}: {
  Icon: LucideIcon;
  label: string;
  focused: boolean;
  onPress: () => void;
  onLongPress?: () => void;
}) {
  const colors = useColors();
  const { reduced } = useMotion();

  const transition = reduced ? undefined : LinearTransition.springify().damping(24).stiffness(340).mass(0.75);

  return (
    <AnimatedPressable
      layout={transition}
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={320}
      hitSlop={6}
      accessibilityRole="tab"
      accessibilityState={{ selected: focused }}
      accessibilityLabel={label}
      accessibilityHint={onLongPress ? 'Long press for shortcuts' : undefined}
      /*
        A soft raised disc, not a filled accent pill.
        The accent version shouted — a saturated capsule is the loudest thing on
        any screen it appears on, and a tab bar should be the quietest. The
        reference does it with a neutral highlight that reads as *lifted* rather
        than *coloured*: the icon stays ink, the surface behind it changes.
      */
      style={[
        styles.tabItem,
        focused
          ? [styles.tabItemOn, { backgroundColor: colors.surfaceHigh }]
          : styles.tabItemOff,
      ]}>
      <Icon
        size={20}
        strokeWidth={focused ? 2.4 : 1.9}
        color={focused ? colors.text : colors.textDim}
      />
      {focused ? (
        <Animated.View entering={reduced ? undefined : FadeIn.duration(140).delay(60)}>
          <AppText variant="footnote" numberOfLines={1} style={styles.tabLabel}>
            {label}
          </AppText>
        </Animated.View>
      ) : null}
    </AnimatedPressable>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: space.gutter, right: space.gutter, alignSelf: 'center' },
  // Negative insets escape the gutter so the fade spans the full screen width.
  scrim: { position: 'absolute', left: -space.gutter, right: -space.gutter, top: -space.xxl },
  deck: { flexDirection: 'row', alignItems: 'flex-end', gap: space.sm },
  dock: { overflow: 'hidden', flex: 1 },
  // Inset from the bar's height rather than matching it, so it sits inside the
  // same optical band as the pill beside it.
  ai: {
    overflow: 'hidden',
    width: layout.dockAction,
    height: layout.dockAction,
    marginBottom: (layout.tabBarHeight - layout.dockAction) / 2,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },

  activityRow: { overflow: 'hidden' },
  activityInner: { height: layout.nowBarHeight },
  activityPress: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.md,
    height: layout.nowBarHeight,
  },
  activityIcon: {
    width: 28,
    height: 28,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  activityText: { flex: 1, gap: 1 },
  dots: { flexDirection: 'row', gap: 3, alignItems: 'center' },
  dot: { height: 4, borderRadius: radius.pill },

  tabRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    height: layout.tabBarHeight,
    paddingHorizontal: PAD,
    gap: 2,
  },
  tabItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
    height: 46,
    borderRadius: radius.pill,
  },
  // Takes whatever room the others give up, so a long word like "Settings" is
  // never the thing that has to shrink.
  tabItemOn: { flexGrow: 1, flexShrink: 1, paddingHorizontal: space.base },
  tabItemOff: { width: 52 },
  tabLabel: { includeFontPadding: false },
  // Reaches well beyond the dock's own bounds so a tap anywhere dismisses.
  menuScrim: { position: 'absolute', left: -600, right: -600, bottom: -200, top: -1400 },
  popover: { position: 'absolute', left: 0, right: 0, bottom: '100%', marginBottom: space.sm },
  popoverCard: { padding: space.sm },
  popoverHead: { letterSpacing: 0.9, paddingHorizontal: space.md, paddingVertical: space.sm },
  jump: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.md,
    paddingVertical: space.md,
    borderRadius: radius.md,
  },
  jumpBody: { flex: 1, gap: 2 },

});
