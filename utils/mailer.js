import nodemailer from 'nodemailer';
import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';
dotenv.config();

const comlabLogoPath = fileURLToPath(new URL('../public/images/comlab-app-192.png', import.meta.url));
const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
})[char]);

const envFallback = (keys) => keys.map((key) => process.env[key]?.trim()).find((value) => value);

const smtpConfigKeys = {
  host: ['SMTP_HOST', 'MAIL_HOST'],
  port: ['SMTP_PORT', 'MAIL_PORT'],
  user: ['SMTP_USER', 'MAIL_USERNAME'],
  pass: ['SMTP_PASS', 'MAIL_PASSWORD'],
  from: ['MAIL_FROM', 'MAIL_FROM_ADDRESS', 'SMTP_USER', 'SMTP_USERNAME']
};

export const getSmtpConfigStatus = () => {
  const missing = Object.entries(smtpConfigKeys)
    .filter(([key, names]) => {
      if (key === 'from') return false;
      return !envFallback(names);
    })
    .map(([key, names]) => names.join(' / '));

  return {
    isConfigured: missing.length === 0,
    missing
  };
};

const getTransportConfig = () => {
  const host = envFallback(smtpConfigKeys.host);
  const port = Number(envFallback(smtpConfigKeys.port) || 587);
  const user = envFallback(smtpConfigKeys.user);
  const configuredPass = envFallback(smtpConfigKeys.pass);
  // Google displays App Passwords in four-character groups. Accept that
  // displayed form as well as the same password without spaces.
  const pass = host?.toLowerCase() === 'smtp.gmail.com'
    ? configuredPass?.replace(/\s+/g, '')
    : configuredPass;
  return { host, port, user, pass };
};

const getTransport = () => {
  const { host, port, user, pass } = getTransportConfig();
  if (!host || !user || !pass) return null;
  return nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass }
  });
};

const maskValue = (value) => {
  if (!value) return 'undefined';
  return value.length <= 4 ? '****' : `${value.slice(0, 2)}***${value.slice(-1)}`;
};

export const sendMail = async ({ to, subject, html, text, attachments = [] }) => {
  console.log('[mailer] Email attempting to send...');
  console.log(`[mailer] Recipient: ${to}`);

  const config = getTransportConfig();
  console.log(`[mailer] SMTP config resolved: host=${config.host || 'missing'}, port=${config.port}, user=${maskValue(config.user)}, pass=${config.pass ? '***' : 'missing'}`);

  const transport = getTransport();
  if (!transport) {
    const error = new Error('SMTP not configured (missing SMTP_HOST/SMTP_USER/SMTP_PASS or MAIL_HOST/MAIL_USERNAME/MAIL_PASSWORD)');
    console.error('[mailer] Email failed:', error.message);
    throw error;
  }

  const fromEmail = envFallback(smtpConfigKeys.from) || envFallback(smtpConfigKeys.user);
  const fromName = process.env.MAIL_FROM_NAME?.trim() || 'Computer Laboratory';
  const from = fromName ? `"${fromName}" <${fromEmail}>` : fromEmail;
  console.log(`[mailer] SMTP sender: ${from}`);

  try {
    const info = await transport.sendMail({ from, to, subject, html, text, attachments });
    console.log('[mailer] Email sent successfully');
    console.log(`[mailer] Message ID: ${info?.messageId || 'unknown'}`);
    return info;
  } catch (error) {
    console.error('[mailer] Email failed:', error?.message || error);
    throw error;
  }
};

/**
 * Send a styled 6-digit OTP email.
 * @param {object} opts
 * @param {string} opts.to       - recipient email
 * @param {string} opts.name     - recipient display name
 * @param {string} opts.otp      - 6-digit code
 * @param {'registration'|'password_reset'} opts.purpose
 */
export const sendOtpMail = async ({ to, name, otp, purpose }) => {
  const isReset = purpose === 'password_reset';
  const subject = isReset ? 'Your ComLab password reset code' : 'Your ComLab registration code';
  const heading = isReset ? 'Reset your password' : 'Confirm your email';
  const instruction = isReset
    ? 'Use this one-time code to continue resetting your ComLab password.'
    : 'Use this one-time code on the ComLab registration page to finish creating your account.';
  const safeOtp = escapeHtml(otp);
  const purposeLabel = isReset ? 'PASSWORD RESET' : 'EMAIL VERIFICATION';

  // Keep the notification preview short and focused on the code and next step.
  const text = `6-digit code: ${otp}\n\n${instruction}\n\nExpires in 10 minutes. If you did not request this email, you can ignore it.`;
  const html = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background-color:#edf5f1;font-family:Arial,Helvetica,sans-serif;color:#16352c;-webkit-text-size-adjust:100%;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;background-color:#edf5f1;">
    <tr><td align="center" style="padding:32px 14px;">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;max-width:560px;background-color:#ffffff;border:1px solid #dce9e2;border-radius:20px;overflow:hidden;">
        <tr><td style="padding:25px 28px;background-color:#0b382d;">
          <table role="presentation" cellspacing="0" cellpadding="0" border="0">
            <tr>
              <td valign="middle" style="padding-right:14px;">
                <img src="cid:comlab-logo" width="52" height="52" alt="ComLab" style="display:block;width:52px;height:52px;border:0;border-radius:14px;">
              </td>
              <td valign="middle">
                <p style="margin:0;color:#ffffff;font-size:17px;font-weight:700;letter-spacing:0.04em;">ComLab</p>
                <p style="margin:4px 0 0;color:#c9e8da;font-size:12px;line-height:1.5;">Computer Laboratory Facilities Management System</p>
              </td>
            </tr>
          </table>
        </td></tr>
        <tr><td style="padding:32px 30px 28px;">
          <p style="display:inline-block;margin:0 0 14px;padding:6px 10px;border-radius:999px;background-color:#e7f7ef;color:#087b58;font-size:11px;font-weight:700;letter-spacing:0.08em;">${purposeLabel}</p>
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;margin:0 0 22px;background-color:#f1faf5;border:1px solid #d5eee0;border-radius:14px;">
            <tr><td align="center" style="padding:18px 12px 16px;">
              <p style="margin:0 0 8px;color:#60776d;font-size:12px;line-height:1.4;">YOUR 6-DIGIT CODE</p>
              <p style="margin:0;color:#0b382d;font-family:Consolas,'Courier New',monospace;font-size:34px;font-weight:700;letter-spacing:0.24em;line-height:1.35;">${safeOtp}</p>
            </td></tr>
          </table>
          <h1 style="margin:0 0 14px;color:#123d30;font-size:25px;line-height:1.25;font-weight:700;">${heading}</h1>
          <p style="margin:0 0 22px;color:#52675f;font-size:14px;line-height:1.7;">${instruction}</p>
          <p style="margin:0 0 12px;color:#52675f;font-size:13px;line-height:1.7;">This code expires in <strong style="color:#16352c;">10 minutes</strong>. For your security, do not share it with anyone.</p>
          <p style="margin:0;color:#71847c;font-size:13px;line-height:1.7;">If you didn’t request this email, you can safely ignore it.</p>
        </td></tr>
        <tr><td style="padding:18px 30px 22px;border-top:1px solid #e6eee9;background-color:#fbfdfc;">
          <p style="margin:0;color:#3f5b50;font-size:12px;font-weight:700;">Computer Laboratory Facilities Management System</p>
          <p style="margin:5px 0 0;color:#84958d;font-size:11px;line-height:1.5;">Automated message from ComLab. Please do not reply to this email.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  return sendMail({
    to,
    subject,
    html,
    text,
    attachments: [{
      filename: 'comlab-app-logo.png',
      path: comlabLogoPath,
      cid: 'comlab-logo',
      contentType: 'image/png'
    }]
  });
};
