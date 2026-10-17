import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { test } from 'node:test';
import { MAP_H, MAP_W, SEG, monthPoints, pathD, sample, stepD } from '../web/src/components/mapa/caminho.ts';

test('mapa do ano: 12 meses da esquerda para a direita, cada um no seu trecho, caminho dentro do cenário', () => {
  const m = monthPoints();
  assert.equal(m.length, 12);
  m.forEach((p, i) => {
    assert.ok(p.x > i * SEG && p.x < (i + 1) * SEG, `mês ${i + 1} no seu trecho`);
    if (i) assert.ok(p.x > m[i - 1].x, 'ordem');
    assert.ok(p.y > 120 && p.y < MAP_H - 120, 'bolinha longe da borda');
  });
  for (const p of sample()) assert.ok(p.x >= 0 && p.x <= MAP_W && p.y > 60 && p.y < MAP_H - 60, `caminho fora do cenário em ${JSON.stringify(p)}`);
  assert.match(pathD(), /^M 0 \d+/);
  for (let i = 0; i < 11; i++) assert.match(stepD(i, i + 1), new RegExp(`^M ${m[i].x} ${m[i].y} C `));
  assert.throws(() => stepD(2, 5), /consecutivos/);
});

test('mapa do ano: cada tema de mês fica no próprio arquivo (temas/mes-MM.tsx), sem mexer em arquivo comum', () => {
  const files = readdirSync(new URL('../web/src/components/mapa/temas/', import.meta.url));
  for (const f of files) assert.match(f, /^mes-(0[1-9]|1[0-2])\.tsx$/, `arquivo de tema fora do padrão: ${f}`);
  assert.ok(files.includes('mes-10.tsx'), 'outubro (praia) no PR base');
});
