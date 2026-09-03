import nodemailer from "nodemailer";

// Allowed origins for CORS
const allowedOrigins = [
  "https://statuesque-marzipan-20a8ac.netlify.app",
  "https://eshyttekom.no",
  "https://admirable-belekoy-28489f.netlify.app",
  "https://tourmaline-jalebi-3028e4.netlify.app",
  "https://beautiful-lily-eb0be2.netlify.app",
  "https://dulcet-croissant-f61a7f.netlify.app"
];





export default async function handler(req) {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers });
  }

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
  const SUPABASE_BOOKING_TABLE = process.env.SUPABASE_BOOKING_TABLE;
  const missing = [];
  if (!SUPABASE_URL) missing.push("SUPABASE_URL");
  if (!SUPABASE_SERVICE_KEY) missing.push("SUPABASE_SERVICE_KEY");
  if (!SUPABASE_BOOKING_TABLE) missing.push("SUPABASE_BOOKING_TABLE");
  if (missing.length) {
    return new Response(`Mangler env: ${missing.join(", ")}`, { status: 500, headers });
  }

  // --- Handle OPTIONS preflight ---
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers });
  }

  // --- Handle GET ---
  if (req.method === "GET") {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/bookinger?select=fra_dato,til_dato,status`,
      {
        headers: {
          apikey: SUPABASE_SERVICE_KEY,
          Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
        },
      }
    );
    const data = await res.json();
    return new Response(JSON.stringify(data), {
      headers: { "Content-Type": "application/json", ...headers },
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
      kommentar,
    } = data;

    if (!fornavn || !etternavn || !epost || !type_gjest) {
      return new Response("Mangler påkrevde felt", { status: 400, headers });
    }

    // --- Save booking ---
    const bookingRes = await fetch(`${SUPABASE_URL}/rest/v1/${SUPABASE_BOOKING_TABLE}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
        Prefer: "return=representation",
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
        status: "pending",
      }),
    });

    if (!bookingRes.ok) {
      let err = await bookingRes.text();
      try { err = JSON.parse(err).message || err; } catch {}
      console.error("Supabase feil:", err);
      return new Response(`Feil ved lagring av booking: ${err}`, { status: 500, headers });
    }

    let bookingId = "-";
    try {
      const createdBookings = await bookingRes.json();
      // Supabase returns an array for bulk insertions, grab the first element
      if (Array.isArray(createdBookings) && createdBookings.length > 0) {
        bookingId = createdBookings[0].id; 
      }
    } catch (parseErr) {
      console.error("Klarte ikke å hente ut booking ID:", parseErr);
    }

    // --- Email content ---
    const emailText = `
Ny booking mottatt:

Booking-ID (Supabase): ${bookingId}
Navn: ${fornavn} ${etternavn}
E-post: ${epost}
Telefon: ${telefon || "-"}
Type gjest: ${type_gjest}
Fra: ${fra_dato || "-"} Til: ${til_dato || "-"}
Antall gjester: ${antall_gjester || "-"}
Beregnet pris: ${beregnet_pris || "-"}
Kommentar: ${kommentar || "-"}
    `;

    
  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: process.env.GMAIL_USER,
      pass: process.env.GMAIL_APP_PASSWORD,
    },
  });


  try {
    await transporter.sendMail({
      from: `"Eshyttekom" <${process.env.GMAIL_USER}>`,
      to: [
        "hovmester@eshyttekom.no",
        "finansforvalter@eshyttekom.no",
      ],
      replyTo: epost,
      
      subject: `Ny booking fra ${fornavn} ${etternavn}`,
      text: emailText,
    });

  } catch (err) {
    console.error("Google SMTP full error:", err);
  }


    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "Content-Type": "application/json", ...headers },
    });
  }

  return new Response("Method not allowed", { status: 405, headers });
}

