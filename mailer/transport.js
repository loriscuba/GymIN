import nodemailer from 'nodemailer';

// In sviluppo punta a Mailpit (SMTP :1025, nessun invio reale).
// In produzione basta cambiare SMTP_HOST/PORT/USER/PASS nel .env
// verso il relay (OCI Email Delivery / Brevo / SES): il codice non cambia.
export const transport = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'localhost',
  port: Number(process.env.SMTP_PORT || 1025),
  secure: false, // 587/STARTTLS in prod: nodemailer negozia da sé
  auth: process.env.SMTP_USER
    ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
    : undefined,
});

export const MAIL_FROM = process.env.MAIL_FROM || 'GymIN <no-reply@gymin.local>';
