// api/approve.js
// GET  /api/approve?token=XXX&action=approve  → approves immediately
// POST /api/approve  { token, action:'reject', reason } → rejects with reason

import { COL, GROUP, getItemByToken, updateItem, moveItem, getColValue } from './_monday.js';
import { sendApproved, sendRejected } from './_email.js';

const NOTION_API  = 'https://api.notion.com/v1';
const NOTION_VER  = '2022-06-28';
const PROJECTS_DB = '36464f16-cf3f-81a7-bbb3-f4761c94b070'; // Projects database
const TASKS_DB    = '36464f16-cf3f-81ad-ae40-c9c473f9ba98'; // Tasks database

// ── Task templates by format ────────────────────────────────────────────────
const TASKS_BY_FORMAT = {
  'Video': [
    { name: 'Planning & Brief',  status: 'Planning'    },
    { name: 'Filming',           status: 'Not Started' },
    { name: 'Editing',           status: 'Not Started' },
    { name: 'Color Grading',     status: 'Not Started' },
    { name: 'Review & Approval', status: 'Not Started' },
    { name: 'Export & Delivery', status: 'Not Started' },
  ],
  'Photo': [
    { name: 'Planning & Brief',  status: 'Planning'    },
    { name: 'Shooting',          status: 'Not Started' },
    { name: 'Selection',         status: 'Not Started' },
    { name: 'Retouching',        status: 'Not Started' },
    { name: 'Review & Approval', status: 'Not Started' },
    { name: 'Export & Delivery', status: 'Not Started' },
  ],
  'Mixed': [
    { name: 'Planning & Brief',  status: 'Planning'    },
    { name: 'Filming',           status: 'Not Started' },
    { name: 'Shooting',          status: 'Not Started' },
    { name: 'Editing',           status: 'Not Started' },
    { name: 'Color Grading',     status: 'Not Started' },
    { name: 'Retouching',        status: 'Not Started' },
    { name: 'Review & Approval', status: 'Not Started' },
    { name: 'Export & Delivery', status: 'Not Started' },
  ],
};

// Extra tasks by content type
const EXTRA_BY_CONTENT_TYPE = {
  'Tutorial':          { name: 'Script Writing',     status: 'Planning'    },
  'YouTube Long-form': { name: 'Thumbnail Design',   status: 'Not Started' },
  'Launch':            { name: 'Brief & Positioning', status: 'Planning'   },
};

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

function heading2(text) {
  return { type: 'heading_2', heading_2: { rich_text: richText(text) } };
}

function paragraph(text) {
  return { type: 'paragraph', paragraph: { rich_text: richText(text) } };
}

function bulletRow(label, value) {
  if (!value) return null;
  return {
    type: 'bulleted_list_item',
    bulleted_list_item: {
      rich_text: [
        { type: 'text', text: { content: `${label}: ` }, annotations: { bold: true } },
        { type: 'text', text: { content: String(value) } },
      ],
    },
  };
}

// ── Create Notion project page ───────────────────────────────────────────────
async function createNotionProject(item) {
  const name        = item.name;
  const deadline    = getColValue(item, COL.deadline);
  const format      = getColValue(item, COL.format)      || '';
  const videoFormat = getColValue(item, COL.videoFormat) || '';
  const contentType = getColValue(item, COL.contentType) || '';
  const description = getColValue(item, COL.notes)       || name;

  // Map form format → Notion Format multi_select options
  const FORMAT_MAP = { 'Video': 'Video', 'Photo': 'Photos', 'Mixed': 'Video & Photo' };
  const notionFormat = FORMAT_MAP[format] || 'Video';

  // Map form priority → Notion Priority multi_select options
  const PRIORITY_MAP = { 'Urgent': 'Urgent', 'High': 'Urgent', 'Normal': 'Medium', 'Low': 'Low' };
  const notionPriority = PRIORITY_MAP[getColValue(item, COL.priority)] || 'Medium';

  // Project properties
  const props = {
    'Name':     { title: richText(name) },
    'Status':   { status: { name: 'In progress' } },
    'Format':   { multi_select: [{ name: notionFormat }] },
    'Priority': { multi_select: [{ name: notionPriority }] },
  };
  if (deadline) {
    props['Release Date'] = { date: { start: deadline } };
  }

  // Page body — mirrors the "Start from here" template structure
  const details = [
    bulletRow('Format',          format + (videoFormat ? ` · ${videoFormat}` : '')),
    bulletRow('Content Type',    contentType),
    bulletRow('Distribution',    getColValue(item, COL.distribution)),
    bulletRow('Quantity',        getColValue(item, COL.quantity)),
    bulletRow('Deadline',        deadline),
    bulletRow('Location',        getColValue(item, COL.location)),
    bulletRow('Bikes',           getColValue(item, COL.bikesInvolved)
                                   + (getColValue(item, COL.whichModels) ? ` — ${getColValue(item, COL.whichModels)}` : '')),
    bulletRow('Actors/Riders',   getColValue(item, COL.actors)),
    bulletRow('Requester',       getColValue(item, COL.requester)),
    bulletRow('Requester Email', getColValue(item, COL.requesterEmail)),
    bulletRow('Coordinate With', getColValue(item, COL.peopleToCoordinate)),
    bulletRow('Monday Ticket #', item.id),
  ].filter(Boolean);

  const children = [
    heading2('Overview Description'),
    paragraph(description),
    heading2('Request Details'),
    ...details,
    heading2('Milanote'),
    paragraph('Link: '),
    heading2('Frame.IO'),
    paragraph('Link: '),
    heading2('Google Drive'),
    paragraph('Link: '),
    heading2('YouTube'),
    paragraph('Link: '),
  ];

  const res = await fetch(`${NOTION_API}/pages`, {
    method:  'POST',
    headers: notionHeaders(),
    body:    JSON.stringify({
      parent:     { database_id: PROJECTS_DB },
      properties: props,
      children,
    }),
  });

  if (!res.ok) throw new Error(`Notion project error ${res.status}: ${await res.text()}`);
  const page = await res.json();
  return { pageId: page.id, pageUrl: page.url, format, contentType };
}

// ── Create tasks linked to the project ──────────────────────────────────────
async function createProjectTasks(pageId, pageUrl, format, contentType, deadline) {
  const baseTasks = TASKS_BY_FORMAT[format] || TASKS_BY_FORMAT['Video'];
  const extra     = EXTRA_BY_CONTENT_TYPE[contentType];
  const tasks     = extra ? [extra, ...baseTasks] : baseTasks;

  await Promise.all(tasks.map(task =>
    fetch(`${NOTION_API}/pages`, {
      method:  'POST',
      headers: notionHeaders(),
      body:    JSON.stringify({
        parent:     { database_id: TASKS_DB },
        properties: {
          'Name':    { title: richText(task.name) },
          'Status':  { select: { name: task.status } },
          'Project': { relation: [{ id: pageId }] },
          ...(deadline && task.status !== 'Planning'
            ? { 'Due Date': { date: { start: deadline } } }
            : {}),
        },
      }),
    }).then(r => { if (!r.ok) console.error(`Task "${task.name}" failed:`, r.status); })
  ));
}

// ── Full Notion setup on approval ────────────────────────────────────────────
async function setupNotionProject(item) {
  const deadline = getColValue(item, COL.deadline);
  const { pageId, pageUrl, format, contentType } = await createNotionProject(item);
  await createProjectTasks(pageId, pageUrl, format, contentType, deadline);
  console.log(`[notion] Project created: ${pageUrl} with ${format} tasks`);
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

    const results = await Promise.allSettled([
      setupNotionProject(item),
      requesterEmail
        ? sendApproved({ to: requesterEmail, summary: item.name, itemId: item.id })
        : Promise.resolve(),
    ]);

    results.forEach((r, i) => {
      if (r.status === 'rejected') console.error(`[approve] step ${i} failed:`, r.reason?.message);
    });

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
