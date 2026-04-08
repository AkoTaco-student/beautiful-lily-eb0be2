import sgMail from "@sendgrid/mail";

const allowedOrigins = [
  "https://statuesque-marzipan-20a8ac.netlify.app",
  "https://eshyttekom.no",
  "https://admirable-belekoy-28489f.netlify.app"
];

const SENDGRID_API_KEY = process.env.SENDGRID_API_KEY;
if (SENDGRID_API_KEY) {
  sgMail.setApiKey(SENDGRID_API_KEY);
}

export default async function handler(req) {
  const origin = req.headers.origin;
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
  const SUPABASE_BOOKING_TABLE = process.env.SUPABASE_BOOKING_TABLE || 'bookinger';
  const SENDGRID_ENABLED = Boolean(SENDGRID_API_KEY);

  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    console.error('Manglende Supabase-konfigurasjon');
    return new Response("Feil ved lagring av booking: Supabase-konfigurasjon mangler.", { status: 500, headers });
  }
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers });
  }

  //if (origin && !allowedOrigins.includes(origin)) {
    //return new Response("Origin not allowed", { status: 403, headers });
  //}

  // Handle GET requests
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
  
  // Handle POST requests
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

    if (SENDGRID_ENABLED) {
      try {
        await sgMail.send({
          to: ["bookingansvarlig@eshyttekom.no", "finansforvalter@eshyttekom.no"],
          from: "finansforvalter@eshyttekom.no",
          subject: `Ny booking fra ${fornavn} ${etternavn}`,
          text: `
Ny booking mottatt:

Navn: ${fornavn} ${etternavn}
E-post: ${epost}
Telefon: ${telefon || "-"}
Type gjest: ${type_gjest}
Fra: ${fra_dato || "-"} Til: ${til_dato || "-"}
Antall gjester: ${antall_gjester || "-"}
Beregnet pris: ${beregnet_pris || "-"}
Kommentar: ${kommentar || "-"}
          `,
        });
      } catch (err) {
        console.error("SendGrid-feil:", err.response?.body || err.message);
      }
    } else {
      console.warn('SendGrid API-nøkkel mangler. E-post blir ikke sendt.');
    }

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "Content-Type": "application/json", ...headers },
    });
  }

  return new Response("Method not allowed", { status: 405, headers });
}