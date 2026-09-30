import { timingSafeEqual } from 'node:crypto';

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
});
function equalToken(a, b) {
  if (!a || !b) return false;
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(value + 'T00:00:00Z');
  return !isNaN(parsed) && parsed.toISOString().slice(0, 10) === value;
}

// Only the authenticated administrator can call this endpoint. It sends no email.
export default async function handler(req) {
  if (req.method !== 'POST') return json({ ok: false, message: 'Kun POST er tillatt.' }, 405);
  const { SUPABASE_URL, SUPABASE_SERVICE_KEY, BOOKING_CONFIRM_TOKEN } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY || !BOOKING_CONFIRM_TOKEN) {
    return json({ ok: false, message: 'Serverkonfigurasjonen er ufullstendig.' }, 500);
  }
  if (!equalToken(req.headers.get('x-admin-token'), BOOKING_CONFIRM_TOKEN)) {
    return json({ ok: false, message: 'Ugyldig tilgang.' }, 401);
  }
  let body;
  try { body = await req.json(); } catch { return json({ ok: false, message: 'Ugyldig JSON.' }, 400); }
  const id = Number(body?.supabase_id);
  if (!Number.isSafeInteger(id) || id <= 0 ||
      !/^HV-\d{4}-\d+$/.test(String(body?.booking_id || '')) ||
      !/^KAN-[a-f0-9-]{36}$/i.test(String(body?.cancellation_id || '')) ||
      !validDate(body?.fra_dato) || !validDate(body?.til_dato) ||
      body.fra_dato > body.til_dato ||
      typeof body?.epost !== 'string' || body.epost.length > 254 ||
      !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(body.epost) ||
      (body.operation !== 'cancel' && body.operation !== 'check')) {
    return json({ ok: false, message: 'Ugyldig ID, dato, e-post eller operasjon.' }, 400);
  }
  const base = new URL('/rest/v1/bookinger', SUPABASE_URL);
  base.searchParams.set('id', `eq.${id}`);
  base.searchParams.set('select', 'id,status,fra_dato,til_dato,epost');
  const headers = { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}` };
  async function readCurrent() {
    const response = await fetch(base, { headers, signal: AbortSignal.timeout(20000) });
    if (!response.ok) throw new Error('DATABASE_READ');
    const rows = await response.json();
    if (!Array.isArray(rows)) throw new Error('DATABASE_FORMAT');
    return rows[0];
  }
  function identityMatches(row) {
    return row.fra_dato === body.fra_dato && row.til_dato === body.til_dato &&
      String(row.epost).trim().toLowerCase() === body.epost.trim().toLowerCase();
  }
  try {
    const current = await readCurrent();
    if (!current) return json({ ok: false, message: 'Fant ikke bookingen.' }, 404);
    if (!identityMatches(current)) {
      return json({ ok: false, message: 'Dato eller e-post i arket samsvarer ikke med Supabase. Kontroller riktig booking.' }, 409);
    }
    if (body.operation === 'check') {
      return json({ ok: true, status: current.status, supabase_id: current.id });
    }
    if (current.status === 'cancelled') {
      return json({ ok: true, status: 'cancelled', supabase_id: current.id, alreadyCancelled: true });
    }
    if (!['pending', 'confirmed'].includes(current.status)) {
      return json({ ok: false, message: `Kan ikke kansellere fra status ${current.status}.` }, 409);
    }
    // Compare-and-set: changed status or identity since the read means no write.
    const patchUrl = new URL(base);
    patchUrl.searchParams.set('status', `eq.${current.status}`);
    patchUrl.searchParams.set('fra_dato', `eq.${current.fra_dato}`);
    patchUrl.searchParams.set('til_dato', `eq.${current.til_dato}`);
    patchUrl.searchParams.set('epost', `eq.${current.epost}`);
    const response = await fetch(patchUrl, {
      method: 'PATCH',
      headers: { ...headers, 'Content-Type': 'application/json', Prefer: 'return=representation' },
      body: JSON.stringify({ status: 'cancelled' }), signal: AbortSignal.timeout(20000),
    });
    if (!response.ok) {
      // Do not log keys, full customer records or raw upstream responses.
      console.error('Cancellation database write failed', { httpStatus: response.status, id });
      return json({ ok: false, message: 'Supabase avslo statusendringen. Kontroller støtte for cancelled og databasebegrensninger.' }, 502);
    }
    const updated = await response.json();
    if (Array.isArray(updated) && updated.length === 1 && updated[0].status === 'cancelled') {
      console.info('Booking cancelled', { id, bookingId: body.booking_id, cancellationId: body.cancellation_id });
      return json({ ok: true, status: 'cancelled', supabase_id: id });
    }
    const latest = await readCurrent();
    if (latest && identityMatches(latest) && latest.status === 'cancelled') {
      return json({ ok: true, status: 'cancelled', supabase_id: id, alreadyCancelled: true });
    }
    return json({ ok: false, message: 'Bookingen ble endret samtidig. Kontroller status før du fortsetter.' }, 409);
  } catch (error) {
    console.error('Cancellation request failed', { name: error.name, id });
    return json({ ok: false, message: 'Kunne ikke bekrefte databaseoperasjonen. Kontroller Supabase; videreføring er trygg ved samme kansellerings-ID.' }, 502);
  }
}
