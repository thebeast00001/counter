# Edge functions

Deno, not React Native. They run on Supabase's servers, import from URLs, and use
the `Deno` global — none of which the app's TypeScript config knows about, which
is why `supabase/functions` is excluded from it. Typecheck them with the Supabase
CLI (`supabase functions serve`) rather than `npx tsc`.

## send-sms

Delivers Supabase Auth's OTP through MSG91, because MSG91 is not one of the
providers Supabase can call directly. See the header comment in `send-sms/index.ts`
for the division of labour and the India DLT constraint.
