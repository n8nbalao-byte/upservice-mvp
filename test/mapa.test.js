import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { test } from 'node:test';
import { MAPA, MAPA_PROPORCAO, PERSONAGENS, PONTOS, fundoDoMes, imagemPersonagem } from '../web/src/components/mapa/jogo.ts';

const publico = (url) => new URL(`../web/public${url.split('?')[0]}`, import.meta.url);

test('mapa do ano: 12 pontos dentro do panorama, sem bolinhas sobrepostas', () => {
  assert.equal(PONTOS.length, 12);
  for (const p of PONTOS) assert.ok(p.x > 2 && p.x < 98 && p.y > 8 && p.y < 92, `ponto fora da imagem: ${JSON.stringify(p)}`);
  // Distância em "altura do mapa" (largura convertida pela proporção): as bolinhas têm ~12% da altura.
  for (let i = 0; i < 12; i++) for (let j = i + 1; j < 12; j++) {
    const dx = ((PONTOS[i].x - PONTOS[j].x) / 100) * MAPA_PROPORCAO;
    const dy = (PONTOS[i].y - PONTOS[j].y) / 100;
    assert.ok(Math.hypot(dx, dy) > 0.12, `meses ${i + 1} e ${j + 1} muito perto`);
  }
  assert.ok(Math.abs(MAPA_PROPORCAO - 2688 / 1152) < 1e-9);
});

test('imagens do jogo: panorama, os 12 fundos de mês e os personagens existem no projeto', () => {
  assert.ok(existsSync(publico(MAPA.src)) && existsSync(publico(MAPA.srcPequeno)), 'panorama');
  for (let m = 1; m <= 12; m++) assert.ok(existsSync(publico(fundoDoMes(m))), `fundo do mês ${m}`);
  assert.equal(PERSONAGENS.length, 5);
  for (const p of PERSONAGENS) assert.ok(existsSync(publico(imagemPersonagem(p.id))), `personagem ${p.id}`);
  assert.match(imagemPersonagem('inexistente'), /guerreiro/, 'personagem desconhecido usa o primeiro');
});
