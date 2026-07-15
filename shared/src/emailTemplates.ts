import { STATUS_COLORS, STATUS_LABELS } from './constants';

const PUBLIC_URL = () => process.env.PUBLIC_URL || 'http://localhost:3001';
const SITE_NAME = () => process.env.SITE_NAME || 'IT Status';
const ORG_NAME = () => process.env.ORG_NAME || 'Example University';
const PRIMARY_COLOR = () => process.env.PRIMARY_COLOR || '#1e40af';

function layout(content: string): string {
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;font-family:Arial,Helvetica,sans-serif;background:#f3f4f6;">
<div style="max-width:600px;margin:0 auto;padding:20px;">
  <div style="background:${PRIMARY_COLOR()};padding:16px 24px;border-radius:8px 8px 0 0;">
    <h1 style="margin:0;color:white;font-size:18px;">${SITE_NAME()}</h1>
  </div>
  <div style="background:white;padding:24px;border-radius:0 0 8px 8px;box-shadow:0 1px 3px rgba(0,0,0,0.1);">
    ${content}
  </div>
  <p style="text-align:center;font-size:12px;color:#9ca3af;margin-top:16px;">
    ${ORG_NAME()} Information Technology | <a href="${PUBLIC_URL()}" style="color:${PRIMARY_COLOR()};">Status Page</a>
  </p>
</div>
</body>
</html>`;
}

export function verificationEmail(token: string): { subject: string; html: string } {
  const verifyUrl = `${PUBLIC_URL()}/api/subscriptions/verify/${token}`;
  return {
    subject: `Verify your ${SITE_NAME()} subscription`,
    html: layout(`
      <h2 style="margin:0 0 16px;font-size:20px;color:#111827;">Verify your subscription</h2>
      <p style="color:#374151;line-height:1.6;">
        You've signed up to receive status notifications from the ${ORG_NAME()} ${SITE_NAME()} Page.
        Please click the button below to verify your email address.
      </p>
      <div style="text-align:center;margin:24px 0;">
        <a href="${verifyUrl}" style="display:inline-block;padding:12px 24px;background:${PRIMARY_COLOR()};color:white;text-decoration:none;border-radius:6px;font-weight:bold;">
          Verify Email
        </a>
      </div>
      <p style="color:#9ca3af;font-size:13px;">
        If you didn't request this, you can safely ignore this email.
      </p>
    `),
  };
}

export function statusChangeEmail(
  serviceName: string,
  oldStatus: string,
  newStatus: string,
  unsubscribeToken: string
): { subject: string; html: string } {
  const unsubUrl = `${PUBLIC_URL()}/api/subscriptions/unsubscribe/${unsubscribeToken}`;

  return {
    subject: `[${SITE_NAME()}] ${serviceName}: ${STATUS_LABELS[newStatus as keyof typeof STATUS_LABELS] || newStatus}`,
    html: layout(`
      <h2 style="margin:0 0 16px;font-size:20px;color:#111827;">Service Status Change</h2>
      <p style="color:#374151;line-height:1.6;">
        <strong>${serviceName}</strong> status has changed:
      </p>
      <div style="display:flex;align-items:center;gap:8px;margin:16px 0;padding:12px;background:#f9fafb;border-radius:6px;">
        <span style="color:${STATUS_COLORS[oldStatus as keyof typeof STATUS_COLORS] || '#9ca3af'};font-weight:bold;">${STATUS_LABELS[oldStatus as keyof typeof STATUS_LABELS] || oldStatus}</span>
        <span style="color:#9ca3af;">&rarr;</span>
        <span style="color:${STATUS_COLORS[newStatus as keyof typeof STATUS_COLORS] || '#9ca3af'};font-weight:bold;">${STATUS_LABELS[newStatus as keyof typeof STATUS_LABELS] || newStatus}</span>
      </div>
      <div style="text-align:center;margin:20px 0;">
        <a href="${PUBLIC_URL()}" style="display:inline-block;padding:10px 20px;background:${PRIMARY_COLOR()};color:white;text-decoration:none;border-radius:6px;font-size:14px;">
          View Status Page
        </a>
      </div>
      <hr style="border:none;border-top:1px solid #e5e7eb;margin:20px 0;">
      <p style="font-size:12px;color:#9ca3af;text-align:center;">
        <a href="${unsubUrl}" style="color:#9ca3af;">Unsubscribe from notifications</a>
      </p>
    `),
  };
}

export function testEmail(): { subject: string; html: string } {
  return {
    subject: `[${SITE_NAME()}] Test Email`,
    html: layout(`
      <h2 style="margin:0 0 16px;font-size:20px;color:#111827;">Test Email</h2>
      <p style="color:#374151;line-height:1.6;">
        This is a test email from the ${SITE_NAME()} Page notification system.
        If you received this, email delivery is working correctly.
      </p>
    `),
  };
}
