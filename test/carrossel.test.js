import assert from 'node:assert/strict';
import { test } from 'node:test';
import { alternar } from '../web/src/lib/carrossel.ts';

const fotos = (p, l) => [...Array.from({ length: p }, (_, i) => ({ tipo: 'PROFISSIONAL', id: `p${i}` })), ...Array.from({ length: l }, (_, i) => ({ tipo: 'LOJA', id: `l${i}` }))];
const seguidas = (lista) => lista.slice(1).filter((f, i) => f.tipo === lista[i].tipo).length;

test('carrossel do login: alterna profissional e loja, embaralhado, sem perder nem repetir foto', () => {
  for (const [p, l] of [[5, 4], [4, 5], [3, 3], [6, 2], [0, 3], [2, 0], [0, 0]]) {
    for (let k = 0; k < 20; k++) {
      const out = alternar(fotos(p, l));
      assert.equal(out.length, p + l);
      assert.equal(new Set(out.map((f) => f.id)).size, p + l, 'cada foto uma vez');
      // Só sobra foto igual seguida quando um grupo é maior que o outro + 1.
      assert.equal(seguidas(out), Math.max(0, Math.abs(p - l) - 1), `${p}×${l}: ${out.map((f) => f.tipo[0]).join('')}`);
    }
  }
  // Embaralha de verdade: em 30 aberturas, a primeira foto muda.
  assert.ok(new Set(Array.from({ length: 30 }, () => alternar(fotos(5, 4))[0].id)).size > 1);
});
