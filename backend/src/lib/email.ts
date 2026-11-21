import nodemailer from 'nodemailer';
import { canonicalAddress } from './emailAddress';

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

  // On ports other than 465 (implicit TLS), insist on STARTTLS. Without
  // requireTLS, nodemailer quietly continues in cleartext when the server's
  // EHLO doesn't offer STARTTLS, so anyone on the path could strip it and read
  // the SMTP password and every message. Opt out only for a relay that truly
  // has no TLS, with SMTP_REQUIRE_TLS=false.
  const requireTLS = port !== 465 && process.env.SMTP_REQUIRE_TLS !== 'false';

  transporter = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    requireTLS,
    auth: user && pass ? { user, pass } : undefined,
    tls: { rejectUnauthorized },
  });

  return transporter;
}

export async function sendEmail(message: EmailMessage): Promise<void> {
  // Exactly one recipient, exactly as validated. The address is passed as an
  // object (never parsed as an address list or "Name <addr>") and the SMTP
  // envelope is set explicitly, so the mail goes to this mailbox and no other.
  const to = canonicalAddress(message.to);
  if (!to) {
    throw new Error('Refusing to send: recipient is not a plain email address');
  }
  const fromAddress = process.env.EMAIL_FROM || 'status@example.edu';

  const transport = getTransporter();
  await transport.sendMail({
    from: { name: process.env.EMAIL_FROM_NAME || process.env.SITE_NAME || 'IT Status', address: fromAddress },
    to: { name: '', address: to },
    envelope: { from: fromAddress, to: [to] },
    subject: message.subject,
    html: message.html,
  });
}

export function isEmailConfigured(): boolean {
  return !!process.env.SMTP_HOST;
}
