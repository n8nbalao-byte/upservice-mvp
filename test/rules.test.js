import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkinWindowError, csvCell, distanceMeters, exceptionWindowError, isStrike, isValidCpf, nextState, transitionError, workedTime } from '../server/rules.js';

test('distância: 0,0027° de latitude ≈ 300 m', () => {
  const d = distanceMeters({ lat: -23.55, lng: -46.63 }, { lat: -23.5527, lng: -46.63 });
  assert.ok(Math.abs(d - 300) < 2, `obtido ${d}`);
});

test('janela de check-in: 2 h antes até 15 min depois', () => {
  const start = new Date('2026-10-14T11:00:00Z');
  const at = (min) => new Date(start.getTime() + min * 60000);
  assert.match(checkinWindowError(start, at(-121)), /2 horas/);
  assert.equal(checkinWindowError(start, at(-120)), null);
  assert.equal(checkinWindowError(start, at(15)), null);
  assert.match(checkinWindowError(start, at(16)), /15 minutos/);
});

test('máquina de estados da jornada', () => {
  const ctx = { breaksUsed: 0, breakCount: 1 };
  assert.equal(nextState('AGUARDANDO_CHECKIN', 'CHECK_IN', ctx), 'EM_ATIVIDADE');
  assert.equal(nextState('AGUARDANDO_CHECKIN', 'CHECK_OUT', ctx), null);
  assert.equal(nextState('EM_ATIVIDADE', 'PAUSE_START', ctx), 'EM_PAUSA');
  assert.equal(nextState('EM_ATIVIDADE', 'PAUSE_START', { breaksUsed: 1, breakCount: 1 }), null);
  assert.equal(nextState('EM_PAUSA', 'CHECK_OUT', ctx), null, 'checkout em pausa é bloqueado');
  assert.equal(nextState('PAUSA_EXCEDIDA', 'CHECK_OUT', ctx), null);
  assert.equal(nextState('PAUSA_EXCEDIDA', 'PAUSE_END', ctx), 'EM_ATIVIDADE');
  assert.equal(nextState('EM_ATIVIDADE', 'CHECK_OUT', ctx), 'FINALIZADA');
  assert.equal(nextState('FINALIZADA', 'CHECK_IN', ctx), null);
  assert.match(transitionError('EM_PAUSA', 'CHECK_OUT', ctx), /retorno da pausa/);
  assert.match(transitionError('EM_ATIVIDADE', 'PAUSE_START', { breaksUsed: 3, breakCount: 3 }), /Limite/);
});

test('horas = checkout - checkin - pausas; incompleta = null', () => {
  const ev = (type, hhmm) => ({ type, occurred_at: `2026-10-14T${hhmm}:00Z` });
  const events = [ev('CHECK_IN', '08:00'), ev('PAUSE_START', '10:00'), ev('PAUSE_END', '10:15'), ev('PAUSE_START', '12:00'), ev('PAUSE_END', '12:30'), ev('CHECK_OUT', '17:00')];
  assert.deepEqual(workedTime(events), { workedMin: 8 * 60 + 15, breakMin: 45, sources: ['GPS_VALIDADO'] });
  assert.equal(workedTime(events.slice(0, 3)), null);
});

test('horas: pausa aberta no fechamento administrativo conta como pausa; origens listadas', () => {
  const events = [
    { type: 'CHECK_IN', occurred_at: '2026-10-14T08:00:00Z', validation: 'EXCECAO_APROVADA' },
    { type: 'PAUSE_START', occurred_at: '2026-10-14T12:00:00Z', validation: 'GPS_VALIDADO' },
    { type: 'CHECK_OUT', occurred_at: '2026-10-14T13:00:00Z', validation: 'FECHAMENTO_ADMINISTRATIVO' },
  ];
  assert.deepEqual(workedTime(events), { workedMin: 4 * 60, breakMin: 60, sources: ['EXCECAO_APROVADA', 'GPS_VALIDADO', 'FECHAMENTO_ADMINISTRATIVO'] });
});

test('exceção de check-in: nunca para chegar cedo; atraso aceito até o término', () => {
  const start = new Date('2026-10-14T11:00:00Z');
  const end = new Date('2026-10-14T20:00:00Z');
  const at = (min) => new Date(start.getTime() + min * 60000);
  assert.match(exceptionWindowError('CHECK_IN', start, end, at(-121)), /2 horas/);
  assert.equal(exceptionWindowError('CHECK_IN', start, end, at(60)), null, 'atrasado 1 h ainda pode pedir');
  assert.match(exceptionWindowError('CHECK_IN', start, end, at(9 * 60 + 1)), /terminou/);
  assert.equal(exceptionWindowError('CHECK_OUT', start, end, at(-500)), null, 'janela só vale para check-in');
  assert.match(transitionError('PENDENTE_DE_EXCECAO', 'CHECK_OUT'), /exceção/);
});

test('só falta confirmada e ainda não usada num bloqueio conta para as 3 faltas', () => {
  assert.ok(isStrike({ type: 'FALTA', status: 'CONFIRMADA', penalty_id: null }));
  assert.ok(!isStrike({ type: 'FALTA', status: 'PENDENTE', penalty_id: null }));
  assert.ok(!isStrike({ type: 'FALTA', status: 'CANCELADA', penalty_id: null }));
  assert.ok(!isStrike({ type: 'FALTA', status: 'CONFIRMADA', penalty_id: 'p1' }), 'contagem recomeça depois do bloqueio');
  assert.ok(!isStrike({ type: 'PAUSA_EXCEDIDA', status: 'CONFIRMADA', penalty_id: null }));
});

test('CSV: aspas, separador e fórmulas neutralizadas', () => {
  assert.equal(csvCell('Loja A'), '"Loja A"');
  assert.equal(csvCell('a;b'), '"a;b"');
  assert.equal(csvCell('diz "oi"'), '"diz ""oi"""');
  assert.equal(csvCell('=HYPERLINK("x")'), '"\'=HYPERLINK(""x"")"');
  assert.equal(csvCell('+5'), '"\'+5"');
  assert.equal(csvCell('@SUM(A1)'), '"\'@SUM(A1)"');
  assert.equal(csvCell(null), '""');
  assert.equal(csvCell(150.5), '"150.5"');
});

test('CPF', () => {
  assert.ok(isValidCpf('529.982.247-25'));
  assert.ok(!isValidCpf('529.982.247-24'));
  assert.ok(!isValidCpf('111.111.111-11'));
  assert.ok(!isValidCpf('123'));
});
