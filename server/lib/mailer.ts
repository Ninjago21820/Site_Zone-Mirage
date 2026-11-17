import nodemailer, { type Transporter } from 'nodemailer';

/**
 * Envoi d'e-mails transactionnels (réinitialisation de mot de passe, accusé de
 * réception d'un ticket). Aucun fournisseur n'est imposé : le transport est
 * configuré par SMTP_URL (ou SMTP_HOST/SMTP_PORT/SMTP_USER/SMTP_PASS).
 *
 * Sans configuration, `isMailConfigured()` renvoie false : l'application reste
 * fonctionnelle, journalise l'événement et n'expose jamais le jeton au client.
 */

let cached: Transporter | null = null;

function transport(): Transporter | null {
  if (cached) return cached;
  const url = process.env.SMTP_URL;
  const host = process.env.SMTP_HOST;
  if (!url && !host) return null;
  cached = url
    ? nodemailer.createTransport(url)
    : nodemailer.createTransport({
        host,
        port: Number(process.env.SMTP_PORT ?? 587),
        secure: process.env.SMTP_SECURE === 'true',
        auth: process.env.SMTP_USER
          ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS ?? '' }
          : undefined,
      });
  return cached;
}

export function isMailConfigured(): boolean {
  return Boolean(process.env.SMTP_URL || process.env.SMTP_HOST);
}

export const MAIL_FROM = process.env.MAIL_FROM ?? 'SCP: Mirage Protocol <no-reply@mirage-protocol.example>';

export async function sendMail(options: { to: string; subject: string; text: string; html?: string }): Promise<boolean> {
  const transporter = transport();
  if (!transporter) {
    console.warn(`[mail] transport non configuré — message non envoyé (${options.subject} → ${options.to})`);
    return false;
  }
  await transporter.sendMail({ from: MAIL_FROM, ...options });
  return true;
}

function publicOrigin(): string {
  return (process.env.PUBLIC_ORIGIN ?? 'http://localhost:3000').replace(/\/+$/, '');
}

export async function sendPasswordReset(email: string, token: string): Promise<boolean> {
  const link = `${publicOrigin()}/reset-password?token=${encodeURIComponent(token)}`;
  return sendMail({
    to: email,
    subject: 'SCP: Mirage Protocol — réinitialisation de votre mot de passe',
    text: [
      'Une réinitialisation de mot de passe a été demandée pour votre compte.',
      '',
      `Lien valable 30 minutes, à usage unique : ${link}`,
      '',
      'Si vous n’êtes pas à l’origine de cette demande, ignorez ce message :',
      'votre mot de passe actuel reste valide.',
    ].join('\n'),
    html: `<p>Une réinitialisation de mot de passe a été demandée pour votre compte.</p>
<p><a href="${link}">Réinitialiser mon mot de passe</a> — lien valable 30 minutes, à usage unique.</p>
<p>Si vous n’êtes pas à l’origine de cette demande, ignorez ce message : votre mot de passe reste valide.</p>`,
  });
}

export async function sendTicketReceived(email: string, ref: string, subject: string): Promise<boolean> {
  if (!email) return false;
  return sendMail({
    to: email,
    subject: `SCP: Mirage Protocol — ticket ${ref} reçu`,
    text: [
      `Votre demande « ${subject} » a été enregistrée sous la référence ${ref}.`,
      '',
      'Notre équipe répond dans les délais indiqués sur la page Support.',
      'Vous pouvez suivre votre ticket depuis votre espace compte.',
    ].join('\n'),
  });
}

export async function notifySupport(ref: string, subject: string, category: string, body: string): Promise<void> {
  const mailbox = process.env.SUPPORT_EMAIL;
  if (!mailbox) return;
  await sendMail({
    to: mailbox,
    subject: `[Support] ${ref} — ${subject}`,
    text: `Catégorie : ${category}\n\n${body}`,
  }).catch((error: unknown) => console.warn('[mail] notification support échouée', error));
}
