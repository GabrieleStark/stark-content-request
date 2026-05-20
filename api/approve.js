// api/approve.js
// GET  /api/approve?token=XXX&action=approve  → approves immediately
// POST /api/approve  { token, action:'reject', reason } → rejects with reason

import { COL, GROUP, getItemByToken, updateItem, moveItem, getColValue, createUpdate } from './_monday.js';
import { sendApproved, sendRejected } from './_email.js';

const NOTION_API  = 'https://api.notion.com/v1';
const NOTION_VER  = '2022-06-28';
const PROJECTS_DB = '36464f16-cf3f-81a7-bbb3-f4761c94b070';
const TASKS_DB    = '36464f16-cf3f-81ad-ae40-c9c473f9ba98';

function notionHeaders() {
  return {
    'Authorization':  `Bearer ${process.env.NOTION_API_KEY}`,
    'Notion-Version': NOTION_VER,
    'Content-Type':   'application/json',
  };
}

function richText(str) {
  return [{ type: 'text', text: { content: String(str || '').slice(0, 2000) } }];
}

// ── Create Notion project page ───────────────────────────────────────────────
// Creates the page with properties only (no children body).
// Notion applies the "Start from here" default template on first open,
// which includes the inline Tasks view, Overview, Milanote, Frame.IO, etc.
async function createNotionProject(item) {
  const name     = item.name;
  const deadline = getColValue(item, COL.deadline);
  const format   = getColValue(item, COL.format) || '';
  const notes    = getColValue(item, COL.notes)  || '';

  const FORMAT_MAP   = { 'Video': 'Video', 'Photo': 'Photos', 'Mixed': 'Video & Photo' };
  const PRIORITY_MAP = { 'Urgent': 'Urgent', 'High': 'Urgent', 'Normal': 'Medium', 'Low': 'Low' };

  const props = {
    'Name':     { title: richText(name) },
    'Status':   { status: { name: 'In progress' } },
    'Format':   { multi_select: [{ name: FORMAT_MAP[format] || 'Video' }] },
    'Priority': { multi_select: [{ name: PRIORITY_MAP[getColValue(item, COL.priority)] || 'Medium' }] },
    'Text':     { rich_text: richText(buildSummary(item)) },
  };

  if (deadline) props['Release Date'] = { date: { start: deadline } };

  const res = await fetch(`${NOTION_API}/pages`, {
    method:  'POST',
    headers: notionHeaders(),
    body:    JSON.stringify({
      parent:     { database_id: PROJECTS_DB },
      properties: props,
      // No children — Notion applies the "Start from here" default template on first open
    }),
  });

  if (!res.ok) throw new Error(`Notion project error ${res.status}: ${await res.text()}`);
  const page = await res.json();
  return { pageId: page.id, pageUrl: page.url, format };
}

function buildSummary(item) {
  const lines = [
    `Format: ${getColValue(item, COL.format) || ''}${getColValue(item, COL.videoFormat) ? ' · ' + getColValue(item, COL.videoFormat) : ''}`,
    `Content type: ${getColValue(item, COL.contentType) || ''}`,
    `Distribution: ${getColValue(item, COL.distribution) || ''}`,
    `Quantity: ${getColValue(item, COL.quantity) || ''}`,
    `Deadline: ${getColValue(item, COL.deadline) || ''}`,
    `Location: ${getColValue(item, COL.location) || ''}`,
    `Bikes: ${getColValue(item, COL.bikesInvolved) || ''}${getColValue(item, COL.whichModels) ? ' — ' + getColValue(item, COL.whichModels) : ''}`,
    getColValue(item, COL.actors)             ? `Actors/Riders: ${getColValue(item, COL.actors)}` : '',
    getColValue(item, COL.requester)          ? `On behalf of: ${getColValue(item, COL.requester)}` : '',
    getColValue(item, COL.requesterEmail)     ? `Requester email: ${getColValue(item, COL.requesterEmail)}` : '',
    getColValue(item, COL.peopleToCoordinate) ? `Coordinate with: ${getColValue(item, COL.peopleToCoordinate)}` : '',
    getColValue(item, COL.notes)              ? `Notes: ${getColValue(item, COL.notes)}` : '',
    `Monday ticket: #${item.id}`,
  ].filter(Boolean);
  return lines.join('\n');
}

// ── Create single delivery task linked to the project ───────────────────────
async function createDeliveryTask(pageId, format, deadline) {
  const TASK_NAME = { 'Video': 'Video Delivery', 'Photo': 'Photo Delivery', 'Mixed': 'Delivery' };
  const taskName  = TASK_NAME[format] || 'Delivery';

  const res = await fetch(`${NOTION_API}/pages`, {
    method:  'POST',
    headers: notionHeaders(),
    body:    JSON.stringify({
      parent:     { database_id: TASKS_DB },
      properties: {
        'Name':    { title: richText(taskName) },
        'Status':  { select: { name: 'Not Started' } },
        'Project': { relation: [{ id: pageId }] },
        ...(deadline ? { 'Due Date': { date: { start: deadline } } } : {}),
      },
    }),
  });

  if (!res.ok) console.error(`[notion] Task "${taskName}" error ${res.status}:`, await res.text());
  else         console.log(`[notion] Task "${taskName}" created`);
}

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

    // Create Notion project + task immediately
    try {
      const deadline = getColValue(item, COL.deadline);
      const { pageId, pageUrl, format } = await createNotionProject(item);
      await createDeliveryTask(pageId, format, deadline);

      // Mark item so the Cowork fallback task skips it
      await createUpdate(item.id, `📎 Notion project: ${pageUrl}`).catch(() => {});

      console.log(`[notion] Project created: ${pageUrl}`);
    } catch (err) {
      console.error('[notion] Setup failed:', err.message);
      // The Cowork scheduled task "notion-project-setup" will retry automatically
    }

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
