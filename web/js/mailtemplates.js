// Template email GymIN lato frontend — identici nella resa a mailer/templates.js.
// Usati per l'anteprima nella sezione Posta e per l'invio opzionale a Mailpit.
const ACCENT = '#f4511e', INK = '#161b22', MUTED = '#6b7280';
const euro = (n) => '€ ' + Number(n).toLocaleString('it-IT');
const dataIt = (d) => new Date(d).toLocaleDateString('it-IT', { day: '2-digit', month: 'long', year: 'numeric' });

function layout({ titolo, corpo, cta }) {
  return `<!doctype html><html lang="it"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;background:#f4f5f7;font-family:Arial,Helvetica,sans-serif;color:${INK}">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f5f7;padding:28px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#fff;border-radius:14px;overflow:hidden;border:1px solid #e6e8ee">
<tr><td style="background:${ACCENT};padding:20px 28px"><span style="color:#fff;font-size:22px;font-weight:bold;letter-spacing:-.5px">GymIN</span></td></tr>
<tr><td style="padding:28px"><h1 style="margin:0 0 14px;font-size:20px;color:${INK}">${titolo}</h1>
<div style="font-size:15px;line-height:1.6;color:#333">${corpo}</div>
${cta ? `<div style="margin:24px 0 6px"><a href="${cta.href}" style="background:${ACCENT};color:#fff;text-decoration:none;font-weight:bold;font-size:15px;padding:12px 22px;border-radius:10px;display:inline-block">${cta.label}</a></div>` : ''}
</td></tr>
<tr><td style="padding:18px 28px;border-top:1px solid #e6e8ee"><p style="margin:0;font-size:12px;color:${MUTED};line-height:1.5">
GymIN · Via dello Sport 12, Milano · +39 02 000 0000<br>Ricevi questa email come iscritto della palestra. <a href="#" style="color:${MUTED}">Disiscriviti</a>.
</p></td></tr></table></td></tr></table></body></html>`;
}

export const templates = {
  benvenuto: (m) => ({
    subject: 'Benvenuto in GymIN! 💪',
    html: layout({
      titolo: `Ciao ${m.nome.split(' ')[0]}, benvenuto!`,
      corpo: `Il tuo profilo è attivo. Ti aspettiamo in sala: presenta la tessera <b>${m.id}</b> alla reception per il primo accesso.<br><br>Orari: Lun–Ven 7:00–22:00 · Sab–Dom 9:00–19:00.`,
      cta: { href: '#', label: 'Vai alla tua area' },
    }),
  }),
  rinnovo: (m, giorni) => ({
    subject: `Il tuo abbonamento scade tra ${giorni} ${giorni === 1 ? 'giorno' : 'giorni'}`,
    html: layout({
      titolo: `${m.nome.split(' ')[0]}, è ora di rinnovare`,
      corpo: `Il tuo abbonamento <b>${m.plan.name}</b> scade il <b>${dataIt(m.end)}</b>. Rinnova ora per continuare ad allenarti senza interruzioni.`,
      cta: { href: '#', label: 'Rinnova l\'abbonamento' },
    }),
  }),
  ricevuta: (m) => ({
    subject: 'GymIN · ricevuta di pagamento',
    html: layout({
      titolo: 'Grazie, pagamento registrato',
      corpo: `Abbiamo registrato il pagamento del tuo abbonamento.<br><br>
        <table cellpadding="0" cellspacing="0" style="font-size:15px">
        <tr><td style="padding:3px 18px 3px 0;color:${MUTED}">Piano</td><td><b>${m.plan.name}</b></td></tr>
        <tr><td style="padding:3px 18px 3px 0;color:${MUTED}">Importo</td><td><b>${euro(m.plan.price)}</b></td></tr>
        <tr><td style="padding:3px 18px 3px 0;color:${MUTED}">Valido fino al</td><td><b>${dataIt(m.end)}</b></td></tr></table>`,
    }),
  }),
};
