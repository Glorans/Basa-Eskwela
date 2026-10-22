const TEACHER_A = "11111111-1111-4111-8111-111111111111";
const TEACHER_B = "22222222-2222-4222-8222-222222222222";
const GENERAL = "33333333-3333-4333-8333-333333333333";
const ADMIN = "44444444-4444-4444-8444-444444444444";
const MATERIAL_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const MATERIAL_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function requester(id, role) {
  return { user: { id }, profile: { id, role } };
}

function material(id, owner, title = "Reading") {
  return {
    id,
    uploaded_by: owner,
    title,
    language: "en",
    original_filename: "reading.pdf",
    storage_path: `${owner}/${id}.pdf`,
    mime_type: "application/pdf",
    file_size_bytes: 2048,
    raw_extracted_text: "Original parser text.",
    content_text: "Reviewed reading text.",
    ocr_confidence: null,
    extraction_status: "completed",
    created_at: "2026-09-30T00:00:00.000Z",
    updated_at: "2026-09-30T00:00:00.000Z",
  };
}

class Query {
  constructor(database, table) {
    this.database = database;
    this.table = table;
    this.action = "select";
    this.filters = [];
    this.payload = undefined;
    this.ordering = undefined;
    this.rowLimit = undefined;
    this.singleMode = undefined;
  }

  select() { return this; }
  insert(payload) { this.action = "insert"; this.payload = payload; return this; }
  update(payload) { this.action = "update"; this.payload = payload; return this; }
  delete() { this.action = "delete"; return this; }
  eq(column, value) { this.filters.push((row) => row[column] === value); return this; }
  in(column, values) { this.filters.push((row) => values.includes(row[column])); return this; }
  // Keyset pagination used by the M7 complete-read helper (reportRows).
  gt(column, value) { this.filters.push((row) => row[column] > value); return this; }
  order(column, options = {}) { this.ordering = { column, ascending: options.ascending !== false }; return this; }
  range(start, end) { this.rowRange = { start, end }; return this; }
  limit(value) { this.rowLimit = value; return this; }
  maybeSingle() { this.singleMode = "maybe"; return this; }
  single() { this.singleMode = "required"; return this; }
  then(resolve, reject) { return this.execute().then(resolve, reject); }

  async execute() {
    const rows = this.database.tables[this.table];
    if (!rows) return { data: null, error: { code: "UNKNOWN_TABLE", message: this.table } };
    const matches = (row) => this.filters.every((filter) => filter(row));

    if (this.action === "insert") {
      const inserted = (Array.isArray(this.payload) ? this.payload : [this.payload])
        .map((row) => ({ ...row }));
      rows.push(...inserted);
      return { data: inserted, error: null };
    }

    if (this.action === "update") {
      const updated = [];
      for (const row of rows) {
        if (matches(row)) {
          Object.assign(row, this.payload);
          updated.push({ ...row });
        }
      }
      return { data: updated, error: null };
    }

    if (this.action === "delete") {
      const deleted = rows.filter(matches);
      this.database.tables[this.table] = rows.filter((row) => !matches(row));
      if (this.table === "comprehension_questions") {
        const ids = deleted.map((row) => row.id);
        this.database.tables.comprehension_question_answers =
          this.database.tables.comprehension_question_answers
            .filter((answer) => !ids.includes(answer.question_id));
      }
      return { data: deleted, error: null };
    }

    let selected = rows.filter(matches).map((row) => ({ ...row }));
    if (this.ordering) {
      const direction = this.ordering.ascending ? 1 : -1;
      selected.sort((a, b) => (a[this.ordering.column] > b[this.ordering.column] ? direction : -direction));
    }
    if (this.rowRange) selected = selected.slice(this.rowRange.start, this.rowRange.end + 1);
    if (this.rowLimit !== undefined) selected = selected.slice(0, this.rowLimit);
    if (this.singleMode === "maybe") return { data: selected[0] ?? null, error: null };
    if (this.singleMode === "required") {
      return selected.length === 1
        ? { data: selected[0], error: null }
        : { data: null, error: { code: "PGRST116", message: "Expected one row" } };
    }
    return { data: selected, error: null };
  }
}

function createDatabase(seed = {}) {
  const database = {
    tables: {
      profiles: [],
      uploaded_materials: [],
      comprehension_questions: [],
      material_question_sets: [],
      comprehension_question_answers: [],
      modules: [],
      reading_activity_assignments: [],
      m6_comprehension_attempts: [],
      ...structuredClone(seed),
    },
    removedStoragePaths: [],
    storageError: null,
    from(table) { return new Query(this, table); },
    storage: {
      from() {
        return {
          remove: async (paths) => {
            if (database.storageError) return { error: database.storageError };
            database.removedStoragePaths.push(...paths);
            return { error: null };
          },
        };
      },
    },
  };
  return database;
}

function dependencies(database) {
  return { getSupabaseAdmin: () => database };
}

function generatedQuestions(prefix = "10000000") {
  return ["literal", "literal", "inferential", "inferential", "critical", "critical"]
    .map((type, index) => {
      const options = [`Answer ${index}`, `Choice B ${index}`, `Choice C ${index}`, `Choice D ${index}`];
      return {
        id: `${prefix}-${String(index + 1).padStart(4, "0")}-4000-8000-${String(index + 1).padStart(12, "0")}`,
        type,
        questionText: `${type} question ${index + 1}?`,
        options,
        correctAnswer: options[0],
        scaffoldingHint: `Hint ${index + 1}`,
      };
    });
}


module.exports = { createDatabase, dependencies, requester, material, generatedQuestions, TEACHER_A, TEACHER_B, GENERAL, ADMIN, MATERIAL_A, MATERIAL_B };
