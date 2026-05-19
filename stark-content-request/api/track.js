// api/track.js — GET /api/track?id=ITEM_ID
// Returns ticket status for the tracking page

import { getItemById, getColValue, COL, GROUP } from './_monday.js';

const STATUS_MAP = {
  [GROUP.inReview]:    { step: 1, label: 'In Review',    color: '#fdab3d' },
  [GROUP.inProduction]:{ step: 2, label: 'In Production',color: '#9d50dd' },
  [GROUP.delivered]:   { step: 3, label: 'Delivered',    color: '#00c875' },
  [GROUP.onHold]:      { step: -1, label: 'Rejected',    color: '#e2445c' },
  [GROUP.new]:         { step: 0,  label: 'New',         color: '#579bfc' },
};

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();

  const { id } = req.query;
  if (!id) return res.status(400).json({ error: 'Missing id' });

  let item;
  try { item = await getItemById(id); }
  catch (e) { return res.status(500).json({ error: 'Failed to fetch ticket' }); }

  if (!item) return res.status(404).json({ error: 'Ticket not found' });

  const status  = STATUS_MAP[item.group.id] ?? { step: 0, label: item.group.title, color: '#888' };
  const reason  = getColValue(item, COL.rejectionReason);
  const editToken = getColValue(item, COL.editToken);

  return res.status(200).json({
    id:       item.id,
    name:     item.name,
    group:    item.group.title,
    step:     status.step,
    statusLabel: status.label,
    statusColor: status.color,
    rejectionReason: reason,
    editToken: status.step === -1 ? editToken : null, // only expose on rejected
    deadline: getColValue(item, COL.deadline),
    format:   getColValue(item, COL.format),
  });
}
