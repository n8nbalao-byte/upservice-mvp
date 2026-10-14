import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';

// O LiteSpeed da Hostinger carrega o app com require(): nenhum módulo do grafo do servidor pode ter await no topo
// (ERR_REQUIRE_ASYNC_MODULE derrubou a produção em 14/10/2026).
test('app sobe via require(), como no servidor da Hostinger', () => {
  const r = spawnSync(process.execPath, ['-e', "require('./server.js'); setTimeout(() => process.exit(0), 300)"], {
    env: { ...process.env, PORT: '0', NODE_ENV: 'test' },
    encoding: 'utf8',
  });
  assert.equal(r.status, 0, r.stderr);
});
