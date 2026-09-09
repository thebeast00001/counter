import { Component, type ReactNode } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Press } from '@/components/Press';
import { ACCENTS, DEFAULT_ACCENT, palette, radius, space } from '@/design/tokens';

/**
 * The last line between a thrown render and a blank screen.
 *
 * There was nothing here at all, which for this app is the worst possible gap:
 * every screen is derived from the owner's records, so a single bad figure —
 * a date that will not parse, a shape from an older version of the app — took
 * the whole product down and left no way back in. The records were never
 * damaged; they just became unreachable, which to the person holding the phone
 * is the same thing.
 *
 * Three deliberate choices:
 *
 * 1. **It says the records are safe.** That is the first question anybody has,
 *    and it is true — nothing is written during a render.
 * 2. **Reset re-mounts rather than reloads.** A JS reload would lose the
 *    navigation stack and, in a dev build, take the app back through the splash;
 *    clearing the error and re-rendering the subtree is usually enough, because
 *    the common cause is one screen's data rather than the store.
 * 3. **It cannot use the theme.** A boundary that reads context is a boundary
 *    that throws when the context is what broke, so the colours here are the raw
 *    dark-scheme tokens rather than `useColors()`. This screen only ever appears
 *    over a broken app, so a fixed dark treatment is honest.
 *
 * Deliberately a class. Function components still have no hook equivalent of
 * `componentDidCatch` — `react-error-boundary` wraps a class for the same reason.
 */

/** The one accent, read straight from the table — see `theme.tsx`. */
const ACCENT = ACCENTS[DEFAULT_ACCENT].dark;

type Props = {
  children: ReactNode;
  /** Told about every caught error, for whatever reporting is wired up. */
  onError?: (error: Error, stack: string) => void;
};

type State = { error: Error | null };

export class Catch extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: { componentStack?: string | null }) {
    this.props.onError?.(error, info.componentStack ?? '');
  }

  reset = () => {
    this.setState({ error: null });
  };

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <View style={styles.root}>
        <ScrollView contentContainerStyle={styles.body}>
          <AppText variant="title2" tint={palette.dark.text}>
            This screen stopped
          </AppText>

          <AppText variant="body" tint={palette.dark.textDim} style={styles.line}>
            Something in the app failed while drawing this screen. Your records are safe — nothing
            is written while a screen is being drawn, and everything you have recorded is still on
            this phone.
          </AppText>

          <Press
            haptic="medium"
            scaleTo={0.97}
            onPress={this.reset}
            accessibilityRole="button"
            accessibilityLabel="Try again"
            style={[styles.button, { backgroundColor: ACCENT.accent }]}>
            <AppText variant="callout" tint={ACCENT.accentText}>
              Try again
            </AppText>
          </Press>

          {/*
            The message, verbatim and always. An owner cannot act on it, but the
            person they send a screenshot to can — and hiding it behind a
            "details" tap means the one screenshot that ever gets taken is the
            one without the cause in it.
          */}
          <View style={styles.detail}>
            <AppText variant="caption" tint={palette.dark.textFaint}>
              {error.message || String(error)}
            </AppText>
          </View>
        </ScrollView>
      </View>
    );
  }
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: palette.dark.bg },
  body: { flexGrow: 1, justifyContent: 'center', padding: space.gutter, gap: space.base },
  line: { lineHeight: 22 },
  button: {
    height: 50,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: space.sm,
  },
  detail: {
    marginTop: space.base,
    padding: space.md,
    borderRadius: radius.md,
    backgroundColor: palette.dark.surface,
  },
});
