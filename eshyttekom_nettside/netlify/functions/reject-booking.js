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

  if (receivedBuffer.length !== expectedBuffer.length) {
    return false;
  }

  return timingSafeEqual(receivedBuffer, expectedBuffer);
}

export default async function handler(req) {
  if (req.method !== "POST") {
    return jsonResponse(
      { ok: false, message: "Kun POST er tillatt." },
      405
    );
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_KEY;
  const adminToken = process.env.BOOKING_CONFIRM_TOKEN;

  if (!supabaseUrl || !serviceKey || !adminToken) {
    console.error("Avvisningsfunksjonen mangler miljøvariabler.");

    return jsonResponse(
      {
        ok: false,
        message: "Serveren mangler nødvendig konfigurasjon.",
      },
      500
    );
  }

  const receivedToken = req.headers.get("x-admin-token");

  if (!safeTokenEquals(receivedToken, adminToken)) {
    return jsonResponse(
      { ok: false, message: "Ugyldig tilgang." },
      401
    );
  }

  let body;

  try {
    body = await req.json();
  } catch {
    return jsonResponse(
      { ok: false, message: "Ugyldig JSON." },
      400
    );
  }

  const supabaseId = Number(body?.supabase_id);
  const bookingId = String(body?.booking_id || "").trim();

  if (!Number.isSafeInteger(supabaseId) || supabaseId <= 0) {
    return jsonResponse(
      { ok: false, message: "Ugyldig Supabase-ID." },
      400
    );
  }

  if (!bookingId) {
    return jsonResponse(
      { ok: false, message: "Booking-ID mangler." },
      400
    );
  }

  let updateResponse;

  try {
    const updateUrl =
      `${supabaseUrl}/rest/v1/bookinger` +
      `?id=eq.${supabaseId}` +
      `&status=eq.pending` +
      `&select=id,status`;

    updateResponse = await fetch(updateUrl, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        Prefer: "return=representation",
      },
      body: JSON.stringify({
        status: "rejected",
      }),
    });
  } catch (error) {
    console.error("Kunne ikke kontakte Supabase:", error);

    return jsonResponse(
      { ok: false, message: "Kunne ikke kontakte Supabase." },
      502
    );
  }

  const responseText = await updateResponse.text();

  let rows;

  try {
    rows = JSON.parse(responseText || "[]");
  } catch {
    console.error(
      "Ugyldig svar fra Supabase:",
      responseText.slice(0, 500)
    );

    return jsonResponse(
      {
        ok: false,
        message: "Supabase returnerte ugyldig svar.",
      },
      502
    );
  }

  if (!updateResponse.ok) {
    console.error("Supabase-feil ved avvisning:", rows);

    return jsonResponse(
      {
        ok: false,
        message: rows?.message || "Supabase-kallet feilet.",
      },
      502
    );
  }

  if (
    Array.isArray(rows) &&
    rows.length === 1 &&
    rows[0].status === "rejected"
  ) {
    console.info("Booking avvist", {
      bookingId,
      supabaseId,
    });

    return jsonResponse(
      {
        ok: true,
        status: "rejected",
      },
      200
    );
  }

  const currentUrl =
    `${supabaseUrl}/rest/v1/bookinger` +
    `?id=eq.${supabaseId}` +
    `&select=id,status` +
    `&limit=1`;

  const currentResponse = await fetch(currentUrl, {
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
    },
  });

  const currentRows = currentResponse.ok
    ? await currentResponse.json()
    : [];

  const current = Array.isArray(currentRows)
    ? currentRows[0]
    : null;

  if (!current) {
    return jsonResponse(
      {
        ok: false,
        message: "Fant ikke bookingen i Supabase.",
      },
      404
    );
  }

  if (current.status === "rejected") {
    return jsonResponse(
      {
        ok: true,
        status: "rejected",
        alreadyRejected: true,
      },
      200
    );
  }

  if (current.status === "confirmed") {
    return jsonResponse(
      {
        ok: false,
        message:
          "Bookingen er allerede bekreftet og må behandles som en kansellering.",
      },
      409
    );
  }

  return jsonResponse(
    {
      ok: false,
      message:
        `Bookingen kan ikke avvises fra status ${current.status}.`,
    },
    409
  );
}
