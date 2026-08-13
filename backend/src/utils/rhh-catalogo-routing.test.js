const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const jwt = require('jsonwebtoken');

const catalogRouter = require('../routes/rhh-catalogo');
const seed = require('../../../database/rhh.json');

async function withServer(run) {
  const app = express();
  app.use(express.json());
  app.use('/api/rhh/catalogo', catalogRouter);
  const server = await new Promise(resolve => {
    const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
  });
  try {
    const { port } = server.address();
    await run(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
}

function adminToken() {
  const admin = seed.rhh_users.find(user => user.role === 'admin' && user.active !== false);
  assert.ok(admin, 'seed must contain an active RHH admin');
  return jwt.sign(
    { sub: admin.id, module: 'rhh', role: admin.role },
    process.env.JWT_SECRET || 'cambia-esta-clave',
    { expiresIn: '2m' }
  );
}

test('diagnostic endpoint requires an authenticated admin and hides filesystem paths', async () => {
  await withServer(async baseUrl => {
    const unauthorized = await fetch(`${baseUrl}/api/rhh/catalogo/diag`);
    assert.equal(unauthorized.status, 401);

    const authorized = await fetch(`${baseUrl}/api/rhh/catalogo/diag`, {
      headers: { authorization: `Bearer ${adminToken()}` },
    });
    assert.equal(authorized.status, 200);
    const body = await authorized.json();
    assert.equal(typeof body.totalEmpleados, 'number');
    assert.equal(Object.hasOwn(body, 'seedPath'), false);
    assert.equal(Object.hasOwn(body, 'dbPath'), false);
  });
});

test('specific lft-rules route is reachable after the dynamic employee route', async () => {
  await withServer(async baseUrl => {
    const response = await fetch(`${baseUrl}/api/rhh/catalogo/lft-rules`, {
      headers: { authorization: `Bearer ${adminToken()}` },
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.ok(Array.isArray(body));
    assert.ok(body.some(rule => rule.years === 1 && rule.dias === 12));
  });
});

test('force-seed stays disabled when the production secret is not configured', async () => {
  const previous = process.env.RHH_SEED_KEY;
  delete process.env.RHH_SEED_KEY;
  try {
    await withServer(async baseUrl => {
      const response = await fetch(`${baseUrl}/api/rhh/catalogo/force-seed`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${adminToken()}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ key: 'anything' }),
      });
      assert.equal(response.status, 503);
    });
  } finally {
    if (previous === undefined) delete process.env.RHH_SEED_KEY;
    else process.env.RHH_SEED_KEY = previous;
  }
});
