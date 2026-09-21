import 'dotenv/config';
import nodemailer from 'nodemailer';

const t = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT),
  secure: false,                 // 587 -> STARTTLS
  auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
});

await t.verify();                // controlla connessione + credenziali
const to = process.argv[2] || process.env.SMTP_USER;
const info = await t.sendMail({
  from: process.env.MAIL_FROM || process.env.SMTP_USER,
  to,
  subject: 'GymIN · prova invio',
  text: "Se leggi questa mail, l'invio via Gmail funziona. 🎉",
});
console.log('OK, inviata:', info.messageId, '→', to);
