import { supa } from './db.js';
import { inviaMail } from './emails.js';
import { templates } from './templates.js';

// --- Promemoria rinnovo: 15 / 7 / 1 giorni prima della scadenza ---
export async function runRinnovi() {
  let inviate = 0;
  for (const giorni of [15, 7, 1]) {
    const { data, error } = await supa.rpc('abbonamenti_in_scadenza', { giorni });
    if (error) { console.error('  ✖ rpc abbonamenti_in_scadenza:', error.message); continue; }
    for (const r of data || []) {
      const { subject, html } = templates.rinnovo({
        socio: { nome: r.nome }, piano: r.piano, scadenza: r.data_scadenza, giorni,
      });
      const ok = await inviaMail({
        socio_id: r.socio_id, destinatario: r.email,
        tipo: 'rinnovo', rif: `${r.abbonamento_id}:${giorni}`, subject, html,
      });
      if (ok) inviate++;
    }
  }
  return inviate;
}

// --- Avviso di scadenza avvenuta (il giorno dopo) ---
export async function runScaduti() {
  let inviate = 0;
  const { data, error } = await supa.rpc('abbonamenti_scaduti');
  if (error) { console.error('  ✖ rpc abbonamenti_scaduti:', error.message); return 0; }
  for (const r of data || []) {
    const { subject, html } = templates.scaduto({
      socio: { nome: r.nome }, piano: r.piano, scadenza: r.data_scadenza,
    });
    const ok = await inviaMail({
      socio_id: r.socio_id, destinatario: r.email,
      tipo: 'scaduto', rif: `${r.abbonamento_id}:scaduto`, subject, html,
    });
    if (ok) inviate++;
  }
  return inviate;
}

// Esegue tutti i job giornalieri.
export async function runGiornaliero() {
  console.log(`[${new Date().toISOString()}] job mail giornaliero…`);
  const a = await runRinnovi();
  const b = await runScaduti();
  console.log(`  → ${a} promemoria rinnovo, ${b} avvisi scadenza.`);
  return a + b;
}
