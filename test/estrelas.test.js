import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildMonth, diaryStars, levelOf } from '../server/estrelas.js';

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

test('mês: bônus abrem com as estrelas; mês perfeito só sem falta e com tudo feito', () => {
  const d = (stars, state = 'feita') => ({ stars, state });
  const m = buildMonth('2026-10', [d(3), d(3), d(2), d(3), d(1), d(3), d(3), d(3), d(3), d(3)]);
  assert.equal(m.maxStars, 30);
  assert.equal(m.stars, 27);
  assert.deepEqual(m.bonuses.map((b) => [b.goal, b.unlocked]), [[9, true], [17, true], [24, true]]);
  assert.equal(m.perfect.unlocked, true);
  const faltou = buildMonth('2026-10', [d(3), d(0), d(3), d(null, 'proxima')]);
  assert.equal(faltou.perfect.unlocked, false);
  assert.equal(faltou.perfect.lost, true);
  assert.deepEqual(levelOf(64), { level: 3, inLevel: 4, perLevel: 30 });
  // Todos os dias do mês aparecem como fases; dia sem diária fica vazio.
  const nov = buildMonth('2026-11', [{ day: 3, stars: 3, state: 'feita' }, { day: 20, stars: null, state: 'proxima' }]);
  assert.equal(nov.days.length, 30);
  assert.deepEqual(nov.days.filter((d) => d.diaries.length).map((d) => d.day), [3, 20]);
  assert.equal(buildMonth('2026-10', []).days.length, 31);
  assert.deepEqual(nov.bonuses.map((b) => b.afterDay), [9, 17, 24]);
});
