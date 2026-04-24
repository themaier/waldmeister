// Transactional mail — work-order completion summary (README §5.9 #7).

import nodemailer from 'nodemailer';
import { env } from '$env/dynamic/private';

const host = env.SMTP_HOST;
const port = Number(env.SMTP_PORT ?? 587);
const user = env.SMTP_USER;
const pass = env.SMTP_PASSWORD;
const from = env.SMTP_FROM ?? 'Waldmeister <no-reply@example.com>';

let transporter: nodemailer.Transporter | null = null;
function getTransporter() {
  if (transporter) return transporter;
  if (!host || !user || !pass) {
    console.warn('SMTP not configured — emails will be logged, not sent.');
    transporter = nodemailer.createTransport({ jsonTransport: true });
    return transporter;
  }
  transporter = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass }
  });
  return transporter;
}

export async function sendMail(opts: { to: string; subject: string; html: string; text: string }) {
  const info = await getTransporter().sendMail({ from, ...opts });
  return info;
}

export function renderWorkOrderCompletedEmail(opts: {
  title: string;
  completedAt: Date;
  done: number;
  problems: number;
  notFound: number;
  workerNotes: string;
  orderUrl: string;
}) {
  const { title, completedAt, done, problems, notFound, workerNotes, orderUrl } = opts;
  const date = completedAt.toLocaleString('de-DE');
  const notes = workerNotes ? `\n\nNotizen des Forstunternehmers:\n${workerNotes}` : '';
  const text = `Ihr Auftrag "${title}" wurde abgeschlossen.\n\nAbgeschlossen am: ${date}\nErledigt: ${done}\nProbleme: ${problems}\nNicht gefunden: ${notFound}${notes}\n\n${orderUrl}`;
  const html = `
<p>Ihr Auftrag <strong>${escapeHtml(title)}</strong> wurde abgeschlossen.</p>
<ul>
  <li>Abgeschlossen am: ${escapeHtml(date)}</li>
  <li>Erledigt: ${done}</li>
  <li>Probleme: ${problems}</li>
  <li>Nicht gefunden: ${notFound}</li>
</ul>
${workerNotes ? `<p><strong>Notizen:</strong><br>${escapeHtml(workerNotes).replace(/\n/g, '<br>')}</p>` : ''}
<p><a href="${orderUrl}">Auftrag öffnen</a></p>`;
  return { subject: `Auftrag abgeschlossen: ${title}`, text, html };
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}
