import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useColorScheme as useSystemScheme } from 'react-native';

import { KEYS, loadJSON, saveJSON } from '@/state/persist';
import {
  ACCENTS,
  DEFAULT_ACCENT,
  palette,
  type AccentName,
  type Palette,
  type SchemeName,
} from './tokens';

/** 'system' follows the OS; the other two pin it. */
export type SchemePreference = SchemeName | 'system';

type ThemeContextValue = {
  colors: Palette;
  scheme: SchemeName;
  preference: SchemePreference;
  setPreference: (next: SchemePreference) => void;
  /** Replaces green with a blue-teal so good/bad does not rely on red vs green. */
  colourSafe: boolean;
  setColourSafe: (next: boolean) => void;
  isDark: boolean;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const system = useSystemScheme();
  const [preference, setPreferenceState] = useState<SchemePreference>('dark');
  const [colourSafe, setColourSafeState] = useState(false);

  // Restore saved preferences once on mount. Until they resolve we render dark
  // with the default accent, which matches the splash and avoids a white flash.
  useEffect(() => {
    let active = true;
    Promise.all([
      loadJSON<SchemePreference>(KEYS.scheme, 'dark'),
      loadJSON<boolean>(KEYS.colourSafe, false),
    ])
      .then(([savedScheme, savedColourSafe]) => {
        if (!active) return;
        if (savedScheme === 'dark' || savedScheme === 'light' || savedScheme === 'system') {
          setPreferenceState(savedScheme);
        }
        if (typeof savedColourSafe === 'boolean') setColourSafeState(savedColourSafe);
      })
      .catch(() => {
        // Storage is best-effort; the in-memory defaults are a fine fallback.
      });
    return () => {
      active = false;
    };
  }, []);

  const setPreference = useCallback((next: SchemePreference) => {
    setPreferenceState(next);
    saveJSON(KEYS.scheme, next);
  }, []);

  const setColourSafe = useCallback((next: boolean) => {
    setColourSafeState(next);
    saveJSON(KEYS.colourSafe, next);
  }, []);

  const scheme: SchemeName =
    preference === 'system' ? (system === 'light' ? 'light' : 'dark') : preference;

  // The accent overrides the base palette's three accent roles, so every
  // component keeps reading `colors.accent` and none of them need to know the
  // preference exists.
  //
  // Colour-safe mode overrides `success` the same way. Around one man in twelve
  // cannot separate red from green reliably, and this app spends those two
  // colours on its most important distinction — money in against money owed.
  // Swapping green for a blue-teal keeps the signal on a hue axis that survives
  // the most common form of colour blindness, and every component keeps reading
  // `colors.success` without knowing anything changed.
  /**
   * The accent. One colour, everywhere, on every device.
   *
   * It was derived from the business's mood once, so the tab pill, the chips and
   * every icon changed hue as the day went. That went, but the *stored* choice
   * it left behind did not: `ThemeProvider` kept reading a saved accent that no
   * screen could still set, so a phone carrying an old value showed a pink app
   * and a fresh install showed a blue one, with nothing in the product able to
   * explain the difference or change it back.
   *
   * So the accent is now the token and only the token. Colour that varies has to
   * mean something; the one place it still varies is the home hero, where the
   * time of day is the thing it means.
   */
  const effectiveAccent: AccentName = DEFAULT_ACCENT;

  const colors = useMemo<Palette>(() => {
    const base = { ...palette[scheme], ...ACCENTS[effectiveAccent][scheme] };
    if (!colourSafe) return base;
    return {
      ...base,
      success: scheme === 'dark' ? '#5FC7D2' : '#0E7480',
      successSoft: scheme === 'dark' ? 'rgba(95,199,210,0.16)' : 'rgba(14,116,128,0.12)',
    };
  }, [scheme, effectiveAccent, colourSafe]);

  const value = useMemo<ThemeContextValue>(
    () => ({
      colors,
      scheme,
      preference,
      setPreference,
      colourSafe,
      setColourSafe,
      isDark: scheme === 'dark',
    }),
    [
      colors,
      scheme,
      preference,
      setPreference,
      colourSafe,
      setColourSafe,
    ],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used inside <ThemeProvider>');
  return ctx;
}

/** Shorthand for the common case of only needing the palette. */
export function useColors(): Palette {
  return useTheme().colors;
}
