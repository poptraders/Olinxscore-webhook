// TEMPORARY TEST VERSION — signature verification is disabled below so we can
// confirm the tier-detection and SMS-sending logic works before Kopo Kopo is
// actually connected. Replace this with the real worker.js (which has real
// signature verification) before going live — never leave this test version
// running once real payments are involved, since it would accept fake
// "payment" notifications from anyone.

export default {
  async fetch(request, env) {
    if (request.method !== 'POST') {
      return new Response('Method not allowed', { status: 405 });
    }

    const rawBody = await request.text();

    // --- Signature check temporarily skipped for testing ---
    // const signature = request.headers.get('X-KopoKopo-Signature') || '';
    // const isValid = await verifySignature(rawBody, signature, env.KOPOKOPO_CLIENT_SECRET);
    // if (!isValid) return new Response('Invalid signature', { status: 401 });

    let payload;
    try {
      payload = JSON.parse(rawBody);
    } catch (e) {
      return new Response('Bad JSON', { status: 400 });
    }

    if (payload.topic !== 'buygoods_transaction_received') {
      return new Response('Ignored — not a payment event', { status: 200 });
    }
    const resource = payload.event?.resource;
    if (!resource || resource.status !== 'Received') {
      return new Response('Ignored — payment not yet completed', { status: 200 });
    }

    const amount = Number(resource.amount);
    const phone = resource.sender_phone_number;

    let inviteLink, tierName;
    if (amount >= 300) {
      inviteLink = env.SEASON_TICKET_LINK;
      tierName = 'Season Ticket';
    } else if (amount >= 100) {
      inviteLink = env.MATCHDAY_PASS_LINK;
      tierName = 'Matchday Pass';
    } else {
      return new Response('Amount did not match a known tier', { status: 200 });
    }

    const message = `Olinxscore: payment received, welcome to the ${tierName}! Join here: ${inviteLink}`;
    const smsResult = await sendSms(phone, message, env);

    return new Response(`OK — sent SMS attempt. Provider response: ${smsResult}`, { status: 200 });
  },
};

async function sendSms(to, message, env) {
  const endpoint = env.AT_SANDBOX === 'true'
    ? 'https://api.sandbox.africastalking.com/version1/messaging'
    : 'https://api.africastalking.com/version1/messaging';

  const body = new URLSearchParams({
    username: env.AT_USERNAME,
    to,
    message,
  });

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      apiKey: env.AT_API_KEY,
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: body.toString(),
  });
  return await res.text();
}
