import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { Mic, Plus, Square } from 'lucide-react-native';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Keyboard,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  FadeIn,
  FadeOut,
  clamp,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AiMark } from '@/components/AiMark';
import { useVoice } from '@/state/voice';
import { AppText } from '@/components/AppText';
import { GlassSurface } from '@/components/GlassSurface';
import { Press } from '@/components/Press';
import { AI_FIELD } from '@/design/gradients';
import { useBreakpoint } from '@/design/responsive';
import { useColors } from '@/design/theme';
import { layout, radius, space, spring } from '@/design/tokens';
import { EXAMPLE_QUESTIONS } from '@/domain/query';
import { useAssistant, useAssistantState } from '@/state/assistant';
import { useBusiness } from '@/state/business';

/**
 * The assistant, pulled out of the floating bar.
 *
 * It used to be a screen you navigated to. That made asking a question a
 * departure: the figures you were looking at went away, and the answer arrived
 * somewhere else. Here the bar itself becomes the question box and the answer
 * grows upward out of it, over whatever was already on screen.
 *
 * Three stages, and the gesture is continuous between them:
 *
 * - **closed** — not rendered. The ordinary bar is showing.
 * - **open** — a panel about half the screen, anchored to the bar.
 * - **full** — everything but the status bar.
 *
 * ## The drag is on the bar, not the sheet
 *
 * Wrapping the whole surface in a pan gesture is the mistake `Sheet` documents:
 * it swallows vertical drags before the transcript sees them, so the list
 * refuses to scroll and nothing anywhere reports an error. The gesture lives on
 * the input row — which is also the thing a thumb is actually resting on when
 * it pulls up — and the transcript above it scrolls untouched.
 *
 * ## There is no real blur here on Android
 *
 * `GlassSurface` is a system blur on iOS and a high-opacity fill on Android,
 * because SDK 57's Android blur needs a `BlurTargetView` and wrapping the
 * navigator in one takes the render thread down with a SIGSEGV. The scrim below
 * does the work instead: a gradient that darkens the screen as the sheet rises,
 * so the content behind reads as *behind* rather than as competing with it.
 */

/** Below this the pull is treated as a dismissal rather than a resize. */
const CLOSE_BELOW = 96;

export function AssistantSheet() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { height: screenH } = useWindowDimensions();
  const { maxWidth } = useBreakpoint();
  const { profile, data } = useBusiness();

  const { stage, turns, thinking } = useAssistantState();
  const { closeChat, setStage, send, clear } = useAssistant();

  const [draft, setDraft] = useState('');

  /*
    Heard, then asked.

    The transcript is sent as the question rather than dropped into the field for
    approval, and the "you" bubble shows exactly the words that were heard — so a
    misheard question is visible in the transcript instead of hidden behind a
    confirmation step nobody reads. Getting it wrong costs one more question.
  */
  const voice = useVoice((heard) => send(heard));
  const [menu, setMenu] = useState(false);
  const scroller = useRef<ScrollView>(null);

  /* The three heights the sheet snaps between. */
  const barH: number = layout.tabBarHeight;
  const openH = Math.min(screenH * 0.52, screenH - insets.top - 160);
  const fullH = screenH - insets.top - insets.bottom - space.xl;

  const h = useSharedValue(barH);
  const startH = useSharedValue(barH);

  /*
    Lifted clear of the keyboard.

    The sheet is anchored to the bottom of the window, so without this the one
    part of it you have to see while typing — the field you are typing into — is
    the part the keyboard is on top of. Translated rather than re-laid-out: the
    transcript keeps its height and its scroll position, and the compositor does
    the move for free.

    `Will` fires before the animation on iOS; Android only has `Did`, the same
    split `Sheet` handles.
  */
  const lift = useSharedValue(0);
  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const up = Keyboard.addListener(showEvent, (e) => {
      /*
        Plus a gap. Lifting by exactly the keyboard's height leaves the sheet's
        bottom edge sitting on the key row with no seam between them, so the two
        surfaces read as one shape with a fold in it.
      */
      lift.value = withSpring(
        Math.max(0, e.endCoordinates.height - insets.bottom + space.md),
        spring.standard,
      );
    });
    const down = Keyboard.addListener(hideEvent, () => {
      lift.value = withSpring(0, spring.standard);
    });
    return () => {
      up.remove();
      down.remove();
    };
  }, [insets.bottom, lift]);

  /*
    Mounted a beat longer than it is open, so it can leave the way it arrived.

    Returning null the moment `stage` went to 'closed' made the sheet vanish —
    it grew out of the bar on a spring and then simply stopped existing, which
    reads as a crash rather than as a dismissal. The stage says what the sheet
    should be doing; this says whether it is still on screen, and the two only
    disagree for the length of one spring.
  */
  useEffect(() => {
    h.value = withSpring(stage === 'closed' ? 0 : stage === 'full' ? fullH : openH, spring.standard);
  }, [stage, openH, fullH, h]);

  // New turns should be visible without a scroll.
  useEffect(() => {
    if (turns.length === 0) return;
    const id = setTimeout(() => scroller.current?.scrollToEnd({ animated: true }), 60);
    return () => clearTimeout(id);
  }, [turns.length, thinking]);

  const settle = (height: number) => {
    if (height < CLOSE_BELOW) {
      Keyboard.dismiss();
      closeChat();
      return;
    }
    setStage(height > (openH + fullH) / 2 ? 'full' : 'open');
  };

  /*
    Follows the finger, then snaps.

    Clamped a little below the open height so a downward pull has somewhere to
    go — without the slack there is no way to express "close" with the same
    gesture that expresses "smaller".
  */
  const drag = Gesture.Pan()
    .activeOffsetY([-8, 8])
    .onBegin(() => {
      startH.value = h.value;
    })
    .onUpdate((e) => {
      h.value = clamp(startH.value - e.translationY, 0, fullH);
    })
    .onEnd(() => {
      runOnJS(settle)(h.value);
    });

  /*
    Lifted and shortened, not just lifted.

    Translating alone pushes the top of the sheet off the screen by exactly the
    height of the keyboard — at the full stage that is the grabber and the first
    several turns gone, with no way to scroll them back because the sheet itself
    has left the window. Capping the height at what is left above the keyboard
    keeps the top edge where it was and gives the transcript the smaller space
    it actually has.
  */
  const sheetStyle = useAnimatedStyle(() => ({
    height: Math.max(0, Math.min(h.value, fullH - lift.value)),
    transform: [{ translateY: -lift.value }],
  }));

  /* The scrim tracks the sheet rather than the stage, so it follows a drag. */
  const scrimStyle = useAnimatedStyle(() => ({
    opacity: Math.min(1, Math.max(0, (h.value - barH) / (openH - barH))) * 0.86,
  }));

  /*
    Never unmounted once the owner has a business, only shrunk to nothing.

    Tearing the sheet out of the tree at the end of the close animation is what
    made the last few frames stutter: the transcript, its scroll view and every
    bubble were disposed of on the exact frame the spring settled, while the bar
    underneath was mounting at the same time. Keeping it at zero height costs one
    idle view and no frames, and it is what a sheet that reopens constantly
    should do anyway.
  */
  if (!profile) return null;

  const suggestions = EXAMPLE_QUESTIONS.slice(0, 4);

  const submit = () => {
    const text = draft.trim();
    if (text.length < 2) return;
    setDraft('');
    send(text);
  };

  return (
    <>
      {/*
        Tapping away closes. The scrim is also what makes this read as a layer
        over the app rather than as a new screen — the figures underneath stay
        visible, just quieter.
      */}
      <Animated.View
        style={[StyleSheet.absoluteFill, scrimStyle]}
        pointerEvents={stage === 'closed' ? 'none' : 'auto'}>
        <Pressable
          style={StyleSheet.absoluteFill}
          accessibilityLabel="Close the assistant"
          onPress={() => {
            Keyboard.dismiss();
            closeChat();
          }}>
          {/*
            Nearly flat, not a steep ramp.

            The first version ran transparent-to-opaque over the whole screen,
            which left the top of the page at full brightness while the middle
            went dark — the header competed with the conversation and the dimming
            read as a gradient someone had left on. A near-even veil that deepens
            only towards the sheet puts everything behind at the same distance.
          */}
          <LinearGradient
            colors={['rgba(0,0,0,0.55)', 'rgba(0,0,0,0.72)', 'rgba(0,0,0,0.88)']}
            locations={[0, 0.6, 1]}
            style={StyleSheet.absoluteFill}
          />
        </Pressable>
      </Animated.View>

      <Animated.View
        style={[
          styles.wrap,
          { bottom: insets.bottom + space.sm, maxWidth },
          sheetStyle,
        ]}
        pointerEvents={stage === 'closed' ? 'none' : 'box-none'}>
        <GlassSurface radius={radius.xl} style={styles.sheet}>
          {/*
            The handle, and the only place the drag reliably starts.

            The gesture was on the input row first, which is where the finger
            naturally goes — and it did nothing, because the row is mostly a
            `TextInput` and a text field keeps its own touches. A strip of sheet
            that is not a control is the thing a pan can own outright, and a
            visible grabber is also the only way anyone would know the sheet
            moves at all.
          */}
          <GestureDetector gesture={drag}>
            <View style={styles.grabArea}>
              <View style={[styles.grabber, { backgroundColor: colors.hairlineStrong }]} />
            </View>
          </GestureDetector>

          {/* ------------------------------------------------- transcript -- */}
          <ScrollView
            ref={scroller}
            style={styles.scroll}
            contentContainerStyle={styles.scrollBody}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}>
            {turns.length === 0 ? (
              <Animated.View entering={FadeIn.duration(180)} style={styles.empty}>
                {/*
                  The claim had to change when the microphone arrived.

                  It read "nothing identifying is ever sent", which was true of
                  every typed question and is not true of a spoken one: audio
                  cannot be redacted before it is transcribed, because the
                  transcription is what would tell you there was a name in it.
                  Leaving the old sentence up would have been the app's most
                  load-bearing promise, quietly false, on the screen that makes it.
                */}
                <AppText variant="footnote" color="textFaint">
                  Answered on this phone where it can be. Typed questions have names
                  swapped out before they are sent — speaking sends the recording itself.
                </AppText>
                <View style={styles.chips}>
                  {suggestions.map((q) => (
                    <Press
                      key={q}
                      haptic="light"
                      scaleTo={0.97}
                      onPress={() => send(q)}
                      style={[styles.chip, { backgroundColor: colors.surfaceHigh }]}>
                      <AppText variant="caption" color="textDim">
                        {q}
                      </AppText>
                    </Press>
                  ))}
                </View>
              </Animated.View>
            ) : null}

            {turns.map((turn) => {
              /*
                Resolved before the return, not inside it, so an answer that
                named nobody renders nothing at all rather than an empty row
                with a margin under every sentence.
              */
              const people =
                turn.role === 'app' && !turn.failed
                  ? (turn.partyIds ?? [])
                      .map((id) => data.parties.find((p) => p.id === id))
                      .filter((p): p is NonNullable<typeof p> => Boolean(p))
                      .slice(0, 8)
                  : [];

              return (
              <Animated.View
                key={turn.id}
                entering={FadeIn.duration(160)}
                style={[styles.turn, turn.role === 'you' ? styles.mine : styles.theirs]}>
                <View
                  style={[
                    styles.bubble,
                    turn.role === 'you'
                      ? { backgroundColor: colors.accent }
                      : { backgroundColor: colors.surfaceHigh },
                  ]}>
                  <AppText
                    variant="callout"
                    tint={
                      turn.role === 'you'
                        ? colors.accentText
                        : turn.failed
                          ? colors.warn
                          : colors.text
                    }
                    style={styles.bubbleText}>
                    {turn.text}
                  </AppText>
                </View>

                {/*
                  The people the answer is about, as things you can open.

                  Every answer already knows who it named — `partyIds` is carried
                  from the lookup that computed it — and until now the sheet threw
                  that away, so "29 customers owe you money" was a sentence you
                  could read and not act on. The screen this replaced did offer
                  them, which made the new surface a step backwards on the one
                  thing an answer is for: the next thing you do about it.
                */}
                {people.length > 0 ? (
                  <View style={styles.people}>
                    {people.map((party) => (
                      <Press
                        key={party.id}
                        haptic="light"
                        scaleTo={0.97}
                        accessibilityLabel={`Open ${party.name}`}
                        onPress={() => {
                          // Closed, not left open over the person. The sheet is
                          // mounted above every screen, so a push underneath it
                          // navigates somewhere the owner cannot see.
                          closeChat();
                          router.push(`/person/${party.id}` as never);
                        }}
                        style={[styles.person, { backgroundColor: colors.surface }]}>
                        <AppText variant="caption" color="textDim">
                          {party.name}
                        </AppText>
                      </Press>
                    ))}
                  </View>
                ) : null}
              </Animated.View>
              );
            })}

            {voice.problem ? (
              <Animated.View entering={FadeIn.duration(160)} style={[styles.turn, styles.theirs]}>
                <View style={[styles.bubble, { backgroundColor: colors.surfaceHigh }]}>
                  <AppText variant="callout" tint={colors.warn} style={styles.bubbleText}>
                    {voice.problem}
                  </AppText>
                </View>
              </Animated.View>
            ) : null}

            {thinking ? (
              <Animated.View
                entering={FadeIn.duration(160)}
                exiting={FadeOut.duration(120)}
                style={[styles.turn, styles.theirs, styles.thinking]}>
                <ActivityIndicator size="small" color={colors.textFaint} />
                <AppText variant="caption" color="textFaint">
                  Working it out
                </AppText>
              </Animated.View>
            ) : null}
          </ScrollView>

          {/* ------------------------------------------------------ input -- */}
          {/*
            The bar, still. Same height, same pill, same place — it has become
            the thing you type into rather than moved out of the way for one.
          */}
          <View style={styles.inputRow}>
              <View style={[styles.field, { backgroundColor: colors.surfaceHigh }]}>
                <TextInput
                  value={draft}
                  onChangeText={setDraft}
                  placeholder={voice.state === 'listening' ? 'Listening…' : 'Ask about your business'}
                  placeholderTextColor={voice.state === 'listening' ? colors.accent : colors.textFaint}
                  style={[styles.input, { color: colors.text }]}
                  returnKeyType="send"
                  onSubmitEditing={submit}
                  multiline={false}
                  editable={voice.state === 'idle'}
                  accessibilityLabel="Ask the assistant"
                />

                {/*
                  Inside the field, at the end of it, which is where every voice
                  input anybody has used sits. Hidden once there is text, because
                  at that point the owner has chosen to type and a second way to
                  ask is just a thing in the way.
                */}
                {draft.trim().length === 0 ? (
                  <Press
                    haptic="medium"
                    scaleTo={0.9}
                    onPress={() => (voice.state === 'listening' ? voice.stop() : voice.start())}
                    accessibilityRole="button"
                    accessibilityLabel={voice.state === 'listening' ? 'Stop listening' : 'Speak your question'}
                    style={styles.mic}>
                    {voice.state === 'listening' ? (
                      <Square size={15} color={colors.accent} strokeWidth={2.6} fill={colors.accent} />
                    ) : voice.state === 'thinking' ? (
                      <ActivityIndicator size="small" color={colors.textFaint} />
                    ) : (
                      <Mic size={19} color={colors.textDim} strokeWidth={2} />
                    )}
                  </Press>
                ) : null}
              </View>

              {/*
                The assistant button, become a plus.

                It is the same control in the same place at the same size — the
                one thing on screen that must not move between states — and what
                changes is only what it does now that the conversation is open.
              */}
              <Press
                haptic="medium"
                scaleTo={0.92}
                onPress={() => (draft.trim().length > 1 ? submit() : setMenu((v) => !v))}
                accessibilityRole="button"
                accessibilityLabel={draft.trim().length > 1 ? 'Send' : 'More'}
                style={styles.ai}>
                <LinearGradient
                  colors={AI_FIELD}
                  locations={[0, 0.5, 1]}
                  start={{ x: 0.1, y: 0 }}
                  end={{ x: 0.9, y: 1 }}
                  style={StyleSheet.absoluteFill}
                />
                {draft.trim().length > 1 ? (
                  <AiMark size={24} color="#FFFFFF" />
                ) : (
                  <Plus size={24} color="#FFFFFF" strokeWidth={2.4} />
                )}
              </Press>
          </View>

          {/* A popover, not a modal — three items are not worth a native window. */}
          {menu ? (
            <Animated.View
              entering={FadeIn.duration(140)}
              style={[styles.menu, { backgroundColor: colors.surfaceAlt }]}>
              {[
                { label: 'New conversation', run: () => clear() },
                { label: 'Assistant settings', run: () => router.push('/assistant' as never) },
                { label: 'Close', run: () => closeChat() },
              ].map((item) => (
                <Press
                  key={item.label}
                  haptic="light"
                  scaleTo={0.98}
                  onPress={() => {
                    setMenu(false);
                    item.run();
                  }}
                  style={styles.menuRow}>
                  <AppText variant="callout">{item.label}</AppText>
                </Press>
              ))}
            </Animated.View>
          ) : null}
        </GlassSurface>
      </Animated.View>
    </>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: space.gutter,
    right: space.gutter,
    alignSelf: 'center',
  },
  sheet: { flex: 1, overflow: 'hidden' },
  grabArea: { height: 22, alignItems: 'center', justifyContent: 'center' },
  grabber: { width: 38, height: 4, borderRadius: radius.pill },
  scroll: { flex: 1 },
  scrollBody: { padding: space.base, gap: space.sm, flexGrow: 1, justifyContent: 'flex-end' },
  empty: { gap: space.md, paddingBottom: space.sm },
  chips: { gap: space.xs },
  chip: {
    paddingVertical: space.sm,
    paddingHorizontal: space.md,
    borderRadius: radius.pill,
    alignSelf: 'flex-start',
  },
  turn: { maxWidth: '86%' },
  mine: { alignSelf: 'flex-end' },
  theirs: { alignSelf: 'flex-start' },
  bubble: { paddingVertical: space.sm, paddingHorizontal: space.md, borderRadius: radius.lg },
  bubbleText: { lineHeight: 21 },
  people: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs, marginTop: space.xs },
  person: {
    paddingVertical: space.xs,
    paddingHorizontal: space.sm,
    borderRadius: radius.pill,
  },
  thinking: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingVertical: space.xs },

  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    height: layout.tabBarHeight,
    paddingHorizontal: 6,
  },
  field: {
    flex: 1,
    height: 46,
    borderRadius: radius.pill,
    flexDirection: 'row',
    alignItems: 'center',
  },
  mic: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center', marginRight: 4 },
  input: {
    flex: 1,
    paddingHorizontal: space.base,
    fontSize: 15,
    // Android centres a single-line input badly without this.
    paddingVertical: Platform.OS === 'android' ? 0 : space.sm,
  },
  ai: {
    overflow: 'hidden',
    width: layout.dockAction,
    height: layout.dockAction,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  menu: {
    position: 'absolute',
    right: 6,
    bottom: layout.tabBarHeight + space.xs,
    minWidth: 200,
    borderRadius: radius.lg,
    overflow: 'hidden',
  },
  menuRow: { paddingVertical: space.md, paddingHorizontal: space.base },
});
