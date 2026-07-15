import nodemailer from 'nodemailer';

interface EmailMessage {
  to: string;
  subject: string;
  html: string;
}

let transporter: nodemailer.Transporter | null = null;

function getTransporter(): nodemailer.Transporter {
  if (transporter) return transporter;

  const host = process.env.SMTP_HOST;
  const port = parseInt(process.env.SMTP_PORT || '587');
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!host) {
    throw new Error('Email not configured: SMTP_HOST is required');
  }

  // Validate TLS certificates by default. Only disable verification when
  // SMTP_TLS_REJECT_UNAUTHORIZED is explicitly set to 'false' (e.g. for an
  // internal relay using a self-signed cert) — never silently.
  const rejectUnauthorized = process.env.SMTP_TLS_REJECT_UNAUTHORIZED !== 'false';

  transporter = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: user && pass ? { user, pass } : undefined,
    tls: { rejectUnauthorized },
  });

  return transporter;
}

export async function sendEmail(message: EmailMessage): Promise<void> {
  const transport = getTransporter();

  await transport.sendMail({
    from: `"${process.env.EMAIL_FROM_NAME || process.env.SITE_NAME || 'IT Status'}" <${process.env.EMAIL_FROM || 'status@example.edu'}>`,
    to: message.to,
    subject: message.subject,
    html: message.html,
  });
}

export function isEmailConfigured(): boolean {
  return !!process.env.SMTP_HOST;
}
