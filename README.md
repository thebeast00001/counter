# Counter

An operating system for a small business, on one phone.

Counter is built for the shop, gym, salon, tuition centre or garage where the
owner *is* the system — where the records live in a notebook, a WhatsApp thread
and their memory, and where every existing product assumes a back office that
does not exist.

## What it is

Everything is derived on the device from records the owner entered. There is no
server in the critical path: pull the wifi and every screen still works, because
every figure on every screen is computed locally from the same record set.

- **Today** — what the day looks like, what needs doing, what to do next.
- **People** — everyone, ordered by who is drifting away rather than by name.
- **Money** — what came in, what is owed, what went out.
- **Insights** — what the app has noticed, with the evidence attached.

The app speaks the trade's own language. A gym has Members and Check-ins, a
tuition centre Students and Classes, a garage Customers and Jobs — from one
answer at onboarding.

## What it refuses to do

The constraints are the product:

- **It installs nothing.** Onboarding creates an empty business, not a plausible
  fake one. A fabricated history makes every derived figure a lie the owner
  cannot distinguish from their own records.
- **It never invents a number.** The AI assistant picks a lookup and phrases the
  result; every figure is computed by the same domain code as the rest of the
  app. A model asked for a balance will produce a convincing one.
- **Nothing identifying leaves the device.** Names and phone numbers are swapped
  for tokens before any model request and restored afterwards.
- **It does not pretend to read UPI.** No app that is not a licensed payment
  provider can watch a UPI account. Counter collects *through* UPI, and reads
  statements you paste in — see `src/domain/upi.ts`.

## Running it

```bash
npm install
npx expo start          # then open in Expo Go on Android
```

Building for the store is in [`EAS.md`](./EAS.md).

## Checks

None of these are unit tests over mocks — each imports the real source, which is
what stops them drifting from what the app does.

```bash
npx tsc --noEmit
node --experimental-strip-types scripts/contrast-audit.mjs                            # WCAG AA + dichromacy
node --experimental-strip-types --import ./scripts/ts-alias.mjs scripts/edge-check.mjs      # empty business
node --experimental-strip-types --import ./scripts/ts-alias.mjs scripts/supabase-check.mjs  # key validation
node --experimental-strip-types --import ./scripts/ts-alias.mjs scripts/upi-check.mjs       # statement parser
node --experimental-strip-types --import ./scripts/ts-alias.mjs scripts/ai-check.mjs        # redaction curtain
node --experimental-strip-types --import ./scripts/ts-alias.mjs scripts/wrap-check.mjs
```

CI runs all of them, plus a scan that fails the build if a credential is
committed.

## Architecture

Auth is Clerk, backup is Supabase, and neither is required for the app to work.
`AGENTS.md` carries the decisions and the traps — read it before changing the
derivation layer, the AI engine, or anything touching credentials.
`docs/storage.md` describes the one scaling limit that is still open.
