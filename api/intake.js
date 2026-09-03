import { createHash } from 'node:crypto';

const recipient = 'matt@genxav.com';
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function value(input, limit = 2000) {
  return typeof input === 'string' ? input.trim().slice(0, limit) : '';
}

function escapeHtml(input) {
  return input.replace(/[&<>'"]/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  })[character]);
}

function textRow(label, input) {
  return `<tr><th align="left" style="padding:8px 16px 8px 0;color:#475569">${label}</th><td style="padding:8px 0">${escapeHtml(input || '—')}</td></tr>`;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const body = typeof req.body === 'string' ? (() => { try { return JSON.parse(req.body); } catch { return {}; } })() : (req.body || {});
  const name = value(body.name, 120);
  const company = value(body.company, 160);
  const email = value(body.email, 254).toLowerCase();
  const phone = value(body.phone, 80);
  const role = value(body.role, 80);
  const platform = value(body.platform, 160);
  const timeline = value(body.timeline, 80);
  const description = value(body.description, 4000);

  // A filled field indicates an automated submission. Pretend success without sending mail.
  if (value(body.website, 200)) return res.status(200).json({ ok: true });
  if (!name || !emailPattern.test(email) || !phone || description.length < 12) {
    return res.status(400).json({ error: 'Please provide a name, valid email, phone number, and project description.' });
  }

  const domain = process.env.RESEND_EMAIL_DOMAIN;
  const apiKey = process.env.RESEND_API_KEY;
  if (!domain || !apiKey) return res.status(503).json({ error: 'Email delivery is not configured.' });

  const html = `<div style="font-family:Arial,sans-serif;color:#111827"><h2>New Gen X AV project intake</h2><table style="border-collapse:collapse">${textRow('Name', name)}${textRow('Company', company)}${textRow('Email', email)}${textRow('Phone', phone)}${textRow('Customer type', role)}${textRow('System / platform', platform)}${textRow('Timeline', timeline)}${textRow('Project description', description)}</table></div>`;
  const idempotencyKey = `intake/${createHash('sha256').update([name, email, phone, role, platform, timeline, description].join('|')).digest('hex')}`;
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
    body: JSON.stringify({
      from: `Gen X AV Intake <intake@${domain}>`, to: [recipient], reply_to: email,
      subject: `New intake: ${name.replace(/[\r\n]/g, ' ')}`, html
    })
  });

  if (!response.ok) {
    console.error('Resend intake delivery failed', response.status);
    return res.status(502).json({ error: 'Unable to deliver intake.' });
  }
  return res.status(200).json({ ok: true });
}
