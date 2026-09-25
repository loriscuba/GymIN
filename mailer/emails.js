import { supa } from './db.js';
import { transport, MAIL_FROM } from './transport.js';

// Categorie di comunicazione:
//  - servizio: legate al rapporto con il socio (scadenza, ricevute, benvenuto);
//    NON richiedono il consenso marketing.
//  - marketing: promozioni/offerte; solo con soci.marketing_email_consent = true.
// `manuale` = invio reale dalla Posta (mailer/manual.js) di una mail di servizio già generata:
// per contenuti promozionali usare un tipo marketing, che richiede il consenso.
export const CATEGORIA = { benvenuto: 'servizio', ricevuta: 'servizio', rinnovo: 'servizio', scaduto: 'servizio', manuale: 'servizio',
  winback: 'marketing', compleanno: 'marketing', inattivita: 'marketing', promo: 'marketing' };

// Nei log niente dati personali: solo id socio e indirizzi mascherati.
const redact = (v) => String(v ?? '').replace(/[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+/g, '[email]');
const chi = (socio_id) => (socio_id ? `socio ${socio_id}` : 'test');

async function consensoMarketing(socio_id) {
  if (!socio_id) return false;
  const { data, error } = await supa.from('soci').select('marketing_email_consent').eq('id', socio_id).maybeSingle();
  return !error && !!data?.marketing_email_consent;
}

// Invia una mail e registra sempre l'esito in mail_log.
// `rif` è la chiave anti-doppione (es. "<abb_id>:7").
// Con `rethrow: true` l'errore SMTP viene rilanciato (usato dall'invio manuale per mostrarlo in admin).
export async function inviaMail({ socio_id, destinatario, tipo, rif, subject, html, rethrow = false }) {
  if (CATEGORIA[tipo] !== 'servizio' && !(await consensoMarketing(socio_id))) {
    console.log(`  · ${tipo} → ${chi(socio_id)}: saltata (nessun consenso marketing)`);
    return false;
  }
  const unsubscribe = `https://gymin.local/disiscrivi?socio=${socio_id || ''}`;
  const body = html.replaceAll('{{UNSUBSCRIBE}}', unsubscribe);
  try {
    await transport.sendMail({
      from: MAIL_FROM,
      to: destinatario,
      subject,
      html: body,
      headers: { 'List-Unsubscribe': `<${unsubscribe}>` },
    });
    await supa.from('mail_log').insert({ socio_id, tipo, rif, destinatario, stato: 'inviata' });
    console.log(`  ✓ ${tipo} → ${chi(socio_id)}`);
    return true;
  } catch (err) {
    // Dettaglio SMTP: codice, comando e risposta del server (es. "550 sender not verified").
    const dettagli = [err?.code, err?.command, err?.responseCode, err?.response].filter(Boolean).join(' | ');
    const errore = `${String(err?.message || err)}${dettagli ? ` [${dettagli}]` : ''} (from: ${MAIL_FROM})`.slice(0, 500);
    await supa.from('mail_log').insert({ socio_id, tipo, rif, destinatario, stato: 'errore', errore });
    console.error(`  ✖ ${tipo} → ${chi(socio_id)}: ${redact(errore)}`);
    if (rethrow) throw new Error(`Errore SMTP: ${errore}`);
    return false;
  }
}
