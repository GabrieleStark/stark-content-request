// api/_monday.js — shared Monday.com helpers

const BOARD_ID = '18413868933';

export const COL = {
  priority:           'color_mm3gpajk',
  format:             'color_mm3g8g9w',
  contentType:        'dropdown_mm3g9w7s',
  distribution:       'dropdown_mm3gvqam',
  videoFormat:        'dropdown_mm3gt618',
  quantity:           'numeric_mm3gfep7',
  deadline:           'date_mm3gsg2c',
  location:           'color_mm3gj581',
  bikesInvolved:      'color_mm3gtqqb',
  whichModels:        'text_mm3gzm6h',
  actors:             'text_mm3gx9wq',
  requester:          'text_mm3gm0qf',
  recipient:          'text_mm3gs3a5',
  peopleToCoordinate: 'text_mm3gv102',
  reference:          'link_mm3gdb9m',
  approvalRequired:   'color_mm3ghjye',
  notes:              'long_text_mm3g8kdw',
  requesterEmail:     'email_mm3gkvmy',
  ticketStatus:       'color_mm3ggfea',
  rejectionReason:    'long_text_mm3ggnsk',
  editToken:          'text_mm3gqpd8',
  approveToken:       'text_mm3g4qxz',
};

export const GROUP = {
  new:         'group_mm3gyapk',
  inReview:    'group_mm3gc0gd',
  inProduction:'group_mm3ggqzw',
  delivered:   'group_mm3g3a0n',
  onHold:      'group_mm3gwwrx',
};

async function mondayQuery(query) {
  const res = await fetch('https://api.monday.com/v2', {
    method: 'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': process.env.MONDAY_API_KEY,
      'API-Version':   '2024-01',
    },
    body: JSON.stringify({ query }),
  });
  const json = await res.json();
  if (json.errors) throw new Error(JSON.stringify(json.errors));
  return json.data;
}

export async function createItem(groupId, name, columnValues) {
  const data = await mondayQuery(`
    mutation {
      create_item(
        board_id: ${BOARD_ID},
        group_id: "${groupId}",
        item_name: ${JSON.stringify(name)},
        column_values: ${JSON.stringify(JSON.stringify(columnValues))}
      ) { id }
    }
  `);
  return data.create_item.id;
}

export async function updateItem(itemId, columnValues) {
  await mondayQuery(`
    mutation {
      change_multiple_column_values(
        board_id: ${BOARD_ID},
        item_id: ${itemId},
        column_values: ${JSON.stringify(JSON.stringify(columnValues))}
      ) { id }
    }
  `);
}

export async function moveItem(itemId, groupId) {
  await mondayQuery(`
    mutation {
      move_item_to_group(item_id: ${itemId}, group_id: "${groupId}") { id }
    }
  `);
}

export async function getItemByToken(tokenColumnId, token) {
  const data = await mondayQuery(`
    query {
      boards(ids: [${BOARD_ID}]) {
        items_page(
          limit: 1,
          query_params: {
            rules: [{ column_id: "${tokenColumnId}", compare_value: ["${token}"] }]
          }
        ) {
          items {
            id name group { id title }
            column_values { id text value }
          }
        }
      }
    }
  `);
  return data.boards?.[0]?.items_page?.items?.[0] ?? null;
}

export async function getItemById(itemId) {
  const data = await mondayQuery(`
    query {
      items(ids: [${itemId}]) {
        id name group { id title }
        column_values { id text value }
      }
    }
  `);
  return data.items?.[0] ?? null;
}

export function getColValue(item, colId) {
  const col = item.column_values.find(c => c.id === colId);
  return col?.text ?? null;
}
