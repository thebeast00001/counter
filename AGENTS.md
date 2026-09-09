# Expo HAS CHANGED

Read the exact versioned docs at https://docs.expo.dev/versions/v57.0.0/ before writing any code.

Two SDK 57 changes this project already hit, both of which fail quietly rather than loudly:

- `@react-navigation/*` is **not** an installed package. expo-router vendors it. Derive
  navigator prop types from the public exports instead, e.g.
  `Parameters<NonNullable<ComponentProps<typeof Tabs>['tabBar']>>[0]`.
- `expo-blur` on Android needs a `<BlurTargetView>` and its ref passed as `blurTarget`.
  Without it, blur silently falls back to `none`. The prop `experimentalBlurMethod` was
  renamed to `blurMethod`.

  **Do not wrap the tab navigator in `<BlurTargetView>`.** Doing so crashes the app with
  `Fatal signal 11 (SIGSEGV)` in RenderThread on every screen transition — the blur samples
  a subtree containing the blurring view and recurses until the native stack overflows. It
  is a hard native crash, not a JS error, so nothing appears in the Metro logs; you only see
  it via `adb logcat`. Android bars therefore use an opaque fill (see `GlassSurface`), and
  real blur is iOS-only.

- `expo-contacts` in SDK 57 is a **new module**. `getContactsAsync` / `Contacts.Fields`
  still export, but only as shims that throw *"Method getContactsAsync imported from
  expo-contacts is deprecated"* at runtime — they typecheck and install cleanly and fail
  only on the device. Use `Contact.getAllDetails([ContactField.GIVEN_NAME, …])`, and pass
  the enum members rather than the equivalent string literals.

# Gotchas that cost real debugging time

- **Never wrap a whole `<Sheet>` in a pan gesture.** It swallows vertical drags
  before content sees them, so lists inside refuse to scroll and horizontal strips
  refuse to slide — with no error anywhere. The drag handle is the header only.
- **`Press` must be a single animated Pressable.** An earlier version put the style
  on an inner view, leaving the outer Pressable with no width; any child using
  `flex: 1` collapsed to zero and vanished silently.
- **State updaters must stay pure.** React may run them twice, so a `notifyActivity`
  or `setState` inside one fires duplicates. Compute outside, then set.
- **`CI=1` disables Metro's file watching.** Edits silently stop being served, which
  looks exactly like a caching bug.

# Performance — what actually costs frames

- **Never animate SVG geometry.** Driving `cx`/`cy`/`r` through `useAnimatedProps`
  invalidates the SVG and re-rasterises it every frame. Three screen-sized radial
  gradients behind every screen made *scrolling* sluggish app-wide, which looks like a
  list problem and is not. Rasterise once at the blob's own size, wrap it in an
  `Animated.View`, and animate `transform` — the compositor handles that for free. See
  `src/components/Aurora.tsx`.
- **Count the full-screen layers.** Each `LinearGradient` at `absoluteFill` is another
  full-screen overdraw. `DayBackground` mounts the outgoing daypart only while it is
  actually cross-fading, for exactly this reason.
- **A context value that changes identity re-renders every consumer.** `undo.tsx` is split
  into a frozen actions context and a live state context, because the combined value
  changed on every navigation and re-rendered every screen that only wanted `offerUndo`.
- **Prefer a popover to a `Modal` for small menus.** A native modal window is created and
  torn down on every open/close; for a three-item menu that teardown *is* the stutter.

## Colour has one source

The app is flat `colors.bg` everywhere except the mood panel at the top of home and the
full-bleed mesh on setup and the wrap. A time-of-day gradient used to run behind every
screen too, and the two contradicted each other — an afternoon's green field under an
amber "needs attention" face states two different things at once.

**The accent is a constant.** `DEFAULT_ACCENT` in `tokens.ts`, resolved in `theme.tsx`,
and nothing else. It was derived from the business's mood once; that went, but the stored
choice it left behind kept being read, so a phone carrying an old value ran the whole app
pink while a fresh install ran it blue — with no screen able to explain or change it. The
saved accent is no longer read and `setAccent` no longer exists. Do not add a colour
picker and do not reintroduce a per-business accent: colour that varies has to mean
something, and the one place it still varies is the home hero, where the time of day is
what it means.

The assistant button is the other fixed colour — `AI_FIELD`, a two-hue gradient rather
than the accent, so the one control present on every screen looks the same on every
screen. Its mark is white on all three stops and `scripts/contrast-audit.mjs` checks it.

## Setup installs nothing

`emptyData()`, not `buildSeed()`. Onboarding used to fabricate a plausible history and it
made every derived figure — churn, forecasts, findings — a lie the owner could not
distinguish from their own records. `buildSeed` survives for the opt-in "Load sample data"
in Settings, which is labelled as invented. Never wire it back into `finish()`.

# Accessibility and theming

- **Colour changes must pass the audit.** `node --experimental-strip-types scripts/contrast-audit.mjs`
  imports the real tokens and checks all 58 foreground/background pairs against WCAG AA,
  compositing translucent colours first. It exits non-zero on failure.
- **`accentText` inverts between schemes.** Light mode puts white on a deep accent; dark
  mode puts near-black on a light one. Carrying white into dark mode drops button labels
  to ~2.8:1 against their own fill.
- **Reduce motion is scoped, not global.** `useMotion()` suppresses entrances, the breathing
  ring, the edit wiggle, and the digit roll. Short press feedback stays — it communicates
  state, and removing it makes the app feel broken rather than calmer.
- **Every tappable thing needs a role.** `Press` defaults to `button`; anything that is
  really a checkbox, radio, or switch passes its own and wins.

# Project conventions

- **Tab routes need the group prefix.** `router.push('/money')` navigates to the tab
  *group*, whose initial route is Today — so it silently lands on the home screen. Always
  `/(tabs)/money`.
- **Never hardcode a colour, size, radius, or spring.** They live in `src/design/tokens.ts`.
  If a value is missing, add it to the scale rather than inlining it.
- **All text goes through `<AppText>`** with a `variant` from the type scale. Screens never
  set `fontSize` or `fontFamily`. Anything that ticks needs `tabular`.
- **All tappable surfaces use `<Press>`**, which pairs the scale-down with a haptic. Custom
  `Pressable`s drift from the app's feel.
- **Animate with springs** from `tokens.ts`, not `withTiming`. Durations are for opacity only.
- **The React Compiler is on.** Render must be pure — no `Date.now()`, `Math.random()`, or
  other impure reads during render. Thread them in as state or props.
- **No network calls, with two bounded exceptions.** Everything the owner sees is derived
  on device from records in `src/state/data.ts`. The only files permitted to touch the
  network are `src/state/sync.ts` (Supabase, opt-in) and `src/ai/provider.ts` (the model,
  opt-in). Do not add `fetch` anywhere else — if a feature seems to need it, it almost
  certainly needs a domain function instead.

## The AI engine

`src/ai/` is deliberately narrow, and the constraints are what make it safe rather than
impressive. Breaking any of the three turns a useful feature into a liability:

- **The model never produces a number.** It picks one of the lookups in `src/ai/tools.ts`
  and phrases the result. Every figure is computed by the same domain code the rest of the
  app uses. A model asked for someone's balance will invent a plausible one — so it is
  never asked.
- **Nothing identifying leaves the device, with one named exception.** `src/ai/redact.ts`
  swaps names, phone numbers and free-text details for tokens (`P4`) before the request and
  restores them after. New tool output must go through the curtain, and conversation history
  must be stored redacted — revealing for display and then replaying that text is the usual
  way this promise quietly breaks.

  The exception is **voice**. `transcribe()` sends the recording as it was made, because
  audio cannot be redacted before it is transcribed — the transcription is the thing that
  would tell you a name was in it. The exposure is one hop and no further: what comes back
  goes through the curtain like a typed question. Do not widen it, and do not let any
  surface claim that nothing identifying is ever sent while the microphone is on it — the
  empty state in `AssistantSheet` says which is which, and that sentence is load-bearing.
- **The device answers first.** `src/domain/query.ts` handles the common questions exactly
  and offline; the model is only reached for on a miss. Never route a question the device
  already understands.

  Every pattern in `query.ts` is English, and that is deliberate: `src/domain/vernacular.ts`
  translates the question into the vocabulary those patterns already speak, rather than
  each branch learning four languages. It **appends** rather than replaces, because
  `resolveParty` looks for customer names in the same string and the original words have to
  survive. Two rules keep it from firing on English — match phrases rather than single
  words (`log`, `band`, `top` and `kal` are all English or ambiguous), and emit exactly one
  intent, since two would land in whichever branch `query.ts` happens to check first.

  The token a rule emits must be one an existing branch reads. A token no branch matches
  fails silently and identically to a question the device cannot answer — it just goes to
  the model — so `vernacular.test.ts` asserts each one all the way through `ask()` rather
  than only through `normalise()`.

The provider is **Sarvam**, an Indian service, so the request and the answer stay in the
country. Two things about it are not the OpenAI-shaped defaults, and both broke something:

- **A rejected key returns 403, not 401.** 403 is the status the fallback reads as "this one
  model will not serve", so a wrong key walked the whole roster and reported that no model
  was available. `classifyFailure` therefore reads the body's machine-readable `code` first
  (`invalid_api_key_error`) and the status only as a fallback.
- **`sarvam-105b` is a reasoning model and cannot answer a short question.** It spends the
  budget in `reasoning_content` and returns `content: null` — asked for the single word "ok"
  inside 400 tokens it used all 400 and said nothing. `sarvam-105b-conversations` answered in
  three, and is `DEFAULT_MODEL`. Sarvam's `/models` rows carry no pricing and no modality, so
  nothing in the catalogue distinguishes the two: the reasoning list in `provider.ts` does.

## The assistant is a surface, not a screen

`AssistantSheet` is mounted once in `_layout.tsx`, above both bars, and pulls up out of
whichever one is showing. Tapping the orb opens it; the bar becomes the field you type
into and the orb becomes a `+`. Three stages — closed, open, full — and the pan is
continuous between them.

- **The bar hides while it is up.** `Dock` and `ContextDock` both return null when
  `stage !== 'closed'`, because the sheet occupies the same spot at the same size and two
  of them is two bars stacked. The early return is after every hook in both files.
- **The drag lives on the grabber, not the input row.** The first version put the pan on
  the row, which is where a thumb goes — and it did nothing, because the row is mostly a
  `TextInput` and a text field keeps its own touches. A strip that is not a control is the
  only thing a pan can own outright.
- **There is no real blur, on Android.** `GlassSurface` is a system blur on iOS and a fill
  on Android for the SIGSEGV reason above. The scrim does the separating instead.
- **A no-tool plan is a conversation, not a failure.** `engine.ts` used to throw when the
  planner correctly answered `{"tool": null}`, so "hello" — and everything else that is not
  a question about a figure — dead-ended. It now falls through to `CHAT_SYSTEM`, which has
  no lookup result in front of it and is told in the plainest terms that it may not state a
  figure. The invariant is unchanged and is enforced twice: by never handing that turn a
  number, and by saying so.

`scripts/ai-check.mjs` asserts the curtain holds against real seeded names, first names and
phone numbers, and pins both decisions above against the live API's real status codes and
error bodies. Run it after touching anything in `src/ai/`.

# The derivation layer must survive an empty business

`emptyData()` is what a real owner has on the morning they finish onboarding, and every
figure on every screen is derived from records. A `reduce` with no seed, a `Math.max` over
an empty list, or a divide by a count of zero all look fine against a year of seeded
history and take the home screen down on day one.

`scripts/edge-check.mjs` runs the whole domain layer over six fixtures — empty, one person,
money with no people, people with no money, seeded, and everything future-dated by a wrong
device clock — and fails on a throw, a `NaN`, an `Infinity`, or an `undefined` reaching a
rendered string. Run it after touching anything in `src/domain/`:

```
node --experimental-strip-types --import ./scripts/ts-alias.mjs scripts/edge-check.mjs
```

# UPI: what is and is not possible

**There is no way to watch a UPI account from this app, and no amount of work will
change that.** NPCI exposes UPI only to licensed payment service providers; reading a
bank account with consent means being an RBI-registered Financial Information User on the
Account Aggregator network; `READ_SMS` is granted by Play Store only to an app that is the
phone's default SMS handler; and a notification listener is a native module Expo Go does
not ship. Do not add a "link your UPI" flow — it cannot work, and a feature that appears to
capture takings while capturing nothing is the worst failure this app could have.

The two paths that do work are both in `src/domain/upi.ts`:

- **`buildUpiIntent`** hands a payment to the customer's own UPI app. The app started it, so
  it already knows the payer, the amount and the purpose — the record is written from what
  it already holds, not typed. Nothing is recorded until the owner confirms it went through,
  because Expo Go cannot read an activity result and an assumed payment inflates the day's
  takings with nothing on screen to show which figure is wrong.
- **`parseTransactions`** reads a paste of bank messages or a statement export.

Three rules the parser must keep:

- **Strip the balance before reading any number.** Almost every Indian bank SMS ends with the
  running balance, and it is usually the largest number in the message. `BALANCE_TAIL` exists
  because a parser that takes the first or biggest amount books somebody's whole account
  balance as a payment.
- **Suggest, never assert.** Every row carries the text it was read from, an incomplete read
  arrives unticked, and nothing reaches the ledger without a tap.
- **Dedupe on `MoneyEntry.ref`.** Re-pasting the same statement is what an owner does when
  unsure the first import worked; without the reference every re-import doubles the month.

`scripts/upi-check.mjs` covers six real bank formats, the balance trap, the refusals (OTPs,
balance enquiries, promotions), dedupe, party matching and the intent encoding. Run it after
touching `src/domain/upi.ts`.

# Auth is Clerk; data is Supabase

They are deliberately separate: Clerk owns who you are, Supabase owns what you recorded.

Clerk was chosen over Supabase's own phone auth for one concrete reason — **it delivers the
SMS itself**. Indian carriers require the sender and the exact message template registered
on a DLT platform under TRAI rules before they will carry an OTP; that is days of paperwork
per sender, and it applies to Twilio, MSG91 and every other aggregator equally. Clerk sends
on registrations it already holds.

The cost is paid in the database, and it is not optional:

- **RLS policies read `auth.jwt() ->> 'sub'`, never `auth.uid()`.** With Clerk issuing the
  token there is no Supabase user, so `auth.uid()` returns null and every policy matches
  nothing — every write fails and no amount of correct app code helps. See
  `supabase/clerk-migration.sql`.
- **`businesses.owner_id` is `text`, not `uuid`,** with no foreign key to `auth.users`. A
  Clerk user id looks like `user_2abc…`.
- **`getClient()` passes `accessToken`,** which turns Supabase's own auth off entirely.
  There is no session to persist and nothing to refresh, which is why the sealed session
  storage and AppState refresh wiring were removed rather than left dormant — Clerk's SDK
  owns both, and its token cache is in the Keystore for the same reason the old one was.
- **`clerkBridge.ts` is the only wire between them.** `useAuth()` is a hook and the Supabase
  client is a plain module; the provider registers `getToken` there on mount. `clerkSubject()`
  reads the id out of the token rather than from `useUser()`, so it is guaranteed to be the
  same value the policies will check.

# Credentials

- **Only two keys may ever reach the app: `sb_publishable_…` or a `role: anon` JWT.**
  Their twins — `sb_secret_…` and a `role: service_role` JWT — sit beside them on the same
  dashboard page and ignore Row Level Security completely. Pasting one produces no error:
  the app works perfectly while every tenant's records are readable by anyone who installs
  it. `validateUrl` / `validateAnonKey` in `src/state/supabase.ts` refuse those, plus
  `postgres://` connection strings and plain `http`; both run again in `getClient()`, so a
  config saved before the checks existed cannot be used either. `scripts/supabase-check.mjs`
  covers every case — run it after touching either validator.
- **`src/state/supabase.ts` must stay loadable in plain Node.** `react-native` and
  `@/state/vault` are both reached through a guarded `require` for that reason: a static
  import of either takes the two validators out of the check script's reach, and they are
  the functions in this file most worth testing.
- **`getKey()` in `src/state/vault.ts` must stay promise-memoised.** Concurrent first-launch
  callers each generating their own key is silent, permanent data loss: whichever key loses
  the last write can never open what it sealed.

Run `npx tsc --noEmit` before considering a change done.
