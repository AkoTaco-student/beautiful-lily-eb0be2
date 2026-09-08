import { timingSafeEqual } from "node:crypto";


function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}


function safeTokenEquals(received, expected) {
  if (!received || !expected) return false;

  const receivedBuffer = Buffer.from(String(received));
  const expectedBuffer = Buffer.from(String(expected));
  if (receivedBuffer.length !== expectedBuffer.length) return false;

  return timingSafeEqual(receivedBuffer, expectedBuffer);
}


function isIsoDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }

  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}


export default async function handler(req) {
  if (req.method !== "POST") {
    return jsonResponse(
      { ok: false, message: "Kun POST er tillatt." },
      405,
    );
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;
  const confirmToken = process.env.BOOKING_CONFIRM_TOKEN;

  const missing = [];
  if (!supabaseUrl) missing.push("SUPABASE_URL");
  if (!supabaseServiceKey) missing.push("SUPABASE_SERVICE_KEY");
  if (!confirmToken) missing.push("BOOKING_CONFIRM_TOKEN");

  if (missing.length > 0) {
    console.error("Manglende miljøvariabler:", missing.join(", "));
    return jsonResponse(
      { ok: false, message: "Serveren mangler nødvendig konfigurasjon." },
      500,
    );
  }

  const receivedToken = req.headers.get("x-admin-token");
  if (!safeTokenEquals(receivedToken, confirmToken)) {
    return jsonResponse({ ok: false, message: "Ugyldig tilgang." }, 401);
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ ok: false, message: "Ugyldig JSON." }, 400);
  }

  const supabaseId = Number(body?.supabase_id);
  const bookingId = String(body?.booking_id || "").trim();
  const fra = body?.fra;
  const til = body?.til;

  if (!Number.isSafeInteger(supabaseId) || supabaseId <= 0) {
    return jsonResponse({ ok: false, message: "Ugyldig Supabase-ID." }, 400);
  }
  if (!bookingId) {
    return jsonResponse({ ok: false, message: "Booking-ID mangler." }, 400);
  }
  if (!isIsoDate(fra) || !isIsoDate(til) || til <= fra) {
    return jsonResponse({ ok: false, message: "Ugyldig leieperiode." }, 400);
  }

  let rpcResponse;
  try {
    rpcResponse = await fetch(
      `${supabaseUrl}/rest/v1/rpc/confirm_booking_atomic`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: supabaseServiceKey,
          Authorization: `Bearer ${supabaseServiceKey}`,
        },
        body: JSON.stringify({
          p_booking_id: supabaseId,
          p_expected_fra: fra,
          p_expected_til: til,
        }),
      },
    );
  } catch (error) {
    console.error("Kunne ikke kontakte Supabase:", error);
    return jsonResponse(
      { ok: false, message: "Kunne ikke kontakte Supabase." },
      502,
    );
  }

  const responseText = await rpcResponse.text();
  let result;
  try {
    result = JSON.parse(responseText);
  } catch {
    console.error("Ugyldig svar fra Supabase:", responseText.slice(0, 500));
    return jsonResponse(
      { ok: false, message: "Supabase returnerte et ugyldig svar." },
      502,
    );
  }

  if (!rpcResponse.ok) {
    console.error("Supabase RPC-feil:", result);
    return jsonResponse(
      { ok: false, message: result?.message || "Supabase-kallet feilet." },
      502,
    );
  }

  if (result?.ok === true && result?.status === "confirmed") {
    console.info("Booking bekreftet", { bookingId, supabaseId });
    return jsonResponse(result, 200);
  }

  const statusByCode = {
    not_found: 404,
    date_conflict: 409,
    stale_data: 409,
    invalid_status: 409,
  };

  const status = statusByCode[result?.code] || 409;
  console.warn("Booking ble ikke bekreftet", {
    bookingId,
    supabaseId,
    code: result?.code || "unknown",
  });

  return jsonResponse(
    {
      ok: false,
      code: result?.code || "confirmation_failed",
      message: result?.message || "Bookingen kunne ikke bekreftes.",
    },
    status,
  );
}
