// api/approve.js
// GET  /api/approve?token=XXX&action=approve  → approves immediately
// POST /api/approve  { token, action:'reject', reason } → rejects with reason

import { COL, GROUP, getItemByToken, updateItem, moveItem, getColValue } from './_monday.js';
import { sendApproved, sendRejected } from './_email.js';

const NOTION_API   = 'https://api.notion.com/v1';
const NOTION_VER   = '2022-06-28';

async function createNotionTask(item) {
  const name     = item.name;
  const deadline = getColValue(item, COL.deadline);
  const notes    = `Created from Monday ticket #${item.id}. ${getColValue(item, COL.notes) || ''}`.trim();

  const props = {
    'Task': { title: [{ text: { content: name } }] },
    'Status': { select: { name: 'To Do' } },
    'Type':   { select: { name: 'Filming' } },
    'Notes':  { rich_text: [{ text: { content: notes } }] },
  };

  if (deadline) {
    props['Date'] = { date: { start: deadline } };
  }

  const notionRes = await fetch(`${NOTION_API}/pages`, {
    method:  'POST',
    headers: {
      'Authorization':  `Bearer ${process.env.NOTION_API_KEY}`,
      'Notion-Version': NOTION_VER,
      'Content-Type':   'application/json',
    },
    body: JSON.stringify({
      parent:     { database_id: process.env.NOTION_TASKS_DS_ID },
      properties: props,
    }),
  });
  if (!notionRes.ok) {
    const err = await notionRes.text();
    throw new Error(`Notion API error ${notionRes.status}: ${err}`);
  }
}

export default async function handler(req, res) {
  // ── GET: approve action ──────────────────────────────────────────────
  if (req.method === 'GET') {
    const { token, action } = req.query;
    if (!token || action !== 'approve') {
      return res.status(400).send('Invalid request');
    }

    const item = await getItemByToken(COL.approveToken, token);
    if (!item) return res.status(404).send('Ticket not found');

    // Already processed?
    if (item.group.id !== GROUP.inReview) {
      return res.redirect(`${process.env.APP_URL}/track.html?id=${item.id}&msg=already_processed`);
    }

    const requesterEmail = getColValue(item, COL.requesterEmail);
    const editToken      = getColValue(item, COL.editToken);

    await moveItem(item.id, GROUP.inProduction);

    // Create Notion task
    try { await createNotionTask(item); }
    catch (e) { console.error('Notion task creation failed:', e); }

    // Email requester
    if (requesterEmail) {
      await sendApproved({
        to:      requesterEmail,
        summary: item.name,
        itemId:  item.id,
      }).catch(console.error);
    }

    // Redirect Amedeo to a confirmation page
    return res.redirect(`${process.env.APP_URL}/track.html?id=${item.id}&msg=approved`);
  }

  // ── POST: reject action ──────────────────────────────────────────────
  if (req.method === 'POST') {
    const { token, reason } = req.body;
    if (!token) return res.status(400).json({ error: 'Missing token' });

    const item = await getItemByToken(COL.approveToken, token);
    if (!item) return res.status(404).json({ error: 'Ticket not found' });

    const requesterEmail = getColValue(item, COL.requesterEmail);
    const editToken      = getColValue(item, COL.editToken);

    await moveItem(item.id, GROUP.onHold);
    await updateItem(item.id, {
      [COL.rejectionReason]: { text: reason || '' },
    });

    if (requesterEmail && editToken) {
      await sendRejected({
        to:        requesterEmail,
        summary:   item.name,
        itemId:    item.id,
        reason,
        editToken,
      }).catch(console.error);
    }

    return res.status(200).json({ ok: true });
  }

  return res.status(405).end();
}
