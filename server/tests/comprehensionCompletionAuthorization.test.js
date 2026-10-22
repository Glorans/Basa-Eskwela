// Real HTTP route/services + actual M6/C9 SQL. Only authentication transport and
// PostgREST transport are replaced with local adapters. No Supabase or cloud API.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const express = require('express');
const { sqlFile } = require('./fixtures/m5M6SecurityDatabase');
const { createM8TrustDatabase, completeAttempt, USERS, MODULE, ROOM, ROOM_MODULE } = require('./fixtures/m8TrustDatabase');
const { SupabaseAuthenticationError } = require('../services/supabaseAdmin');

function localRouter(db, calls) {
  class Query {
    constructor(table) { this.table = table; this.filters = []; this.args = []; }
    select() { return this; }
    eq(column, value) { this.args.push(value); this.filters.push(`${column}=$${this.args.length}`); return this; }
    maybeSingle() { this.one = true; return this; }
    single() { this.one = true; return this; }
    then(resolve, reject) {
      calls.push(this.table);
      return db.query(`select * from public.${this.table}${this.filters.length ? ' where ' + this.filters.join(' and ') : ''}`, this.args)
        .then(({ rows }) => ({ data: this.one ? rows[0] ?? null : rows, error: null })).then(resolve, reject);
    }
  }
  const admin = {
    from: table => new Query(table),
    async rpc(name, args) {
      assert.equal(name, 'm6_apply_action');
      calls.push('rpc');
      await db.exec('set role service_role');
      try {
        const result = await db.query('select public.m6_apply_action($1,$2,$3,$4,$5,$6) as result',
          [args.target_attempt, args.target_user, args.target_question, args.action_name, args.selected_option, args.request_id]);
        return { data: result.rows[0].result, error: null };
      } catch (error) { return { data: null, error }; }
      finally { await db.exec('reset role'); }
    },
  };
  const auth = { ...require('../services/supabaseAdmin'), getSupabaseAdmin: () => admin,
    getAuthenticatedSupabaseUser: async req => {
      if (!req.headers.authorization) throw new SupabaseAuthenticationError();
      return { id: req.headers.authorization.replace('Bearer ', '') };
    } };
  const directory = path.resolve(__dirname, '..');
  const isolated = new Set(['routes/comprehension.js', 'services/comprehensionAttemptService.js',
    'services/comprehensionActionService.js', 'services/oralReadingAttemptService.js'].map(p => path.join(directory, p)));
  const cache = new Map();
  function load(file) {
    if (cache.has(file)) return cache.get(file).exports;
    const module = { exports: {} }; cache.set(file, module);
    const nativeRequire = createRequire(file);
    const requireLocal = name => {
      const resolved = nativeRequire.resolve(name);
      if (resolved === path.join(directory, 'services/supabaseAdmin.js')) return auth;
      if (resolved === path.join(directory, 'services/m7RiskWorker.js')) return { isRiskWorkerEnabled: () => false };
      return isolated.has(resolved) ? load(resolved) : nativeRequire(name);
    };
    vm.runInThisContext(`(function(require,module,exports){${fs.readFileSync(file, 'utf8')}\n})`, { filename: file })
      (requireLocal, module, module.exports);
    return module.exports;
  }
  return load(path.join(directory, 'routes/comprehension.js'));
}

test('HTTP completion enforces identity, current access and real database completion', { timeout: 120000 }, async t => {
  const db = await createM8TrustDatabase();
  t.after(() => db.close());
  await db.exec(sqlFile('supabase/migrations/20261026_m8_trusted_xp.sql'));
  const calls = [];
  const app = express(); app.use(express.json()); app.use('/api/comprehension', localRouter(db, calls));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const post = async (attempt, user) => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/comprehension/attempts/${attempt}/actions`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...(user ? { Authorization: `Bearer ${user}` } : {}) },
      body: JSON.stringify({ action: 'complete' }),
    });
    return { status: response.status, body: await response.json() };
  };
  const attempt = await completeAttempt(db, { user: USERS.student2, module: MODULE.enMedium,
    room: ROOM, assignment: ROOM_MODULE.enMedium, startOnly: true });
  await t.test('signed out, non-learner and another owner never reach the completion RPC', async () => {
    for (const [user, expected] of [[null, 401], [USERS.admin, 403], [USERS.teacher, 403], [USERS.general, 404]]) {
      calls.length = 0;
      assert.equal((await post(attempt, user)).status, expected);
      assert.ok(!calls.includes('rpc'));
    }
  });
  await t.test('revoked enrollment returns HTTP 403 and leaves the attempt incomplete', async () => {
    await db.query('delete from enrollments where student_id=$1 and room_id=$2', [USERS.student2, ROOM]);
    const result = await post(attempt, USERS.student2);
    assert.equal(result.status, 403);
    assert.match(result.body.message, /revoked or is not authorized/);
    assert.equal((await db.query('select status from m6_comprehension_attempts where id=$1', [attempt])).rows[0].status, 'in_progress');
    await db.query('insert into enrollments(room_id,student_id) values ($1,$2)', [ROOM, USERS.student2]);
  });
  await t.test('authorized owner completes; repeated HTTP submission cannot duplicate XP', async () => {
    for (let n = 0; n < 2; n++) {
      const result = await post(attempt, USERS.student2);
      assert.equal(result.status, 200); assert.equal(result.body.attempt.status, 'completed');
    }
    assert.deepEqual((await db.query('select xp_earned from m8_xp_events where user_id=$1', [USERS.student2])).rows, [{ xp_earned: 50 }]);
  });
  await t.test('independent owner without a trusted diagnostic saves through HTTP without XP and is queued', async () => {
    const independent = await completeAttempt(db, { user: USERS.generalNoDiagnostic, module: MODULE.enHard, startOnly: true });
    assert.equal((await post(independent, USERS.generalNoDiagnostic)).status, 200);
    assert.deepEqual((await db.query('select * from m8_xp_events where user_id=$1', [USERS.generalNoDiagnostic])).rows, []);
    assert.equal((await db.query('select * from m7_risk_queue where id=$1', [USERS.generalNoDiagnostic])).rows.length, 1);
  });
});
