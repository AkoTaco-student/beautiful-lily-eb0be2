import sgMail from "@sendgrid/mail";

const allowedOrigins = [
  "https://statuesque-marzipan-20a8ac.netlify.app",
  "https://eshyttekom.no"
];

if (process.env.SENDGRID_API_KEY) {
  sgMail.setApiKey(process.env.SENDGRID_API_KEY);
}

export default async function handler(req) {

  const origin = req.headers.get("origin");
  if (origin && !allowedOrigins.includes(origin)) {
    return new Response("Origin not allowed", { status: 403 });
  }

  /* ---------- GET BOOKINGS ---------- */
  if (req.method === "GET") {
    const res = await fetch(`${process.env.SUPABASE_URL}/rest/v1/bookinger`, {
      headers: {
        "apikey": process.env.SUPABASE_SERVICE_KEY,
        "Authorization": `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
      }
    });

    const data = await res.json();

    return new Response(JSON.stringify(data), {
      headers: { "Content-Type": "application/json" }
    });
  }

  /* ---------- CREATE BOOKING ---------- */
  if (req.method === "POST") {
    let data;
    try {
      data = await req.json();
    } catch {
      return new Response("Ugyldig data", { status: 400 });
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
      return new Response("Mangler påkrevde felt", { status: 400 });
    }

    const res = await fetch(`${process.env.SUPABASE_URL}/rest/v1/bookinger`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "apikey": process.env.SUPABASE_SERVICE_KEY,
        "Authorization": `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
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
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      console.error("Supabase feil:", err);
      return new Response("Feil ved lagring av booking", { status: 500 });
    }

    try {
      await sgMail.send({
        to: ["bookingansvarlig@eshyttekom.no", "finansforvalter@eshyttekom.no"],
        from: "noreply@eshyttekom.no",
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
      console.error("SendGrid-feil:", err);
    }

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  return new Response("Method not allowed", { status: 405 });
}