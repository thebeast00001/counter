/**
 * Supabase Send SMS Hook → MSG91.
 *
 * Supabase Auth generates and verifies the six-digit code; it has no way to
 * deliver one. For the providers it knows about (Twilio, Vonage, MessageBird,
 * TextLocal) delivery is a form in the dashboard. MSG91 is not one of them, so
 * delivery becomes this function: Supabase posts the code here, and here it is
 * handed to MSG91's Flow API.
 *
 * ## The division of labour, which is the part worth getting right
 *
 * Supabase owns the OTP. MSG91 also sells an OTP product that generates and
 * verifies codes of its own — do not use it here. Two systems each issuing a
 * code means the one the customer receives is not the one the app checks, and
 * the failure looks like "the code is always wrong" rather than like a
 * misconfiguration. This uses MSG91's *Flow* API, which sends a message and
 * nothing else.
 *
 * ## India will still refuse to deliver this until DLT is done
 *
 * MSG91 is an Indian aggregator, so there is no international route to hide
 * behind: TRAI requires the sender ID and the exact message template to be
 * registered on a DLT platform before any carrier will deliver. `MSG91_FLOW_ID`
 * below *is* that registered template. Nothing in this file can shortcut it.
 *
 * ## Deploy
 *
 *   supabase functions deploy send-sms --no-verify-jwt
 *   supabase secrets set MSG91_AUTHKEY=... MSG91_FLOW_ID=... MSG91_SENDER=...
 *   supabase secrets set SEND_SMS_HOOK_SECRET=v1,whsec_...
 *
 * `--no-verify-jwt` is required and is not a hole: Supabase Auth calls this
 * before any user exists, so there is no JWT to present. The webhook signature
 * below is what authenticates the caller, and it is why the secret is not
 * optional.
 */

import { Webhook } from 'https://esm.sh/standardwebhooks@1.0.0';

const AUTHKEY = Deno.env.get('MSG91_AUTHKEY') ?? '';
const FLOW_ID = Deno.env.get('MSG91_FLOW_ID') ?? '';
const SENDER = Deno.env.get('MSG91_SENDER') ?? '';
const HOOK_SECRET = Deno.env.get('SEND_SMS_HOOK_SECRET') ?? '';

type HookPayload = {
  user: { phone?: string };
  sms: { otp: string };
};

/**
 * MSG91 wants digits only, with the country code and no `+`.
 *
 * Supabase stores the number in E.164, so the plus has to come off. Sending it
 * through is not an error — MSG91 accepts the request and the message silently
 * never arrives, which is the worst of both.
 */
function toMsg91(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  return digits.length === 10 ? `91${digits}` : digits;
}

Deno.serve(async (request) => {
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'POST only' }), { status: 405 });
  }

  const raw = await request.text();

  /*
    Verified before anything is read out of the body.

    This endpoint is public — it has to be, Supabase calls it unauthenticated —
    so without the signature check anyone who found the URL could post a phone
    number and a code of their own choosing and have it delivered over your
    sender ID, at your cost. Standard Webhooks, which is what Supabase signs
    with.
  */
  if (!HOOK_SECRET) {
    return new Response(JSON.stringify({ error: 'SEND_SMS_HOOK_SECRET is not set' }), {
      status: 500,
    });
  }

  let payload: HookPayload;
  try {
    const webhook = new Webhook(HOOK_SECRET.replace('v1,whsec_', ''));
    payload = webhook.verify(raw, Object.fromEntries(request.headers)) as HookPayload;
  } catch {
    return new Response(JSON.stringify({ error: 'bad signature' }), { status: 401 });
  }

  const phone = payload.user?.phone;
  const otp = payload.sms?.otp;
  if (!phone || !otp) {
    return new Response(JSON.stringify({ error: 'no phone or otp in payload' }), { status: 400 });
  }

  const response = await fetch('https://control.msg91.com/api/v5/flow/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', authkey: AUTHKEY },
    body: JSON.stringify({
      flow_id: FLOW_ID,
      sender: SENDER,
      // VAR1 is the placeholder in the DLT-registered template. If the template
      // reads "Your Counter code is ##VAR1##", this is the only thing that
      // varies — anything else and the carrier rejects it as an unregistered
      // message, whatever the sender ID says.
      recipients: [{ mobiles: toMsg91(phone), VAR1: otp }],
    }),
  });

  /*
    MSG91 answers 200 with `type: "error"` for real failures, so the status code
    alone says nothing. Reading the body is what turns "sent" into "delivered" —
    and returning non-200 here is what makes the app show a useful message
    instead of pretending a code is on its way.
  */
  const result = await response.json().catch(() => ({ type: 'error', message: 'unreadable' }));
  if (!response.ok || result?.type === 'error') {
    console.error('msg91 refused', result);
    return new Response(
      JSON.stringify({ error: { message: `MSG91: ${result?.message ?? 'send failed'}` } }),
      { status: 502, headers: { 'Content-Type': 'application/json' } },
    );
  }

  return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
});
