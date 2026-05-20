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

// ── Rich text summary with bold labels ──────────────────────────────────────
function buildRichTextSummary(item) {
  const v = (col) => getColValue(item, col) || '';
  const rows = [
    ['Format',           v(COL.format) + (v(COL.videoFormat) ? ' · ' + v(COL.videoFormat) : '')],
    ['Content type',     v(COL.contentType)],
    ['Distribution',     v(COL.distribution)],
    ['Quantity',         v(COL.quantity)],
    ['Deadline',         v(COL.deadline)],
    ['Location',         v(COL.location)],
    ['Bikes',            v(COL.bikesInvolved) + (v(COL.whichModels) ? ' — ' + v(COL.whichModels) : '')],
    v(COL.actors)             && ['Actors/Riders',   v(COL.actors)],
    v(COL.requester)          && ['On behalf of',    v(COL.requester)],
    v(COL.requesterEmail)     && ['Requester email', v(COL.requesterEmail)],
    v(COL.peopleToCoordinate) && ['Coordinate with', v(COL.peopleToCoordinate)],
    ['Monday ticket',    `#${item.id}`],
  ].filter(Boolean);

  const result = [];
  for (let i = 0; i < rows.length; i++) {
    const [label, value] = rows[i];
    if (i > 0) result.push({ type: 'text', text: { content: '\n' } });
    result.push({ type: 'text', text: { content: `${label}: ` }, annotations: { bold: true } });
    result.push({ type: 'text', text: { content: String(value || '') } });
  }
  return result;
}

// ── Parse uploaded file URLs from Monday notes field ─────────────────────────
function parseFileUrls(notesText) {
  if (!notesText) return [];
  const match = notesText.match(/📎 Uploaded files:\n([\s\S]+?)(\n\n|$)/);
  if (!match) return [];
  return match[1].split('\n').filter(u => u.startsWith('http'));
}

// ── Create Notion project page ───────────────────────────────────────────────
async function createNotionProject(item) {
  const name     = item.name;
  const deadline = getColValue(item, COL.deadline);
  const format   = getColValue(item, COL.format) || '';
  const priority = getColValue(item, COL.priority) || 'Normal';
  const notes    = getColValue(item, COL.notes)  || '';

  const FORMAT_MAP   = { 'Video': 'Video', 'Photo': 'Photos', 'Mixed': 'Video & Photo' };
  const PRIORITY_MAP = { 'Urgent': 'Urgent', 'Normal': 'Medium', 'Low': 'Low' };

  const props = {
    'Name':     { title: richText(name) },
    'Status':   { status: { name: 'In progress' } },
    'Format':   { multi_select: [{ name: FORMAT_MAP[format] || 'Video' }] },
    'Priority': { multi_select: [{ name: PRIORITY_MAP[priority] || 'Medium' }] },
    'Text':     { rich_text: buildRichTextSummary(item) },
  };

  if (deadline) props['Release Date'] = { date: { start: deadline } };

  // Add uploaded files to Files & media property
  const fileUrls = parseFileUrls(notes);
  if (fileUrls.length) {
    props['Files & media'] = {
      files: fileUrls.map(url => ({
        name: decodeURIComponent(url.split('/').pop().split('?')[0]).slice(0, 100) || 'attachment',
        type: 'external',
        external: { url },
      })),
    };
  }

  const res = await fetch(`${NOTION_API}/pages`, {
    method:  'POST',
    headers: notionHeaders(),
    body:    JSON.stringify({
      parent:     { database_id: PROJECTS_DB },
      properties: props,
    }),
  });

  if (!res.ok) throw new Error(`Notion project error ${res.status}: ${await res.text()}`);
  const page = await res.json();
  return { pageId: page.id, pageUrl: page.url, format, priority };
}

// ── Create single delivery task linked to the project ───────────────────────
async function createDeliveryTask(pageId, format, deadline, priority) {
  const TASK_NAME     = { 'Video': 'Video Delivery', 'Photo': 'Photo Delivery', 'Mixed': 'Delivery' };
  const PRIORITY_MAP  = { 'Urgent': 'Urgent', 'Normal': 'Medium', 'Low': 'Low' };
  const taskName      = TASK_NAME[format] || 'Delivery';
  const taskPriority  = PRIORITY_MAP[priority] || 'Medium';

  const res = await fetch(`${NOTION_API}/pages`, {
    method:  'POST',
    headers: notionHeaders(),
    body:    JSON.stringify({
      parent:     { database_id: TASKS_DB },
      properties: {
        'Name':     { title: richText(taskName) },
        'Status':   { select: { name: 'Not Started' } },
        'Project':  { relation: [{ id: pageId }] },
        'Priority': { multi_select: [{ name: taskPriority }] },
        ...(deadline ? { 'Due Date': { date: { start: deadline } } } : {}),
      },
    }),
  });

  if (!res.ok) console.error(`[notion] Task "${taskName}" error ${res.status}:`, await res.text());
  else         console.log(`[notion] Task "${taskName}" created with priority ${taskPriority}`);
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

    try {
      const deadline = getColValue(item, COL.deadline);
      const { pageId, pageUrl, format, priority } = await createNotionProject(item);
      await createDeliveryTask(pageId, format, deadline, priority);
      await createUpdate(item.id, `📎 Notion project: ${pageUrl}`).catch(() => {});
      console.log(`[notion] Project created: ${pageUrl}`);
    } catch (err) {
      console.error('[notion] Setup failed:', err.message);
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
