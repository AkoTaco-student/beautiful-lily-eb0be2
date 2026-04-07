import sgMail from "@sendgrid/mail";

sgMail.setApiKey(process.env.SENDGRID_API_KEY); // Legg til i Netlify Env Variables

export default async function handler(req) {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  let data;
  try {
    data = await req.json();
  } catch {
    return new Response("Ugyldig data", { status: 400 });
  }

  const { fornavn, etternavn, epost, telefon, type_gjest, fra_dato, til_dato, antall_gjester, beregnet_pris, kommentar } = data;

  if (!fornavn || !etternavn || !epost || !type_gjest) {
    return new Response("Mangler påkrevde felt", { status: 400 });
  }

  // Lagre booking i Supabase
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

  // Send e-post til bookingansvarlig
  try {
    await sgMail.send({
      to: "bookingansvarlig@eshyttekom.no",
      from: "noreply@eshyttekom.no", // Verifisert SendGrid avsender
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
    // Fortsett likevel, siden booking er lagret
  }

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}