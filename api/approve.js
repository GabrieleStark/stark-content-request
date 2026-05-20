// api/approve.js
// GET  /api/approve?token=XXX&action=approve  → approves immediately
// POST /api/approve  { token, action:'reject', reason } → rejects with reason
//
// Notion project creation is handled by the Cowork scheduled task
// "notion-project-setup", which polls Monday every 15 min for items
// in "In Production" without a Notion URL and creates them from the template.

import { COL, GROUP, getItemByToken, updateItem, moveItem, getColValue, createUpdate } from './_monday.js';
import { sendApproved, sendRejected } from './_email.js';

// ── Handler ──────────────────────────────────────────────────────────────────
export default async function handler(req, res) {

  // GET: approve
  if (req.method === 'GET') {
    const { token, action } = req.query;
    if (!token || action !== 'approve') return res.status(400).send('Invalid request');

    const item = await getItemByToken(COL.approveToken, token);
    if (!item) return res.status(404).send('Ticket not found');

    if (item.group.id !== GROUP.inReview) {
      return res.redirect(`${process.env.APP_URL}/track.html?id=${item.id}&msg=already_processed`);
    }

    const requesterEmail = getColValue(item, COL.requesterEmail);

    await moveItem(item.id, GROUP.inProduction);

    // Leave a structured update so the Cowork automation can pick it up
    const format      = getColValue(item, COL.format)      || '';
    const videoFormat = getColValue(item, COL.videoFormat) || '';
    const contentType = getColValue(item, COL.contentType) || '';
    const deadline    = getColValue(item, COL.deadline)    || '';
    const priority    = getColValue(item, COL.priority)    || '';
    const notes       = getColValue(item, COL.notes)       || '';

    const updateBody = [
      `✅ Approved — Notion setup pending`,
      ``,
      `Format: ${format}${videoFormat ? ` · ${videoFormat}` : ''}`,
      `Content type: ${contentType}`,
      `Deadline: ${deadline}`,
      `Priority: ${priority}`,
      notes ? `Notes: ${notes}` : '',
    ].filter(Boolean).join('\n');

    await createUpdate(item.id, updateBody).catch(e =>
      console.error('[monday] update comment failed:', e.message)
    );

    if (requesterEmail) {
      await sendApproved({ to: requesterEmail, summary: item.name, itemId: item.id })
        .catch(e => console.error('[email] sendApproved failed:', e.message));
    }

    return res.redirect(`${process.env.APP_URL}/track.html?id=${item.id}&msg=approved`);
  }

  // POST: reject
  if (req.method === 'POST') {
    const { token, reason } = req.body;
    if (!token) return res.status(400).json({ error: 'Missing token' });

    const item = await getItemByToken(COL.approveToken, token);
    if (!item) return res.status(404).json({ error: 'Ticket not found' });

    const requesterEmail = getColValue(item, COL.requesterEmail);
    const editToken      = getColValue(item, COL.editToken);

    await moveItem(item.id, GROUP.onHold);
    await updateItem(item.id, { [COL.rejectionReason]: { text: reason || '' } });

    if (requesterEmail && editToken) {
      await sendRejected({
        to: requesterEmail, summary: item.name,
        itemId: item.id, reason, editToken,
      }).catch(console.error);
    }

    return res.status(200).json({ ok: true });
  }

  return res.status(405).end();
}
