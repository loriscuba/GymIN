import 'dotenv/config';
import http from 'node:http';
import cron from 'node-cron';
import { runGiornaliero } from './reminders.js';
import { inviaMail } from './emails.js';
import { templates } from './templates.js';
import { createManualSendHandler } from './manual.js';

const mode = process.argv[2] || 'watch';

if (mode === 'once') {
  // Esegue il job una volta e termina (utile per test o per un cron di sistema).
  await runGiornaliero();
  process.exit(0);
}

if (mode === 'test') {
  // Invia una mail di ogni tipo a un indirizzo di prova: le vedi su Mailpit (:8025).
  const to = process.argv[3] || 'prova@gymin.local';
  const socio = { nome: 'Marco', tessera: 'GY-1201' };
  const b = templates.benvenuto(socio);
  await inviaMail({ socio_id: null, destinatario: to, tipo: 'benvenuto', rif: 'test', ...b });
  const r = templates.ricevuta({ socio, piano: 'Annuale', importo: 499, scadenza: '2027-09-15' });
  await inviaMail({ socio_id: null, destinatario: to, tipo: 'ricevuta', rif: 'test', ...r });
  const rin = templates.rinnovo({ socio, piano: 'Open Mese', scadenza: '2026-09-22', giorni: 7 });
  await inviaMail({ socio_id: null, destinatario: to, tipo: 'rinnovo', rif: 'test', ...rin });
  console.log(`\nFatto. Apri Mailpit su http://localhost:8025 per vedere le mail.`);
  process.exit(0);
}

if (mode === 'api' || mode === 'manual') {
  const port = Number(process.env.MAILER_PORT || 3001);
  const server = http.createServer(createManualSendHandler({ sendMail: inviaMail }));
  server.listen(port, () => {
    console.log(`Mailer API pronto su http://localhost:${port}/api/send`);
    console.log('Invio reale manuale: POST con { to, subject, html }');
  });
  await new Promise(() => {});
}

// watch: pianifica il job giornaliero e resta in ascolto.
const expr = process.env.MAIL_CRON || '0 8 * * *';
if (!cron.validate(expr)) {
  console.error(`✖ MAIL_CRON non valido: "${expr}"`);
  process.exit(1);
}
cron.schedule(expr, () => { runGiornaliero().catch(console.error); });
console.log(`GymIN mailer avviato · schedule "${expr}" · SMTP ${process.env.SMTP_HOST}:${process.env.SMTP_PORT}`);
console.log('In attesa… (Ctrl+C per uscire). Per un giro immediato: npm run mail:once');
