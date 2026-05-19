// api/edit.js
// GET  /api/edit?token=XXX         → returns item data to pre-fill the form
// POST /api/edit { token, ...data } → updates item and restarts review cycle

import { randomUUID } from 'crypto';
import { COL, GROUP, getItemByToken, updateItem, moveItem, getColValue } from './_monday.js';
import { sendApprovalRequest } from './_email.js';

export default async function handler(req, res) {
  // ── GET: fetch item data for pre-filling the form ──────────────────
  if (req.method === 'GET') {
    const { token } = req.query;
    if (!token) return res.status(400).json({ error: 'Missing token' });

    const item = await getItemByToken(COL.editToken, token);
    if (!item) return res.status(404).json({ error: 'Ticket not found' });

    // Only allow editing rejected tickets
    if (item.group.id !== GROUP.onHold) {
      return res.status(403).json({ error: 'This ticket cannot be edited' });
    }

    const cv = (id) => getColValue(item, id);

    return res.status(200).json({
      id:                 item.id,
      request:            item.name,
      priority:           cv(COL.priority),
      format:             cv(COL.format),
      videoFormat:        cv(COL.videoFormat),
      contentType:        cv(COL.contentType),
      distribution:       cv(COL.distribution),
      quantity:           cv(COL.quantity),
      deadline:           cv(COL.deadline),
      location:           cv(COL.location),
      bikesInvolved:      cv(COL.bikesInvolved),
      whichModels:        cv(COL.whichModels),
      actors:             cv(COL.actors),
      requester:          cv(COL.requester),
      requesterEmail:     cv(COL.requesterEmail),
      recipient:          cv(COL.recipient),
      peopleToCoordinate: cv(COL.peopleToCoordinate),
      notes:              cv(COL.notes),
      rejectionReason:    cv(COL.rejectionReason),
    });
  }

  // ── POST: resubmit edited ticket ────────────────────────────────────
  if (req.method === 'POST') {
    const { token, ...d } = req.body;
    if (!token) return res.status(400).json({ error: 'Missing token' });

    const item = await getItemByToken(COL.editToken, token);
    if (!item) return res.status(404).json({ error: 'Ticket not found' });

    if (item.group.id !== GROUP.onHold) {
      return res.status(403).json({ error: 'This ticket cannot be edited' });
    }

    // Generate a new approve token for the new review cycle
    const newApproveToken = randomUUID();

    const colValues = {
      [COL.priority]:       { label: d.priority || 'Normal' },
      [COL.format]:         { label: d.format },
      [COL.contentType]:    { labels: [d.contentType] },
      [COL.distribution]:   { labels: [d.distribution] },
      [COL.quantity]:       d.quantity,
      [COL.deadline]:       { date: d.deadline },
      [COL.location]:       { label: d.location },
      [COL.bikesInvolved]:  { label: d.bikesInvolved },
      [COL.approveToken]:   newApproveToken,
      [COL.rejectionReason]: { text: '' }, // clear previous rejection
    };

    if (d.videoFormat)        colValues[COL.videoFormat]        = { labels: [d.videoFormat] };
    if (d.whichModels)        colValues[COL.whichModels]        = d.whichModels;
    if (d.actors)             colValues[COL.actors]             = d.actors;
    if (d.recipient)          colValues[COL.recipient]          = d.recipient;
    if (d.peopleToCoordinate) colValues[COL.peopleToCoordinate] = d.peopleToCoordinate;
    if (d.notes)              colValues[COL.notes]              = { text: d.notes };

    await Promise.all([
      updateItem(item.id, colValues),
      moveItem(item.id, GROUP.inReview),
    ]);

    // Re-send approval request to Amedeo
    await sendApprovalRequest({
      itemId:       item.id,
      summary:      `[EDITED] ${item.name}`,
      data:         d,
      approveToken: newApproveToken,
    }).catch(console.error);

    return res.status(200).json({ ok: true, itemId: item.id });
  }

  return res.status(405).end();
}
