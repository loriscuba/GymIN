// GymIN · report-serale: invia per email il report serale delle modifiche.
//
// La chiama solo pg_cron (funzione report_serale_cron, vedi migration report_serale) alle 20
// ora italiana, dopo aver salvato il report in report_serali. Nessun utente: l'accesso è
// protetto dall'header x-report-token, che deve coincidere con report_config.token (generato
// dal database, leggibile solo con la service_role).
//
// Segreti (Project Settings → Edge Functions → Secrets): BREVO_API_KEY e MAIL_FROM (già usati
// da send-mail), opzionale REPORT_TO (default loriscuba@gmail.com).
// SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY sono forniti da Supabase.
// Deploy: supabase functions deploy report-serale --no-verify-jwt

const euro = (n: number) => new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR" }).format(n || 0);
const esc = (s: unknown) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));

type Riga = Record<string, unknown>;

function html(giorno: string, r: Record<string, any>): string {
  const voce = (k: string, v: unknown) => `<tr><td style="padding:4px 12px 4px 0">${k}</td><td style="padding:4px 0"><b>${esc(v)}</b></td></tr>`;
  const elenco = (titolo: string, righe: Riga[], fmt: (x: Riga) => string) =>
    righe?.length ? `<h3 style="margin:18px 0 6px">${titolo}</h3><ul style="margin:0;padding-left:18px">${righe.map((x) => `<li>${fmt(x)}</li>`).join("")}</ul>` : "";
  const data = new Date(giorno + "T12:00:00").toLocaleDateString("it-IT", { weekday: "long", day: "numeric", month: "long" });
  return `<div style="font-family:Arial,sans-serif;font-size:14px;color:#222">
    <h2 style="margin:0 0 4px">Report serale GymIN</h2>
    <div style="color:#666;margin-bottom:14px">${esc(data)} · dalle 20 di ieri alle 20 di oggi</div>
    <table>${[
      voce("Modifiche totali", r.totale_modifiche),
      voce("Nuovi soci", r.nuovi_soci),
      voce("Soci modificati", r.soci_modificati),
      voce("Nuovi abbonamenti", r.nuovi_abbonamenti),
      voce("Abbonamenti modificati", r.abbonamenti_modificati),
      voce("Pagamenti", `${r.pagamenti} · ${euro(r.incassato)}`),
      voce("Ingressi", r.ingressi),
      voce("Eliminazioni", r.eliminazioni),
    ].join("")}</table>
    ${elenco("Nuovi abbonamenti", r.elenco_abbonamenti, (x) => `${esc(x.socio || "—")} · ${esc(x.piano || "—")}${x.scadenza ? ` (scade ${esc(x.scadenza)})` : ""}`)}
    ${elenco("Pagamenti", r.elenco_pagamenti, (x) => `${esc(x.socio || "—")} · ${euro(Number(x.importo))} · ${esc(x.metodo || "")}`)}
    <p style="color:#666;margin-top:18px">Il dettaglio di ogni modifica è nel Log attività del gestionale.</p>
  </div>`;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405 });
  const url = Deno.env.get("SUPABASE_URL")!;
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const db = { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" };

  const cfg = await fetch(`${url}/rest/v1/report_config?select=token`, { headers: db });
  const [conf] = cfg.ok ? await cfg.json() : [];
  const sent = req.headers.get("x-report-token") || "";
  if (!conf?.token || sent !== conf.token) return new Response("Unauthorized", { status: 401 });
  const { giorno } = await req.json().catch(() => ({}));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(giorno))) return new Response("giorno non valido", { status: 400 });

  const sel = await fetch(`${url}/rest/v1/report_serali?giorno=eq.${giorno}&select=riepilogo,email_inviata_il`, { headers: db });
  const [rep] = sel.ok ? await sel.json() : [];
  if (!rep) return new Response("report non trovato", { status: 404 });
  if (rep.email_inviata_il) return new Response("già inviato", { status: 200 });

  const apiKey = Deno.env.get("BREVO_API_KEY");
  const fromEmail = Deno.env.get("MAIL_FROM");
  if (!apiKey || !fromEmail) return new Response("Brevo non configurato", { status: 500 });
  const r = rep.riepilogo;
  const brevo = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: { "Content-Type": "application/json", "api-key": apiKey, Accept: "application/json" },
    body: JSON.stringify({
      sender: { name: "GymIN", email: fromEmail },
      to: [{ email: Deno.env.get("REPORT_TO") || "loriscuba@gmail.com" }],
      subject: `Report GymIN · ${r.nuovi_abbonamenti} abbonamenti, ${r.pagamenti} pagamenti, ${r.totale_modifiche} modifiche`,
      htmlContent: html(giorno, r),
    }),
  });
  if (!brevo.ok) return new Response("Errore invio Brevo: " + (await brevo.text()), { status: 502 });

  await fetch(`${url}/rest/v1/report_serali?giorno=eq.${giorno}`, {
    method: "PATCH", headers: db, body: JSON.stringify({ email_inviata_il: new Date().toISOString() }),
  });
  console.log(JSON.stringify({ evento: "report-serale", giorno }));
  return new Response("ok", { status: 200 });
});
