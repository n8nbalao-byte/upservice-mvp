import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildMonth, diaryReport, diaryStars, planBonuses, sorteioStatus } from '../server/estrelas.js';

const ended = '2026-10-01T20:00:00Z';
const now = Date.parse('2026-10-15T12:00:00Z');

test('estrelas da diária: 3 certinho, 2 mancada pequena, 1 mancada maior, 0 falta', () => {
  assert.deepEqual(diaryStars({ result: 'CONCLUIDA', endsAt: ended, validations: ['GPS_VALIDADO'] }, now), { state: 'feita', stars: 3 });
  assert.equal(diaryStars({ result: 'CONCLUIDA', endsAt: ended, validations: ['GPS_VALIDADO', 'EXCECAO_APROVADA'] }, now).stars, 2);
  assert.equal(diaryStars({ result: 'CONCLUIDA', endsAt: ended, occurrences: ['PAUSA_EXCEDIDA'] }, now).stars, 2);
  assert.equal(diaryStars({ result: 'CONCLUIDA', endsAt: ended, validations: ['FECHAMENTO_ADMINISTRATIVO'] }, now).stars, 1);
  assert.equal(diaryStars({ result: 'CONCLUIDA', endsAt: ended, occurrences: ['ABANDONO'] }, now).stars, 1);
  assert.equal(diaryStars({ result: 'NAO_COMPARECEU', endsAt: ended }, now).stars, 0);
  assert.equal(diaryStars({ sessionStatus: 'AGUARDANDO_CHECKIN', endsAt: ended, occurrences: ['FALTA'] }, now).stars, 0);
});

test('diárias que ainda não valem: próxima, em andamento e em análise', () => {
  assert.equal(diaryStars({ sessionStatus: 'AGUARDANDO_CHECKIN', endsAt: '2026-10-20T20:00:00Z' }, now).state, 'proxima');
  assert.equal(diaryStars({ sessionStatus: 'EM_ATIVIDADE', endsAt: '2026-10-15T20:00:00Z' }, now).state, 'hoje');
  assert.equal(diaryStars({ sessionStatus: 'PENDENTE_DE_FECHAMENTO', endsAt: ended }, now).state, 'em_analise');
});

test('mês = nível: todas as fases (dias), máximo de 3 estrelas por dia e bônus só revelado no dia', () => {
  const m = buildMonth('2026-10', [{ day: 3, stars: 3, state: 'feita' }, { day: 7, stars: 2, state: 'feita' }, { day: 25, stars: null, state: 'proxima' }],
    [{ day: '2026-10-03', kind: 'BONUS', value: '10.00' }, { day: '2026-10-07', kind: 'BONUS', value: '20.00' }, { day: '2026-10-25', kind: 'BONUS', value: '70.00' }], '2026-10-15');
  assert.equal(m.level, 10);
  assert.equal(m.days.length, 31);
  assert.equal(m.maxStars, 93);
  assert.equal(m.stars, 5);
  assert.deepEqual(m.days[2].bonus, { kind: 'BONUS', label: null, value: 10, revealed: true, earned: true });
  assert.equal(m.days[6].bonus.earned, false, '2 estrelas não ganham o bônus');
  assert.equal(m.days[24].bonus.value, null, 'valor do dia futuro não vai');
  assert.equal(m.bonusGanho, 10);
  assert.equal(m.done, false);
  assert.equal(buildMonth('2026-09', [], [], '2026-10-15').done, true);
  assert.equal(buildMonth('2026-11', []).days.length, 30);
});

test('bônus do mês: soma exata do valor definido, valores crescentes, fora do dia do sorteio', () => {
  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (const total of [100, 250, 37.5, 15, 12, 5, 1000]) {
    for (let i = 0; i < 30; i++) {
      const plan = planBonuses('2026-12', total, ['2026-12-20'], rand);
      const sum = plan.reduce((s, b) => s + Math.round(b.value * 100), 0);
      assert.equal(sum, Math.round(total * 100), `soma ${total}`);
      assert.ok(plan.length >= 1 && plan.length <= 5);
      assert.ok(plan.every((b, j) => j === 0 || (b.value > plan[j - 1].value && b.day > plan[j - 1].day)), `crescente ${JSON.stringify(plan)}`);
      assert.ok(!plan.some((b) => b.day === '2026-12-20'));
    }
  }
  assert.equal(planBonuses('2026-12', 12).length, 1, 'valor pequeno: um dia só');
  assert.deepEqual(planBonuses('2026-12', 0), []);
});

test('sorteio: 15 dias com 3 estrelas no ano e o dia do sorteio com 3 estrelas', () => {
  const days = (n) => Array.from({ length: n }, (_, i) => ({ date: `2026-11-${String(i + 1).padStart(2, '0')}`, stars: 3 }));
  const dia = { date: '2026-12-20', stars: 3 };
  assert.equal(sorteioStatus([...days(14), dia], '2026-12-20').qualifies, true, '14 + o dia = 15');
  assert.equal(sorteioStatus([...days(13), dia], '2026-12-20').qualifies, false);
  assert.equal(sorteioStatus(days(20), '2026-12-20').qualifies, false, 'sem o dia do sorteio');
  assert.equal(sorteioStatus([...days(20), { ...dia, stars: 2 }], '2026-12-20').qualifies, false);
  const dup = sorteioStatus([...days(3), ...days(3), { date: '2025-11-01', stars: 3 }], '2026-12-20');
  assert.equal(dup.threeStarDays, 3, 'conta dias, não diárias; só o ano do sorteio');
});

test('resumo do dia (sem horários): o que deu certo, o que pesou e como ganhar mais estrelas', () => {
  const perfeito = diaryReport({ stars: 3, steps: { CHECK_IN: 'GPS_VALIDADO', PAUSE_START: 'GPS_VALIDADO', PAUSE_END: 'GPS_VALIDADO', CHECK_OUT: 'GPS_VALIDADO' } });
  assert.equal(perfeito.items.length, 4);
  assert.ok(perfeito.items.every((i) => i.tone === 'ok'));
  assert.match(perfeito.tips[0], /Perfeito/);
  const excecao = diaryReport({ stars: 2, steps: { CHECK_IN: 'EXCECAO_APROVADA', CHECK_OUT: 'GPS_VALIDADO' }, occurrences: ['PAUSA_EXCEDIDA'] });
  assert.deepEqual(excecao.items.map((i) => i.tone), ['warn', 'ok', 'warn']);
  assert.equal(excecao.tips.length, 2);
  const esqueceu = diaryReport({ stars: 1, steps: { CHECK_IN: 'GPS_VALIDADO', CHECK_OUT: 'FECHAMENTO_ADMINISTRATIVO' } });
  assert.equal(esqueceu.items[1].tone, 'bad');
  assert.match(esqueceu.tips[0], /checkout/);
  assert.match(diaryReport({ stars: 0 }).tips[0], /desista pelo app/);
  for (const r of [perfeito, excecao, esqueceu]) assert.ok(!JSON.stringify(r).match(/\d{1,2}:\d{2}/), 'sem horários');
});
