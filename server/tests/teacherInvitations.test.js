const test = require("node:test");
const assert = require("node:assert/strict");
const { createHash, randomUUID } = require("node:crypto");
const express = require("express");
const { createDatabase } = require("./fixtures/materialDatabase");
const { createTeacherInvitationsRouter } = require("../routes/teacherInvitations");
const { SupabaseAuthenticationError } = require("../services/supabaseAdmin");
const { invitationMetadata, createTeacherInvitation, listTeacherInvitations, revokeTeacherInvitation } = require("../services/teacherInvitationService");
const future = () => new Date(Date.now() + 86400000).toISOString();
// M1 multi-tenancy (F10): codes belong to the School Admin's school.
const S1 = "5c000000-0000-4000-8000-000000000001", S2 = "5c000000-0000-4000-8000-000000000002";
const REQ = { user: { id: "actor" }, profile: { id: "actor", role: "admin", school_id: S1 } };

function fixture(role = "admin") {
  const db = createDatabase({ profiles: [{ id: "actor", role, school_id: ["admin", "teacher", "student"].includes(role) ? S1 : null }], teacher_invite_codes: [] });
  const from = db.from.bind(db);
  const selected = [];
  db.from = table => {
    const query = from(table);
    const select = query.select.bind(query);
    query.select = columns => { selected.push({ table, columns }); return select(columns); };
    const insert = query.insert.bind(query);
    query.insert = row => insert({ id: randomUUID(), created_at: new Date().toISOString(), use_count: 0, ...row });
    const execute = query.execute.bind(query);
    query.execute = async () => {
      const result = await execute();
      if ((query.action === "insert" || query.action === "update") && query.singleMode) result.data = result.data[0] ?? null;
      return result;
    };
    return query;
  };
  return { db, selected, deps: { getSupabaseAdmin: () => db, getAuthenticatedSupabaseUser: async req => {
    if (req.get("authorization") !== "Bearer test-session") throw new SupabaseAuthenticationError();
    return { id: "actor", user_metadata: { role: "admin" } };
  } } };
}

test("only trusted database Admins can list, generate or revoke; JWT metadata/body roles cannot elevate", async t => {
  for (const role of ["teacher", "student", "general_user", "admin"]) {
    const f = fixture(role);
    const app = express(); app.use(express.json()); app.use("/invitations", createTeacherInvitationsRouter(f.deps));
    const server = app.listen(0, "127.0.0.1");
    t.after(() => new Promise(resolve => server.close(resolve)));
    await new Promise(resolve => server.once("listening", resolve));
    const base = `http://127.0.0.1:${server.address().port}/invitations`;
    for (const authenticated of [false, true]) {
      for (const [method, suffix] of [["GET", ""], ["POST", ""], ["POST", `/${randomUUID()}/revoke`]]) {
        const res = await fetch(base + suffix, { method, headers: {
          "Content-Type": "application/json", ...(authenticated ? { Authorization: "Bearer test-session" } : {}),
        }, ...(method === "POST" ? { body: JSON.stringify({ expiresAt: future(), role: "admin" }) } : {}) });
        assert.equal(res.headers.get("cache-control"), "no-store");
        assert.equal(res.status, !authenticated ? 401 : role !== "admin" ? 403 : suffix ? 404 : method === "POST" ? 201 : 200);
      }
    }
    assert.equal(f.db.tables.teacher_invite_codes.length, role === "admin" ? 1 : 0);
  }
});

test("secrets are random, SHA-256 hashed, returned only at creation; list/revoke expose only metadata", async () => {
  const f = fixture();
  const first = await createTeacherInvitation({ expiresAt: future() }, f.deps, REQ);
  const second = await createTeacherInvitation({ expiresAt: future(), maxUses: 3 }, f.deps, REQ);
  assert.match(first.code, /^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(first.code, second.code);
  assert.equal(first.invitation.maxUses, 1);
  assert.equal(second.invitation.maxUses, 3);
  const stored = f.db.tables.teacher_invite_codes[0];
  assert.equal(stored.code_hash, createHash("sha256").update(first.code, "utf8").digest("hex"));
  assert.ok(!JSON.stringify(f.db.tables).includes(first.code));
  const listed = await listTeacherInvitations(f.deps, REQ);
  const revoked = await revokeTeacherInvitation(first.invitation.id, f.deps, REQ);
  assert.equal(revoked.status, "revoked");
  assert.equal((await revokeTeacherInvitation(first.invitation.id, f.deps, REQ)).active, false);
  for (const output of [first.invitation, listed, revoked]) {
    assert.ok(!JSON.stringify(output).includes(stored.code_hash));
    assert.ok(!JSON.stringify(output).includes(first.code));
  }
  assert.ok(f.selected.filter(row => row.table === "teacher_invite_codes").every(row => !/code_hash|\*/.test(row.columns)));
});

test("validates dates/limits before writing, and does not expose database errors", async () => {
  const f = fixture();
  for (const body of [null, {}, { expiresAt: "bad" }, { expiresAt: new Date(0).toISOString() },
    ...[0, -1, 1.5, "2", 2147483648].map(maxUses => ({ expiresAt: future(), maxUses }))]) {
    await assert.rejects(createTeacherInvitation(body, f.deps, REQ), { statusCode: 400 });
  }
  assert.equal(f.db.tables.teacher_invite_codes.length, 0);
  await assert.rejects(revokeTeacherInvitation("bad", f.deps, REQ), { statusCode: 400 });
  await assert.rejects(revokeTeacherInvitation(randomUUID(), f.deps, REQ), { statusCode: 404 });
  const failing = { getSupabaseAdmin: () => ({ from: () => ({ insert() { return this; }, select() { return this; },
    single: async () => ({ error: { message: "PRIVATE_HASH_PROVIDER_DETAIL" } }),
  }) }) };
  await assert.rejects(createTeacherInvitation({ expiresAt: future() }, failing, REQ), error => {
    assert.doesNotMatch(error.message, /PRIVATE_HASH/);
    assert.match(error.message, /Refresh the list/); return true;
  });
});

test("F10: a code belongs to the creating School Admin's school; another school's codes are never listed or revocable", async () => {
  const f = fixture();
  const created = await createTeacherInvitation({ expiresAt: future() }, f.deps, REQ);
  assert.equal(f.db.tables.teacher_invite_codes[0].school_id, S1, "stored with the School Admin's school (from the database profile)");
  const otherId = randomUUID();
  f.db.tables.teacher_invite_codes.push({ id: otherId, active: true, created_at: new Date().toISOString(), expires_at: future(), max_uses: 1, use_count: 0, code_hash: "x", school_id: S2 });
  assert.deepEqual((await listTeacherInvitations(f.deps, REQ)).map((row) => row.id), [created.invitation.id]);
  await assert.rejects(revokeTeacherInvitation(otherId, f.deps, REQ), { statusCode: 404 });
  assert.equal(f.db.tables.teacher_invite_codes.find((row) => row.id === otherId).active, true, "another school's code is untouched");
  const other = { user: { id: "other" }, profile: { id: "other", role: "admin", school_id: S2 } };
  assert.deepEqual((await listTeacherInvitations(f.deps, other)).map((row) => row.id), [otherId]);
  await assert.rejects(createTeacherInvitation({ expiresAt: future() }, f.deps, { user: { id: "x" }, profile: { role: "admin", school_id: null } }), { statusCode: 403 });
});

test("list includes multiple pages and status handles legacy unlimited invitations", async () => {
  const f = fixture();
  for (let i = 0; i < 105; i++) f.db.tables.teacher_invite_codes.push({ id: randomUUID(), active: true,
    created_at: new Date().toISOString(), expires_at: null, max_uses: null, use_count: 100, code_hash: "private", school_id: S1 });
  const rows = await listTeacherInvitations(f.deps, REQ);
  assert.equal(rows.length, 105); assert.ok(rows.every(row => row.status === "active"));
  assert.equal(invitationMetadata({ active: true, expires_at: "2000-01-01", max_uses: 1, use_count: 0 }).status, "expired");
  assert.equal(invitationMetadata({ active: true, expires_at: null, max_uses: 1, use_count: 1 }).status, "exhausted");
  assert.equal(invitationMetadata({ active: false, expires_at: "2000-01-01", max_uses: 1, use_count: 1 }).status, "revoked");
});
