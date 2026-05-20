// api/_email.js — shared email helpers via Gmail SMTP (nodemailer)

import nodemailer from 'nodemailer';

const FROM = process.env.GMAIL_USER || 'gabriele.rucco@starkfuture.com';
const APP  = process.env.APP_URL    || 'https://stark-content-request.vercel.app';

function createTransport() {
  return nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 587,
    secure: false,
    auth: {
      user: process.env.GMAIL_USER,
      pass: process.env.GMAIL_PASS,
    },
  });
}

export async function sendConfirmation({ to, name, itemId, summary }) {
  const transport = createTransport();
  await transport.sendMail({
    from: `Stark Future Content <${FROM}>`,
    to,
    subject: `✅ Request received — ${summary}`,
    html: `
      <div style="font-family:sans-serif;max-width:540px;margin:0 auto;color:#111">
        <p style="font-size:13px;color:#888;letter-spacing:.1em;text-transform:uppercase">Stark Future · Content Request</p>
        <h2 style="margin:8px 0 4px">Your request has been received</h2>
        <p style="color:#555;margin-top:0">We'll review it shortly and get back to you.</p>
        <div style="background:#f5f5f5;border-radius:8px;padding:16px 20px;margin:24px 0;font-size:14px">
          <strong>${summary}</strong>
        </div>
        <a href="${APP}/track.html?id=${itemId}"
           style="display:inline-block;background:#111;color:#fff;text-decoration:none;padding:12px 24px;border-radius:8px;font-weight:600;font-size:14px">
          Track your request →
        </a>
        <p style="margin-top:32px;font-size:12px;color:#aaa">Request ID: #${itemId}</p>
      </div>
    `,
  });
}

export async function sendApprovalRequest({ itemId, summary, data, approveToken }) {
  const base        = `${APP}/api/approve?token=${approveToken}`;
  const approveUrl  = `${base}&action=approve`;
  const rejectUrl   = `${APP}/reject.html?token=${approveToken}`;
  const description = data.request || summary;

  const rows = [
    data.priority           && ['Priority',           data.priority],
    ['Format',                  data.format + (data.videoFormat ? ` · ${data.videoFormat}` : '')],
    ['Content Type',            data.contentType],
    ['Distribution',            data.distribution],
    ['Quantity',                data.quantity],
    ['Deadline',                data.deadline],
    ['Location',                data.location],
    ['Bikes',                   data.bikesInvolved + (data.whichModels ? ` — ${data.whichModels}` : '')],
    data.actors             && ['Actors/Riders',      data.actors],
    data.recipient          && ['Recipient',           data.recipient],
    data.requesterName      && ['Requester',           data.requesterName],
    data.requesterEmail     && ['Requester Email',     data.requesterEmail],
    data.peopleToCoordinate && ['Coordinate with',    data.peopleToCoordinate],
    data.reference          && ['Reference',           data.reference],
    data.approvalRequired   && ['Approval Required',  data.approvalRequired],
    data.notes              && ['Notes',               data.notes],
  ].filter(Boolean);

  const tableRows = rows.map(([k, v]) =>
    `<tr><td style="color:#888;padding:4px 12px 4px 0;font-size:13px;white-space:nowrap;vertical-align:top">${k}</td><td style="font-size:13px;padding:4px 0;vertical-align:top">${v}</td></tr>`
  ).join('');

  const transport = createTransport();
  await transport.sendMail({
    from: `Stark Future Content <${FROM}>`,
    to:   process.env.AMEDEO_EMAIL,
    subject: `📋 New content request — ${summary}`,
    html: `
      <div style="font-family:sans-serif;max-width:560px;margin:0 auto;color:#111">
        <p style="font-size:13px;color:#888;letter-spacing:.1em;text-transform:uppercase">Stark Future · Content Request</p>
        <h2 style="margin:8px 0 4px">New request to review</h2>
        <div style="background:#f5f5f5;border-radius:8px;padding:14px 18px;margin:16px 0;font-size:14px;line-height:1.5">
          ${description}
        </div>
        <table style="margin:16px 0 28px;border-collapse:collapse">${tableRows}</table>
        <table style="border-collapse:collapse">
          <tr>
            <td style="padding-right:12px">
              <a href="${approveUrl}"
                 style="display:inline-block;background:#00c875;color:#fff;text-decoration:none;padding:13px 28px;border-radius:8px;font-weight:700;font-size:15px">
                ✅ Approve
              </a>
            </td>
            <td>
              <a href="${rejectUrl}"
                 style="display:inline-block;background:#e2445c;color:#fff;text-decoration:none;padding:13px 28px;border-radius:8px;font-weight:700;font-size:15px">
                ❌ Reject
              </a>
            </td>
          </tr>
        </table>
        <p style="margin-top:32px;font-size:12px;color:#aaa">Request ID: #${itemId}</p>
      </div>
    `,
  });
}

export async function sendApproved({ to, summary, itemId }) {
  const transport = createTransport();
  await transport.sendMail({
    from: `Stark Future Content <${FROM}>`,
    to,
    subject: `✅ Request approved — ${summary}`,
    html: `
      <div style="font-family:sans-serif;max-width:540px;margin:0 auto;color:#111">
        <p style="font-size:13px;color:#888;letter-spacing:.1em;text-transform:uppercase">Stark Future · Content Request</p>
        <h2 style="margin:8px 0 4px;color:#00c875">Your request has been approved!</h2>
        <p style="color:#555">The production team will be in touch soon.</p>
        <div style="background:#f5f5f5;border-radius:8px;padding:16px 20px;margin:24px 0;font-size:14px">
          <strong>${summary}</strong>
        </div>
        <a href="${APP}/track.html?id=${itemId}"
           style="display:inline-block;background:#111;color:#fff;text-decoration:none;padding:12px 24px;border-radius:8px;font-weight:600;font-size:14px">
          Track progress →
        </a>
      </div>
    `,
  });
}

export async function sendRejected({ to, summary, itemId, reason, editToken }) {
  const transport = createTransport();
  await transport.sendMail({
    from: `Stark Future Content <${FROM}>`,
    to,
    subject: `❌ Request not approved — ${summary}`,
    html: `
      <div style="font-family:sans-serif;max-width:540px;margin:0 auto;color:#111">
        <p style="font-size:13px;color:#888;letter-spacing:.1em;text-transform:uppercase">Stark Future · Content Request</p>
        <h2 style="margin:8px 0 4px">Your request wasn't approved</h2>
        <div style="background:#f5f5f5;border-radius:8px;padding:16px 20px;margin:16px 0;font-size:14px">
          <strong>${summary}</strong>
        </div>
        <div style="border-left:3px solid #e2445c;padding:12px 16px;margin:16px 0;font-size:14px;color:#444">
          <strong style="display:block;margin-bottom:4px;color:#111">Reason:</strong>
          ${reason || 'No reason provided.'}
        </div>
        <p style="font-size:14px;color:#555">You can edit your request and resubmit — Amedeo will review it again.</p>
        <a href="${APP}/edit.html?token=${editToken}"
           style="display:inline-block;background:#111;color:#fff;text-decoration:none;padding:12px 24px;border-radius:8px;font-weight:600;font-size:14px;margin-top:8px">
          ✏️ Edit and resubmit →
        </a>
      </div>
    `,
  });
}
