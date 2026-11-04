// In-memory stand-in for the Supabase client, limited to the
// oral_reading_pronunciation_checks table. It keeps the database rules the
// backend relies on: attempt_id is unique (23505), and a completed row cannot
// be changed (the proposed trigger). No network or credentials are used.
// oral_reading_recordings is modelled read-only: `recordings` maps attempt IDs to
// saved segment paths; by default every attempt has one saved file.
function createPronunciationChecksTable({ installed = true, fail = {}, recordings = {}, recordingsInstalled = true } = {}) {
  const rows = new Map();
  const calls = [];

  function fromRecordings() {
    let attemptId;
    const builder = {
      select() { return builder; },
      eq(_column, value) { attemptId = value; return builder; },
      maybeSingle() { return builder; },
      then(resolve, reject) {
        return Promise.resolve().then(() => {
          calls.push("recording");
          if (!recordingsInstalled) return { data: null, error: { code: "PGRST205", message: "not in schema cache" } };
          if (fail.recording?.()) return { data: null, error: { code: "08006", message: "connection failure" } };
          const segments = Object.hasOwn(recordings, attemptId) ? recordings[attemptId] : [`${attemptId}/000`];
          return { data: segments ? { segments } : null, error: null };
        }).then(resolve, reject);
      },
    };
    return builder;
  }

  function from(table) {
    if (table === "oral_reading_recordings") return fromRecordings();
    if (table !== "oral_reading_pronunciation_checks") throw new Error(`Unexpected table ${table}`);
    const query = { op: "select", filters: [], returning: false, single: false };
    const builder = {
      select(columns) { if (query.op === "select") query.columns = columns; else query.returning = true; return builder; },
      insert(values) { query.op = "insert"; query.values = values; return builder; },
      update(values) { query.op = "update"; query.values = values; return builder; },
      eq(column, value) { query.filters.push((row) => row[column] === value); return builder; },
      in(column, values) { query.filters.push((row) => values.includes(row[column])); return builder; },
      maybeSingle() { query.single = true; return builder; },
      then(resolve, reject) { return Promise.resolve().then(run).then(resolve, reject); },
    };
    function run() {
      calls.push(query.op);
      if (!installed) return { data: null, error: { code: "42P01", message: "relation does not exist" } };
      if (fail[query.op]?.()) return { data: null, error: { code: "08006", message: "connection failure" } };
      const matches = () => [...rows.values()].filter((row) => query.filters.every((filter) => filter(row)));
      if (query.op === "insert") {
        if (rows.has(query.values.attempt_id)) return { data: null, error: { code: "23505", message: "duplicate key" } };
        rows.set(query.values.attempt_id, { failure_code: null, ...structuredClone(query.values) });
        return { data: null, error: null };
      }
      if (query.op === "update") {
        const found = matches();
        if (found.some((row) => row.status === "completed")) {
          return { data: null, error: { code: "55000", message: "A completed pronunciation check cannot be changed." } };
        }
        for (const row of found) Object.assign(row, structuredClone(query.values));
        const data = found.map((row) => structuredClone(row));
        return { data: query.single ? data[0] ?? null : data, error: null };
      }
      const data = matches().map((row) => structuredClone(row));
      return { data: query.single ? data[0] ?? null : data, error: null };
    }
    return builder;
  }

  return { client: { from }, rows, calls };
}

module.exports = { createPronunciationChecksTable };
