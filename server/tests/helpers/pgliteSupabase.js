// A tiny Supabase-client stand-in over PGlite, for tests that exercise services against the REAL proposed SQL.
// Supports: from(t).select(cols).eq/in/gte/is/order/limit -> await | maybeSingle() | single(); insert(row).select().single();
// update(patch).eq(...).select(); rpc(name, args). Errors come back as { data: null, error: { code, message } }.
function createPgliteSupabase(d) {
  const run = async (sql, params) => {
    try { return { data: (await d.query(sql, params)).rows, error: null }; }
    catch (e) { return { data: null, error: { code: e.code, message: e.message } }; }
  };
  function from(table) {
    const where = []; const params = []; let columns = "*"; let order = ""; let limit = ""; let mode = "select"; let payload = null;
    const add = (sql, value) => { params.push(value); where.push(sql.replace("?", `$${params.length}`)); };
    const builder = {
      select(cols) { if (mode === "select") columns = cols || "*"; return builder; },
      eq(c, v) { if (v === null) where.push(`${c} is null`); else add(`${c} = ?`, v); return builder; },
      in(c, values) { add(`${c} = any(?)`, values); return builder; },
      gte(c, v) { add(`${c} >= ?`, v); return builder; },
      is(c, v) { where.push(v === null ? `${c} is null` : `${c} is ${v}`); return builder; },
      order(c, { ascending = true } = {}) { order = ` order by ${c} ${ascending ? "asc" : "desc"}`; return builder; },
      limit(n) { limit = ` limit ${Number(n)}`; return builder; },
      insert(row) { mode = "insert"; payload = row; return builder; },
      update(patch) { mode = "update"; payload = patch; return builder; },
      async exec() {
        const w = where.length ? ` where ${where.join(" and ")}` : "";
        if (mode === "insert") {
          const keys = Object.keys(payload);
          const vals = keys.map((k) => (payload[k] !== null && typeof payload[k] === "object" && !(payload[k] instanceof Date) ? JSON.stringify(payload[k]) : payload[k]));
          return run(`insert into ${table}(${keys.join(", ")}) values (${keys.map((_, i) => `$${i + 1}`).join(", ")}) returning *`, vals);
        }
        if (mode === "update") {
          const keys = Object.keys(payload);
          const shift = params.length;
          const set = keys.map((k, i) => `${k} = $${shift + i + 1}`).join(", ");
          return run(`update ${table} set ${set}${w} returning *`, [...params, ...keys.map((k) => payload[k])]);
        }
        return run(`select ${columns} from ${table}${w}${order}${limit}`, params);
      },
      then(resolve, reject) { return builder.exec().then(resolve, reject); },
      async maybeSingle() { const r = await builder.exec(); return r.error ? r : { data: r.data[0] ?? null, error: null }; },
      async single() { const r = await builder.exec(); return r.error ? r : r.data.length === 1 ? { data: r.data[0], error: null } : { data: null, error: { code: "PGRST116", message: "not one row" } }; },
    };
    return builder;
  }
  async function rpc(name, args = {}) {
    const keys = Object.keys(args);
    const r = await run(`select * from ${name}(${keys.map((k, i) => `${k} => $${i + 1}`).join(", ")})`, keys.map((k) => args[k]));
    if (r.error) return r;
    const row = r.data[0];
    const single = row && Object.keys(row).length === 1 && Object.keys(row)[0] === name;
    return { data: single ? row[name] : r.data, error: null };
  }
  return { from, rpc };
}

module.exports = { createPgliteSupabase };
