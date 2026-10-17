import assert from 'node:assert/strict';
import { test } from 'node:test';
import { byNearThenSoon, checkinWindowError, csvCell, distanceBand, distanceMeters, exceptionWindowError, isStrike, isValidCpf, nextState, transitionError, workedTime } from '../server/rules.js';

test('distância: 0,0027° de latitude ≈ 300 m', () => {
  const d = distanceMeters({ lat: -23.55, lng: -46.63 }, { lat: -23.5527, lng: -46.63 });
  assert.ok(Math.abs(d - 300) < 2, `obtido ${d}`);
});

test('janela de check-in: 15 min antes até 15 min depois', () => {
  const start = new Date('2026-10-14T11:00:00Z');
  const at = (min) => new Date(start.getTime() + min * 60000);
  assert.match(checkinWindowError(start, at(-20)), /15 minutos antes/, '20 min antes ainda não');
  assert.match(checkinWindowError(start, at(-16)), /15 minutos antes/);
  assert.equal(checkinWindowError(start, at(-15)), null);
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
  assert.match(exceptionWindowError('CHECK_IN', start, end, at(-16)), /15 minutos antes/);
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

test('diária automática só quando as horas cobrem a jornada (30 min de folga)', async () => {
  const { coversShift } = await import('../server/rules.js');
  const job = { starts_at: '2026-10-20T11:00:00Z', ends_at: '2026-10-20T19:00:00Z', break_count: 1, break_minutes: 15 };
  assert.equal(coversShift(465, job), true, 'jornada inteira');
  assert.equal(coversShift(436, job), true, 'dentro da folga');
  assert.equal(coversShift(434, job), false, 'saiu mais cedo');
  assert.equal(coversShift(2, job), false, 'check-in e checkout em seguida');
});

test('lista de vagas: primeiro as mais perto (por faixa) e, na mesma faixa, a que começa antes', () => {
  const h = (n) => new Date(Date.UTC(2026, 9, 20, n)).toISOString();
  const jobs = [
    { id: 'perto-depois', distance_m: 1200, starts_at: h(20) },
    { id: 'perto-antes', distance_m: 1900, starts_at: h(9) },
    { id: 'longe-hoje', distance_m: 30000, starts_at: h(8) },
    { id: 'medio', distance_m: 4000, starts_at: h(7) },
    { id: 'muito-longe', distance_m: 90000, starts_at: h(6) },
  ];
  assert.deepEqual(jobs.sort(byNearThenSoon).map((j) => j.id), ['perto-antes', 'perto-depois', 'medio', 'longe-hoje', 'muito-longe']);
  assert.deepEqual([distanceBand(2000), distanceBand(2001), distanceBand(50000), distanceBand(50001), distanceBand(null)], [1, 2, 5, 6, 0]);
});

test('Pix: CRC do exemplo do Banco Central e validação das chaves', async () => {
  const { brCode, crc16, normalizePixKey } = await import('../server/pix.js');
  assert.equal(crc16('00020126580014br.gov.bcb.pix0136123e4567-e12b-12d1-a456-4266554400005204000053039865802BR5913Fulano de Tal6008BRASILIA62070503***6304'), '1D3D');
  const code = brCode({ key: '+5511955554444', amount: 150.5, name: 'José da Silva Ação', city: 'São Paulo' });
  assert.match(code, /5406150\.50/);
  assert.match(code, /5918JOSE DA SILVA ACAO/);
  assert.equal(code.slice(-4), crc16(code.slice(0, -4)));
  assert.equal(normalizePixKey('TELEFONE', '(11) 95555-4444'), '+5511955554444');
  assert.equal(normalizePixKey('TELEFONE', '5511955554444'), '+5511955554444');
  assert.equal(normalizePixKey('CPF', '529.982.247-25'), '52998224725');
  assert.equal(normalizePixKey('CPF', '111.111.111-11'), null);
  assert.equal(normalizePixKey('EMAIL', ' Ana@Exemplo.com '), 'ana@exemplo.com');
  assert.equal(normalizePixKey('ALEATORIA', '123E4567-E12B-12D1-A456-426655440000'), '123e4567-e12b-12d1-a456-426655440000');
  assert.equal(normalizePixKey('ALEATORIA', 'abc'), null);
});
