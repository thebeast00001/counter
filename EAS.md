# Building

The app runs in Expo Go during development, but Expo Go cannot ship — it has no
package name, no signing key, and none of the native modules a store build needs.
These are the three profiles in `eas.json`.

```bash
npx eas build --profile preview    --platform android   # APK, sideloadable
npx eas build --profile production --platform android   # AAB, for Play
npx eas submit --profile production --platform android
```

## Before the first production build

- `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY` must be set on the **production** profile
  to a Clerk *production* instance key (`pk_live_…`). The `preview` profile
  carries the development key deliberately, so an internal build cannot
  accidentally write to real accounts. A development Clerk instance is capped at
  20 SMS a month and is not a production auth system.
- `appVersionSource: "remote"` means EAS owns `versionCode`. Do not also bump it
  by hand in `app.json` — two sources of truth for a build number produces
  rejected uploads that look like nothing is wrong.
- `releaseStatus: "draft"` on submit is deliberate. The first upload of a new
  package name must be promoted by hand in the Play Console, and an automated
  submit that goes straight to a track is how an unfinished build reaches users.

## Over-the-air updates

`runtimeVersion` is on the `fingerprint` policy, so an update carrying new native
code cannot be delivered to a build that does not have it — the fingerprint
changes and the update is simply not offered. Anything that only changes
JavaScript ships with:

```bash
npx eas update --branch production
```

## You need one domain, and it solves three things

A production Clerk instance is not a settings toggle — it is a **domain you
control**, with CNAME records pointed at Clerk so the Frontend API is served
from it. That is true for a mobile-only app too, which is the part that
surprises people: there is no phone-only production tier. A free host's own
subdomain (`you.github.io`) will not do, because you cannot add DNS records to
somebody else's domain.

So buy one domain and it covers everything the store asks for:

| What | Where |
| --- | --- |
| Clerk production instance | CNAME records on the domain |
| Privacy policy URL (required by Play) | a page on it |
| Account deletion URL (required by Play) | `web/delete-account.html` |

`web/` holds the pages, deliberately as plain HTML and CSS with no build step —
they have to stay servable for as long as the app is listed, and a toolchain is
a thing that rots. Drop the folder on GitHub Pages, Netlify or Cloudflare Pages
and point the domain at it.

The support address is `SUPPORT_EMAIL` in `src/config.ts`, used by the app and
both pages. Change it before submitting: the Play listing points at it, and a
deletion request that reaches nobody is a policy breach rather than an inbox
problem.
