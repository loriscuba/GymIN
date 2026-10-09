// GymIN · send-mail: invio email reali (Brevo) dalla sezione Posta.
//
// Sicurezza:
// - accetta SOLO utenti dello staff autenticati: il token in Authorization viene verificato
//   con Supabase Auth. La chiave anon è pubblica (sta nel sito) e da sola NON basta:
//   prima chiunque la conoscesse poteva inviare email a nome della palestra.
// - CORS limitato alle origini del gestionale (ALLOWED_ORIGINS, separate da virgola).
// - limiti di dimensione su destinatario, oggetto e contenuto.
//
// Segreti (Project Settings → Edge Functions → Secrets): BREVO_API_KEY, MAIL_FROM,
// opzionale ALLOWED_ORIGINS. SUPABASE_URL e SUPABASE_ANON_KEY sono forniti da Supabase.
// Deploy: supabase functions deploy send-mail

const ORIGINI = (Deno.env.get("ALLOWED_ORIGINS") || "https://loriscuba.github.io,http://localhost:5173")
  .split(",").map((o) => o.trim()).filter(Boolean);

const EMAIL_RE = /^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/;

function cors(req: Request): Record<string, string> {
  const origin = req.headers.get("Origin") || "";
  return {
    "Access-Control-Allow-Origin": ORIGINI.includes(origin) ? origin : ORIGINI[0],
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Vary": "Origin",
  };
}

const json = (req: Request, status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors(req), "Content-Type": "application/json" } });

// Utente dello staff dal token della sessione; null se il token è la chiave anon o non è valido.
async function utenteStaff(req: Request): Promise<{ id: string; email?: string } | null> {
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  const url = Deno.env.get("SUPABASE_URL");
  const anon = Deno.env.get("SUPABASE_ANON_KEY");
  if (!token || !url || !anon || token === anon) return null;
  const r = await fetch(`${url}/auth/v1/user`, { headers: { apikey: anon, Authorization: `Bearer ${token}` } });
  if (!r.ok) return null;
  const u = await r.json().catch(() => null);
  return u?.id && u?.aud === "authenticated" ? u : null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(req) });
  if (req.method !== "POST") return json(req, 405, { ok: false, error: "Method Not Allowed" });

  const utente = await utenteStaff(req);
  if (!utente) return json(req, 401, { ok: false, error: "Accesso riservato allo staff: effettua il login." });

  try {
    const { to, subject, html } = await req.json();
    if (!to || !subject || !html) return json(req, 400, { ok: false, error: "to, subject e html sono richiesti" });

    const dest = String(to).trim();
    if (dest.length > 254 || !EMAIL_RE.test(dest)) return json(req, 400, { ok: false, error: "Indirizzo email non valido" });
    if (String(subject).length > 200) return json(req, 400, { ok: false, error: "Oggetto troppo lungo" });
    if (String(html).length > 200_000) return json(req, 400, { ok: false, error: "Contenuto troppo grande" });

    const apiKey = Deno.env.get("BREVO_API_KEY");
    const fromEmail = Deno.env.get("MAIL_FROM");
    if (!apiKey || !fromEmail) return json(req, 500, { ok: false, error: "Brevo non configurato" });

    const response = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: { "Content-Type": "application/json", "api-key": apiKey, "Accept": "application/json" },
      body: JSON.stringify({
        sender: { name: "GymIN", email: fromEmail },
        to: [{ email: dest }],
        subject: String(subject),
        htmlContent: String(html),
      }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) return json(req, response.status, { ok: false, error: data?.message || "Errore invio Brevo" });

    // traccia minima nei log della funzione: chi ha inviato cosa (senza il contenuto)
    console.log(JSON.stringify({ evento: "send-mail", utente: utente.id, destinatario: dest }));
    return json(req, 200, { ok: true, recipient: dest, subject: String(subject) });
  } catch (error) {
    return json(req, 500, { ok: false, error: String(error) });
  }
});
