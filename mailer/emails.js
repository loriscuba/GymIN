import { supa } from './db.js';
import { transport, MAIL_FROM } from './transport.js';

// Invia una mail e registra sempre l'esito in mail_log.
// `rif` è la chiave anti-doppione (es. "<abb_id>:7").
export async function inviaMail({ socio_id, destinatario, tipo, rif, subject, html }) {
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
    console.log(`  ✓ ${tipo} → ${destinatario}`);
    return true;
  } catch (err) {
    const errore = String(err?.message || err).slice(0, 500);
    await supa.from('mail_log').insert({ socio_id, tipo, rif, destinatario, stato: 'errore', errore });
    console.error(`  ✖ ${tipo} → ${destinatario}: ${errore}`);
    return false;
  }
}
