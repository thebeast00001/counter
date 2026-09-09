import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

import { KEYS, loadJSON, saveJSON } from '@/state/persist';

/**
 * Localisation.
 *
 * English is the source of truth: every key's English value is the string a
 * developer would otherwise have typed inline, so a missing translation falls
 * back to real copy rather than to a key name leaking into the UI.
 *
 * Coverage today is navigation, the Plan screen, empty states, and shared
 * actions — the strings a user meets in the first minute. Screens still holding
 * literals are being migrated; `t()` is safe to introduce one call site at a
 * time because the fallback never fails.
 */
export type Locale = 'en' | 'hi';

export const LOCALES: { value: Locale; label: string; native: string }[] = [
  { value: 'en', label: 'English', native: 'English' },
  { value: 'hi', label: 'Hindi', native: 'हिन्दी' },
];

const en = {
  'tab.today': 'Today',
  'tab.plan': 'Plan',
  'tab.rooms': 'Rooms',
  'tab.insights': 'Insights',
  'tab.you': 'You',

  'action.start': 'Start',
  'action.pause': 'Pause',
  'action.resume': 'Resume',
  'action.cancel': 'Cancel',
  'action.save': 'Save',
  'action.delete': 'Delete',
  'action.undo': 'Undo',
  'action.done': 'Done',
  'action.add': 'Add',

  'plan.title': 'Plan',
  'plan.tasks': 'Tasks',
  'plan.calendar': 'Calendar',
  'plan.clear': 'Nothing outstanding',
  'plan.open': '{count} open',
  'plan.overdue': 'Overdue',
  'plan.today': 'Today',
  'plan.tomorrow': 'Tomorrow',
  'plan.upcoming': 'Upcoming',
  'plan.someday': 'Someday',
  'plan.completed': 'Completed',
  'plan.emptyTitle': 'No tasks yet',
  'plan.emptyBody':
    'Add what you need to get done, then start a session against it. Time you focus gets credited to the task automatically.',
  'plan.emptyAction': 'Add your first task',
  'plan.nothingScheduled': 'Nothing scheduled — add a task',

  'session.focusing': 'Focusing',
  'session.paused': 'Paused',
  'session.reached': 'Goal reached',
  'session.end': 'End session',
  'session.left': '{time} left',
  'session.over': '{time} over',
  'session.saved': 'Session saved',
  'session.savedBody': '{minutes}m added to today',

  'you.appearance': 'Appearance',
  'you.language': 'Language',
  'you.dailyGoal': 'Daily goal',
  'you.categories': 'Categories',
  'you.privacy': 'Privacy & security',
  'you.data': 'Data',
  'you.about': 'About',
} as const;

export type StringKey = keyof typeof en;

/**
 * Hindi. Deliberately partial — the fallback means an untranslated key shows
 * correct English rather than a broken interface, so shipping a real subset
 * beats shipping machine-translated guesses for everything.
 */
const hi: Partial<Record<StringKey, string>> = {
  'tab.today': 'आज',
  'tab.plan': 'योजना',
  'tab.rooms': 'कक्ष',
  'tab.insights': 'विश्लेषण',
  'tab.you': 'आप',

  'action.start': 'शुरू करें',
  'action.pause': 'रोकें',
  'action.resume': 'जारी रखें',
  'action.cancel': 'रद्द करें',
  'action.save': 'सहेजें',
  'action.delete': 'हटाएँ',
  'action.undo': 'पहले जैसा',
  'action.done': 'पूर्ण',
  'action.add': 'जोड़ें',

  'plan.title': 'योजना',
  'plan.tasks': 'कार्य',
  'plan.calendar': 'कैलेंडर',
  'plan.clear': 'कुछ बाकी नहीं',
  'plan.open': '{count} बाकी',
  'plan.overdue': 'समय बीत गया',
  'plan.today': 'आज',
  'plan.tomorrow': 'कल',
  'plan.upcoming': 'आगामी',
  'plan.someday': 'कभी',
  'plan.completed': 'पूर्ण',
  'plan.emptyTitle': 'अभी कोई कार्य नहीं',

  'session.focusing': 'ध्यान में',
  'session.paused': 'रुका हुआ',
  'session.reached': 'लक्ष्य पूरा',
  'session.end': 'सत्र समाप्त करें',

  'you.appearance': 'रूप',
  'you.language': 'भाषा',
  'you.dailyGoal': 'दैनिक लक्ष्य',
  'you.categories': 'श्रेणियाँ',
  'you.privacy': 'गोपनीयता और सुरक्षा',
  'you.data': 'डेटा',
  'you.about': 'परिचय',
};

const TABLES: Record<Locale, Partial<Record<StringKey, string>>> = { en, hi };

type Params = Record<string, string | number>;

function interpolate(template: string, params?: Params): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (whole, key) =>
    key in params ? String(params[key]) : whole,
  );
}

type I18nValue = {
  locale: Locale;
  setLocale: (next: Locale) => void;
  t: (key: StringKey, params?: Params) => string;
};

const I18nContext = createContext<I18nValue | null>(null);

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>('en');

  useEffect(() => {
    let alive = true;
    loadJSON<Locale>(KEYS.locale, 'en').then((saved) => {
      if (alive && saved in TABLES) setLocaleState(saved);
    });
    return () => {
      alive = false;
    };
  }, []);

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
    saveJSON(KEYS.locale, next);
  }, []);

  const t = useCallback(
    (key: StringKey, params?: Params) =>
      interpolate(TABLES[locale][key] ?? en[key], params),
    [locale],
  );

  const value = useMemo<I18nValue>(() => ({ locale, setLocale, t }), [locale, setLocale, t]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n must be used inside <I18nProvider>');
  return ctx;
}

/** Shorthand for the common case of only needing the translate function. */
export function useT(): I18nValue['t'] {
  return useI18n().t;
}
