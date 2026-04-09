import nodemailer from "nodemailer";

// Allowed origins for CORS
const allowedOrigins = [
  "https://statuesque-marzipan-20a8ac.netlify.app",
  "https://eshyttekom.no",
  "https://admirable-belekoy-28489f.netlify.app",
  "https://tourmaline-jalebi-3028e4.netlify.app"
];

export default async function handler(req) {
  const origin = req.headers.origin;

  // --- CORS headers ---
  const headers = {
    "Access-Control-Allow-Origin": "*", // Replace "*" with origin to restrict
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

  // --- Handle GET: return bookings ---
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

  // --- Handle POST: new booking ---
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

    // --- Save booking to Supabase ---
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

    // --- Gmail SMTP setup for sending emails ---
    const transporterFinans = nodemailer.createTransport({
      host: "smtp.gmail.com",
      port: 465,
      secure: true,
      auth: {
        user: "noreplyeshyttekom@gmail.com", // <-- your Gmail login
        pass: process.env.GMAIL_APP_PASSWORD, // <-- 16-char app password
      },
    });

    const transporterHovmester = nodemailer.createTransport({
      host: "smtp.gmail.com",
      port: 465,
      secure: true,
      auth: {
        user: "noreplyeshyttekom@gmail.com", // same Gmail login
        pass: process.env.GMAIL_APP_PASSWORD, // same app password
      },
    });

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
      // Send to finansforvalter
      await transporterFinans.sendMail({
        from: "noreplyeshyttekom@gmail.com",
        to: "finansforvalter@eshyttekom.no",
        replyTo: epost,
        subject: `Ny booking fra ${fornavn} ${etternavn}`,
        text: emailText,
      });

      // Send to hovmester
      await transporterHovmester.sendMail({
        from: "noreplyeshyttekom@gmail.com",
        to: "hovmester@eshyttekom.no",
        replyTo: epost,
        subject: `Ny booking fra ${fornavn} ${etternavn}`,
        text: emailText,
      });

    } catch (err) {
      console.error("Gmail SMTP feil:", err);
      // Continue without breaking booking storage
    }

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "Content-Type": "application/json", ...headers },
    });
  }

  return new Response("Method not allowed", { status: 405, headers });
}