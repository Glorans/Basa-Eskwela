// Report-only reads: bounded IN batches and keyset pages. Continue to an empty
// page so a server cap smaller than our requested page size cannot truncate data.
const PAGE_SIZE = 100;
const BATCH_SIZE = 50;
async function reportRows(db, table, columns, filters = {}, batchColumn, ids = []) {
  const batches = batchColumn ? [...new Set(ids)].reduce((all, id, index) => {
    if (index % BATCH_SIZE === 0) all.push([]);
    all[all.length - 1].push(id);
    return all;
  }, []) : [null];
  const results = [];
  for (const batch of batches) {
    let cursor = null;
    for (;;) {
      let query = db.from(table).select(columns).order('id', { ascending: true }).limit(PAGE_SIZE);
      for (const [column, value] of Object.entries(filters)) query = query.eq(column, value);
      if (batchColumn) query = query.in(batchColumn, batch);
      if (cursor !== null) query = query.gt('id', cursor);
      const { data, error } = await query;
      if (error || !Array.isArray(data)) throw new Error(`Unable to retrieve complete weekly report data (${table}). Please retry.`);
      if (!data.length) break;
      for (const row of data) {
        if (typeof row.id !== 'string' || (cursor !== null && row.id <= cursor)) throw new Error(`Invalid weekly report pagination (${table}).`);
        cursor = row.id;
        results.push(row);
      }
    }
  }
  return results;
}
/**
 * room_module_recipients has a composite key and no id column, so it pages by offset in key order,
 * continuing to an empty page. With no roomModuleIds, reads every row.
 */
async function recipientRows(db, roomModuleIds = null) {
  const batches = roomModuleIds === null ? [null] : [...new Set(roomModuleIds)].reduce((all, id, index) => {
    if (index % BATCH_SIZE === 0) all.push([]);
    all[all.length - 1].push(id);
    return all;
  }, []);
  const results = [];
  for (const batch of batches) {
    for (let offset = 0; ; offset += PAGE_SIZE) {
      let query = db.from('room_module_recipients').select('room_module_id,student_id')
        .order('room_module_id', { ascending: true }).order('student_id', { ascending: true }).range(offset, offset + PAGE_SIZE - 1);
      if (batch) query = query.in('room_module_id', batch);
      const { data, error } = await query;
      if (error || !Array.isArray(data)) throw new Error('Unable to retrieve module recipients. Please retry.');
      if (!data.length) break;
      results.push(...data);
    }
  }
  return results;
}
module.exports = { reportRows, recipientRows };
