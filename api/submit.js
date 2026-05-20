// api/submit.js — POST /api/submit
// Receives form data, creates Monday item, sends emails

import { randomUUID } from 'crypto';
import { COL, GROUP, createItem } from './_monday.js';
import { sendConfirmation, sendApprovalRequest } from './_email.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const d = req.body;

  // Validate required fields server-side
  const required = ['request', 'format', 'contentType', 'distribution',
                    'quantity', 'deadline', 'location', 'bikesInvolved',
                    'requesterName', 'requesterEmail'];
  for (const f of required) {
    if (!d[f]) return res.status(400).json({ error: `Missing field: ${f}` });
  }

  const editToken    = randomUUID();
  const approveToken = randomUUID();

  // Item name = first 80 chars of request description
  const itemName = d.request.length > 80
    ? d.request.substring(0, 80) + '…'
    : d.request;

  // Build Monday column values
  const colValues = {
    [COL.priority]:       { label: d.priority || 'Normal' },
    [COL.format]:         { label: d.format },
    [COL.contentType]:    { labels: [d.contentType] },
    [COL.distribution]:   { labels: [d.distribution] },
    [COL.quantity]:       d.quantity,
    [COL.deadline]:       { date: d.deadline },
    [COL.location]:       { label: d.location },
    [COL.bikesInvolved]:  { label: d.bikesInvolved },
    [COL.requester]:      d.requesterName,
    [COL.requesterEmail]: { email: d.requesterEmail, text: d.requesterEmail },
    [COL.editToken]:      editToken,
    [COL.approveToken]:   approveToken,
  };

  if (d.videoFormat)        colValues[COL.videoFormat]        = { labels: [d.videoFormat] };
  if (d.whichModels)        colValues[COL.whichModels]        = d.whichModels;
  if (d.actors)             colValues[COL.actors]             = d.actors;
  if (d.recipient)          colValues[COL.recipient]          = d.recipient;
  if (d.peopleToCoordinate) colValues[COL.peopleToCoordinate] = d.peopleToCoordinate;
  if (d.reference)          colValues[COL.reference]          = { url: d.reference, text: d.reference };
  if (d.approvalRequired)   colValues[COL.approvalRequired]   = { label: d.approvalRequired };
  if (d.notes)              colValues[COL.notes]              = { text: d.notes };

  let itemId;
  try {
    itemId = await createItem(GROUP.inReview, itemName, colValues);
  } catch (err) {
    console.error('Monday create error:', err);
    return res.status(500).json({ error: 'Failed to create ticket' });
  }

  const summary = `${d.format} · ${d.contentType} · ${d.deadline}`;

  const emailResults = await Promise.allSettled([
    sendConfirmation({
      to:      d.requesterEmail,
      name:    d.requesterName,
      itemId,
      summary: d.request.substring(0, 60),
    }),
    sendApprovalRequest({
      itemId,
      summary: d.request.substring(0, 60),
      data:    d,
      approveToken,
    }),
  ]);

  console.log('[email] confirmation:', emailResults[0].status, emailResults[0].reason?.message || 'ok');
  console.log('[email] approval:    ', emailResults[1].status, emailResults[1].reason?.message || 'ok');

  return res.status(200).json({ ok: true, itemId });
}
