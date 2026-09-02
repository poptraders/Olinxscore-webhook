// Olinxscore — payment-to-access automation
//
// What this does:
// 1. Kopo Kopo calls this URL the instant someone pays your Till number.
// 2. We verify the request genuinely came from Kopo Kopo (HMAC signature check).
// 3. We check how much was paid, to figure out which tier they bought.
// 4. We automatically text them the invite link via Africa's Talking — no manual
//    "send proof of payment" step needed on their end or yours.
//
// This file goes straight into Cloudflare's online Worker editor — no build step,
// no npm install, nothing to run locally. Just paste and deploy.

export default {
  async fetch(request, env) {
    if (request.method !== 'POST') {
      return new Response('Method not allowed', { status: 405 });
    }

    // Read the raw text FIRST — the signature is computed over the exact raw
    // bytes Kopo Kopo sent, not the parsed JSON, so this order matters.
    const rawBody = await request.text();
    const signature = request.headers.get('X-KopoKopo-Signature') || '';

    const isValid = await verifySignature(rawBody, signature, env.KOPOKOPO_CLIENT_SECRET);
    if (!isValid) {
      return new Response('Invalid signature', { status: 401 });
    }

    let payload;
    try {
      payload = JSON.parse(rawBody);
    } catch (e) {
      return new Response('Bad JSON', { status: 400 });
    }

    // We only care about actual completed Buy Goods payments.
    if (payload.topic !== 'buygoods_transaction_received') {
      return new Response('Ignored — not a payment event', { status: 200 });
    }
    const resource = payload.event?.resource;
    if (!resource || resource.status !== 'Received') {
      return new Response('Ignored — payment not yet completed', { status: 200 });
    }

    const amount = Number(resource.amount);
    const phone = resource.sender_phone_number; // e.g. "+254712345678"

    // Match the amount to a tier. Adjust these thresholds if you change pricing.
    let inviteLink, tierName;
    if (amount >= 300) {
      inviteLink = env.SEASON_TICKET_LINK;
      tierName = 'Season Ticket';
    } else if (amount >= 100) {
      inviteLink = env.MATCHDAY_PASS_LINK;
      tierName = 'Matchday Pass';
    } else {
      // Someone paid an amount that doesn't match either tier — don't grant
      // access automatically; you'll want to check this manually.
      return new Response('Amount did not match a known tier', { status: 200 });
    }

    const message = `Olinxscore: payment received, welcome to the ${tierName}! Join here: ${inviteLink}`;
    await sendSms(phone, message, env);

    return new Response('OK', { status: 200 });
  },
};

// Recomputes the HMAC-SHA256 signature the same way Kopo Kopo does, and checks
// it matches what they sent — this is what stops anyone else from pretending
// to be a Kopo Kopo payment notification.
async function verifySignature(rawBody, signatureHeader, secret) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sigBuffer = await crypto.subtle.sign('HMAC', key, enc.encode(rawBody));
  const computedHex = [...new Uint8Array(sigBuffer)]
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
  return computedHex === signatureHeader;
}

async function sendSms(to, message, env) {
  const endpoint = env.AT_SANDBOX === 'true'
    ? 'https://api.sandbox.africastalking.com/version1/messaging'
    : 'https://api.africastalking.com/version1/messaging';

  const body = new URLSearchParams({
    username: env.AT_USERNAME,
    to,
    message,
  });

  await fetch(endpoint, {
    method: 'POST',
    headers: {
      apiKey: env.AT_API_KEY,
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: body.toString(),
  });
}
