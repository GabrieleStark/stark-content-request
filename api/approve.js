// api/approve.js
// GET  /api/approve?token=XXX&action=approve  → approves immediately
// POST /api/approve  { token, action:'reject', reason } → rejects with reason

import { COL, GROUP, getItemByToken, updateItem, moveItem, getColValue } from './_monday.js';
import { sendApproved, sendRejected } from './_email.js';

const NOTION_API   = 'https://api.notion.com/v1';
const NOTION_VER   = '2022-06-28';

function richText(str) {
  return [{ text: { content: String(str || '') } }];
}

function makeRow(label, value) {
  if (!value) return null;
  return {
    type: 'bulleted_list_item',
    bulleted_list_item: {
      rich_text: [
        { text: { content: `${label}: `, annotations: { bold: true } } },
        { text: { content: String(value) } },
      ],
    },
  };
}

async function createNotionTask(item) {
  const name     = item.name;
  const deadline = getColValue(item, COL.deadline);

  // Properties for the Projects database
  const props = {
    'Name':   { title: richText(name) },
    'Status': { status: { name: 'Not Started' } },
  };

  if (deadline) {
    props['Due Date'] = { date: { start: deadline } };
  }

  // Build page body with all form fields
  const fields = [
    makeRow('Format',            getColValue(item, COL.format)
                                   + (getColValue(item, COL.videoFormat) ? ` · ${getColValue(item, COL.videoFormat)}` : '')),
    makeRow('Content Type',      getColValue(item, COL.contentType)),
    makeRow('Distribution',      getColValue(item, COL.distribution)),
    makeRow('Quantity',          getColValue(item, COL.quantity)),
    makeRow('Deadline',          deadline),
    makeRow('Location',          getColValue(item, COL.location)),
    makeRow('Priority',          getColValue(item, COL.priority)),
    makeRow('Bikes Involved',    getColValue(item, COL.bikesInvolved)),
    makeRow('Which Models',      getColValue(item, COL.whichModels)),
    makeRow('Actors/Riders',     getColValue(item, COL.actors)),
    makeRow('Requester',         getColValue(item, COL.requester)),
    makeRow('Requester Email',   getColValue(item, COL.requesterEmail)),
    makeRow('Recipient',         getColValue(item, COL.recipient)),
    makeRow('Coordinate With',   getColValue(item, COL.peopleToCoordinate)),
    makeRow('Monday Ticket #',   item.id),
  ].filter(Boolean);

  const notes = getColValue(item, COL.notes);
  const children = [
    {
      type: 'heading_2',
      heading_2: { rich_text: richText('Request Details') },
    },
    ...fields,
    ...(notes ? [
      {
        type: 'heading_2',
        heading_2: { rich_text: richText('Notes') },
      },
      {
        type: 'paragraph',
        paragraph: { rich_text: richText(notes) },
      },
    ] : []),
  ];

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
      children,
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
    console.log('[approve] requesterEmail:', requesterEmail);
    if (requesterEmail) {
      try {
        await sendApproved({
          to:      requesterEmail,
          summary: item.name,
          itemId:  item.id,
        });
        console.log('[approve] confirmation email sent to:', requesterEmail);
      } catch (emailErr) {
        console.error('[approve] confirmation email failed:', emailErr);
      }
    } else {
      console.warn('[approve] no requesterEmail found, skipping confirmation email');
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
