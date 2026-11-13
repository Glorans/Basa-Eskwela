// CORS preflight caching: allowed preflights may be reused for 10 minutes. Everything else about CORS is
// unchanged: the same allowed origins, methods and request headers, no credentials, and a disallowed origin
// still gets no Access-Control-Allow-Origin. Local requests only.
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.FRONTEND_ORIGIN = 'https://basa-eskwela-frontend.onrender.com,http://127.0.0.1:5174';
const { app } = require('../server');

async function withServer(run) {
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  try { await run(`http://127.0.0.1:${server.address().port}`); } finally { await new Promise((resolve) => server.close(resolve)); }
}
const preflight = (base, origin, method, headers) => fetch(`${base}/api/analytics/personal`, {
  method: 'OPTIONS', headers: { Origin: origin, 'Access-Control-Request-Method': method, 'Access-Control-Request-Headers': headers },
});

test('allowed origins: the preflight is cacheable for 10 minutes and otherwise unchanged', async () => {
  await withServer(async (base) => {
    for (const origin of ['https://basa-eskwela-frontend.onrender.com', 'http://127.0.0.1:5174']) {
      for (const [method, headers] of [['GET', 'authorization'], ['POST', 'authorization,content-type']]) {
        const res = await preflight(base, origin, method, headers);
        assert.equal(res.status, 204);
        assert.equal(res.headers.get('access-control-max-age'), '600');
        assert.equal(res.headers.get('access-control-allow-origin'), origin);
        assert.equal(res.headers.get('access-control-allow-methods'), 'GET,HEAD,PUT,PATCH,POST,DELETE');
        assert.equal(res.headers.get('access-control-allow-headers'), headers);
        assert.equal(res.headers.get('access-control-allow-credentials'), null);
      }
    }
  });
});

test('a disallowed origin is still refused; ordinary responses carry no max-age', async () => {
  await withServer(async (base) => {
    const refused = await preflight(base, 'https://not-allowed.example', 'GET', 'authorization');
    assert.equal(refused.headers.get('access-control-allow-origin'), null);
    const health = await fetch(`${base}/api/health`, { headers: { Origin: 'https://basa-eskwela-frontend.onrender.com' } });
    assert.equal(health.status, 200);
    assert.equal(health.headers.get('access-control-allow-origin'), 'https://basa-eskwela-frontend.onrender.com');
    assert.equal(health.headers.get('access-control-max-age'), null);
  });
});
