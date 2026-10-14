import nodemailer from 'nodemailer';

let transport;

export async function sendMail(to, subject, text) {
  if (!process.env.SMTP_USER) {
    console.log(`[e-mail não enviado: SMTP não configurado] para=${to} assunto="${subject}"`);
    return;
  }
  transport ??= nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 465),
    secure: Number(process.env.SMTP_PORT || 465) === 465,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
  await transport.sendMail({ from: process.env.MAIL_FROM || process.env.SMTP_USER, to, subject, text });
}

/** Aviso por e-mail nunca derruba a operação: falha só vai para o log. */
export async function sendMailSafe(to, subject, text) {
  try {
    await sendMail(to, subject, text);
    return true;
  } catch (e) {
    console.error('falha ao enviar e-mail', subject, e.message);
    return false;
  }
}
