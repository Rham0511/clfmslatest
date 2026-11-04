import nodemailer from 'nodemailer';
import dotenv from 'dotenv';
dotenv.config();

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
  const pass = envFallback(smtpConfigKeys.pass);
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

export const sendMail = async ({ to, subject, html, text }) => {
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
  const fromName = process.env.MAIL_FROM_NAME || '';
  const from = fromName ? `"${fromName}" <${fromEmail}>` : fromEmail;
  console.log(`[mailer] SMTP sender: ${from}`);

  try {
    const info = await transport.sendMail({ from, to, subject, html, text });
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
  const isReset   = purpose === 'password_reset';
  const subject   = isReset ? 'Reset your ComLab password' : 'Verify your email for ComLab';
  const heading   = isReset ? 'Reset your password' : 'Verify your email';
  const bodyText  = isReset
    ? `We received a request to reset your ComLab password. Use the code below to continue.`
    : `Welcome to ComLab! Please verify your email address to complete your registration.`;

  // Plain text version (fallback if HTML is blocked)
  const text = `
${heading}

Hey ${name || 'there'},

${bodyText}

Your verification code is:

    ${otp}

This code will expire in 10 minutes.

If you did not request this, you can safely ignore this email.

---
ComLab - Computer Laboratory Facilities Management System
`;

  // Simplified HTML for better Gmail compatibility
  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0;padding:40px 20px;background-color:#0d1117;font-family:Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" border="0">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;background-color:#0f1f17;border:1px solid rgba(34,197,94,0.2);border-radius:16px;">

          <!-- Header -->
          <tr>
            <td style="background:linear-gradient(to right,#052e16,#14532d);padding:30px;text-align:center;">
              <div style="font-size:40px;margin-bottom:10px;">✉️</div>
              <h1 style="margin:0;color:#ffffff;font-size:24px;">${heading}</h1>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:40px 30px;">
              <p style="margin:0 0 10px;color:#e2e8f0;font-size:16px;">
                Hey <strong>${name || 'there'}</strong>,
              </p>
              <p style="margin:0 0 30px;color:#94a3b8;font-size:14px;line-height:1.6;">
                ${bodyText}
              </p>

              <!-- OTP Code Box -->
              <table width="100%" cellpadding="0" cellspacing="0" border="0" align="center" style="text-align: center;">
                <tr align="center" style="text-align: center;">
                  <td align="center" style="padding:20px 0;">
                    <div align="center" style="margin: 24px auto; text-align: center; width: 100%; max-width: 320px; display: block; background-color: #022814; border: 1px solid rgba(52, 211, 153, 0.3); border-radius: 12px; padding: 20px; box-sizing: border-box;">
                      <p style="text-align: center; display: block; font-size: 11px; letter-spacing: 2px; color: #34D399; margin: 0 0 8px; text-transform: uppercase;">
                        Your verification code
                      </p>
                      <p style="text-align: center; display: block; font-size: 32px; font-weight: bold; letter-spacing: 8px; color: #34D399; margin: 0 auto; line-height: 40px; white-space: nowrap;">
                        ${otp}
                      </p>
                    </div>
                  </td>
                </tr>
              </table>

              <p style="margin:30px 0 0;color:#64748b;font-size:13px;line-height:1.6;">
                This code will expire in <strong style="color:#94a3b8;">10 minutes</strong>.
                If you did not request this, you can safely ignore this email.
              </p>

              <hr style="margin:30px 0;border:none;border-top:1px solid rgba(255,255,255,0.1);">

              <p style="margin:0;color:#475569;font-size:12px;text-align:center;">
                ComLab — Computer Laboratory Facilities Management System<br>
                Do not reply to this email.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  return sendMail({ to, subject, html, text });
};