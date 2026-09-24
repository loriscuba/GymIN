function readRequestBody(req) {
  if (req.body) return Promise.resolve(req.body);
  if (typeof req.on !== 'function') return Promise.resolve('');

  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

export function validateManualMail(payload = {}) {
  const to = payload.to ?? payload.destinatario ?? payload.email;
  const subject = payload.subject ?? payload.oggetto;
  const html = payload.html ?? payload.body ?? payload.content;

  if (!to) {
    throw new Error('Destinatario mancante: usa `to` o `destinatario`.');
  }
  if (!subject) {
    throw new Error('Oggetto mancante: usa `subject`.');
  }
  if (!html) {
    throw new Error('Contenuto HTML mancante: usa `html`.');
  }

  return {
    socio_id: payload.socio_id ?? null,
    destinatario: String(to).trim(),
    tipo: payload.tipo ?? 'manuale',
    rif: payload.rif ?? `manual:${Date.now()}`,
    subject: String(subject).trim(),
    html: String(html),
  };
}

export function createManualSendHandler({ sendMail } = {}) {
  const sender = sendMail ?? (async (payload) => {
    const { inviaMail } = await import('./emails.js');
    return inviaMail(payload);
  });

  return async function manualSendHandler(req, res) {
    if (req.method !== 'POST') {
      res.writeHead(405, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'Method Not Allowed' }));
      return;
    }

    const apiKey = process.env.MAILER_API_KEY;
    const headerKey = req.headers?.['x-mailer-key'] || req.headers?.['X-Mailer-Key'];
    const bearer = req.headers?.authorization || '';
    if (apiKey && headerKey !== apiKey && bearer !== `Bearer ${apiKey}`) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'Unauthorized' }));
      return;
    }

    try {
      const raw = await readRequestBody(req);
      const payload = JSON.parse(raw || '{}');
      const mail = validateManualMail(payload);
      const ok = await sender(mail);

      if (!ok) {
        throw new Error('Impossibile inviare la mail tramite SMTP reale.');
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, recipient: mail.destinatario, subject: mail.subject }));
    } catch (error) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: String(error?.message || error) }));
    }
  };
}
