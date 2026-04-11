import sgMail from "@sendgrid/mail";

// Allowed origins for CORS
const allowedOrigins = [
  "https://statuesque-marzipan-20a8ac.netlify.app",
  "https://eshyttekom.no",
  "https://admirable-belekoy-28489f.netlify.app",
  "https://tourmaline-jalebi-3028e4.netlify.app",
  "https://beautiful-lily-eb0be2.netlify.app",
];

// Init SendGrid
if (process.env.SENDGRID_API_KEY) {
  sgMail.setApiKey(process.env.SENDGRID_API_KEY);
}

export default async function handler(req) {
  const origin = req.headers.origin;

  // --- CORS headers ---
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };

  // --- Supabase config ---
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
  const SUPABASE_BOOKING_TABLE = process.env.SUPABASE_BOOKING_TABLE || 'bookinger';

  // --- Check for missing env ---
  const missing = [];
  if (!SUPABASE_URL) missing.push('SUPABASE_URL');
  if (!SUPABASE_SERVICE_KEY) missing.push('SUPABASE_SERVICE_KEY');
  if (missing.length) {
    console.error('Manglende Supabase-env:', missing.join(', '));
    return new Response(`Feil ved lagring av booking: mangler ${missing.join(', ')}`, { status: 500, headers });
  }

  // --- Handle OPTIONS preflight ---
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers });
  }

  // --- Handle GET ---
  if (req.method === "GET") {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${SUPABASE_BOOKING_TABLE}?select=fra_dato,til_dato,status`, {
      headers: {
        "apikey": SUPABASE_SERVICE_KEY,
        "Authorization": `Bearer ${SUPABASE_SERVICE_KEY}`,
      }
    });
    const data = await res.json();
    return new Response(JSON.stringify(data), {
      headers: { "Content-Type": "application/json", ...headers }
    });
  }

  // --- Handle POST ---
  if (req.method === "POST") {
    let data;
    try {
      data = await req.json();
    } catch {
      return new Response("Ugyldig data", { status: 400, headers });
    }

    const {
      fornavn,
      etternavn,
      epost,
      telefon,
      type_gjest,
      fra_dato,
      til_dato,
      antall_gjester,
      beregnet_pris,
      kommentar
    } = data;

    if (!fornavn || !etternavn || !epost || !type_gjest) {
      return new Response("Mangler påkrevde felt", { status: 400, headers });
    }

    // --- Save booking ---
    const bookingRes = await fetch(`${SUPABASE_URL}/rest/v1/${SUPABASE_BOOKING_TABLE}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "apikey": SUPABASE_SERVICE_KEY,
        "Authorization": `Bearer ${SUPABASE_SERVICE_KEY}`,
        "Prefer": "return=minimal",
      },
      body: JSON.stringify({
        fornavn,
        etternavn,
        epost,
        telefon: telefon || null,
        type_gjest,
        fra_dato: fra_dato || null,
        til_dato: til_dato || null,
        antall_gjester: antall_gjester ? parseInt(antall_gjester) : null,
        beregnet_pris: beregnet_pris || null,
        kommentar: kommentar || null,
        status: "pending"
      }),
    });

    if (!bookingRes.ok) {
      let err = await bookingRes.text();
      try { err = JSON.parse(err).message || err; } catch {}
      console.error("Supabase feil:", err);
      return new Response(`Feil ved lagring av booking: ${err}`, { status: 500, headers });
    }

    // --- Email content ---
    const emailText = `
Ny booking mottatt:

Navn: ${fornavn} ${etternavn}
E-post: ${epost}
Telefon: ${telefon || "-"}
Type gjest: ${type_gjest}
Fra: ${fra_dato || "-"} Til: ${til_dato || "-"}
Antall gjester: ${antall_gjester || "-"}
Beregnet pris: ${beregnet_pris || "-"}
Kommentar: ${kommentar || "-"}
    `;

    try {
      await sgMail.send({
        to: [
          "finansforvalter@eshyttekom.no",
          "hovmester@eshyttekom.no"
        ],
        from: "noreplyeshyttekom@gmail.com", // må være verifisert i SendGrid
        replyTo: epost,
        subject: `Ny booking fra ${fornavn} ${etternavn}`,
        text: emailText,
      });

    } catch (err) {
      console.error("SendGrid feil:", err.response?.body || err.message);
      // Ikke stopp booking selv om mail feiler
    }

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "Content-Type": "application/json", ...headers },
    });
  }

  return new Response("Method not allowed", { status: 405, headers });
}