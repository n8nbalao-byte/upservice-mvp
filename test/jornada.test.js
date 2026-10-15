// Relógio e barras da jornada (web/src/lib/jornada.js): fases, % total, pausa sugerida e contagens.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { hms, jornadaStatus, minutesLeft } from '../web/src/lib/jornada.js';

const H = 3600e3;
const base = Date.UTC(2026, 10, 3, 11); // 08:00 em São Paulo
const job = (o = {}) => ({ status: 'EM_ATIVIDADE', starts_at: new Date(base).toISOString(), ends_at: new Date(base + 8 * H).toISOString(), break_count: 1, break_minutes: 15, breaks_used: 0, break_ends_at: null, ...o });
const ev = (type, at) => ({ type, occurred_at: new Date(at).toISOString() });

test('antes do check-in: contagem para começar', () => {
  const j = jornadaStatus(job({ status: 'AGUARDANDO_CHECKIN' }), [], base - 10 * 60e3);
  assert.equal(j.phase, 'antes');
  assert.equal(j.clock.label, 'Para começar');
  assert.equal(j.clock.ms, 10 * 60e3);
  assert.equal(j.part, null);
});

test('trabalhando: % total e pausa sugerida na metade (1 pausa)', () => {
  const j = jornadaStatus(job(), [ev('CHECK_IN', base)], base + 2 * H);
  assert.equal(j.phase, 'trabalhando');
  assert.equal(j.total, 25);
  assert.equal(j.clock.ms, 6 * H);
  assert.equal(j.part.label, 'Até a pausa');
  assert.equal(j.part.pct, 50, 'pausa sugerida às 4 h; passadas 2 h');
  assert.equal(j.part.msLeft, 2 * H);
  assert.equal(j.part.ready, false);
  assert.equal(jornadaStatus(job(), [ev('CHECK_IN', base)], base + 4 * H + 1).part.ready, true, 'já pode pausar');
});

test('2 pausas: sugeridas em 1/3 e 2/3; depois da 1ª, conta a partir do retorno', () => {
  const s = job({ break_count: 2 });
  assert.equal(jornadaStatus(s, [ev('CHECK_IN', base)], base).part.msLeft, (8 * H) / 3);
  const after = jornadaStatus({ ...s, breaks_used: 1 }, [ev('CHECK_IN', base), ev('PAUSE_START', base + 3 * H), ev('PAUSE_END', base + 3.25 * H)], base + 4 * H);
  assert.equal(after.part.msLeft, (16 * H) / 3 - 4 * H);
});

test('em pausa: tempo restante e "passou do tempo"', () => {
  const evs = [ev('CHECK_IN', base), ev('PAUSE_START', base + 4 * H)];
  const s = job({ status: 'EM_PAUSA', breaks_used: 1, break_ends_at: new Date(base + 4 * H + 15 * 60e3).toISOString() });
  const j = jornadaStatus(s, evs, base + 4 * H + 5 * 60e3);
  assert.equal(j.phase, 'pausa');
  assert.equal(j.part.label, 'Pausa');
  assert.equal(j.part.pct, 33);
  assert.equal(j.clock.ms, 10 * 60e3);
  const late = jornadaStatus({ ...s, status: 'PAUSA_EXCEDIDA' }, evs, base + 4 * H + 20 * 60e3);
  assert.match(late.clock.label, /passou do tempo/);
  assert.equal(late.part.pct, 100);
});

test('sem pausa sobrando: barra até o fim; checkout encerra', () => {
  const evs = [ev('CHECK_IN', base), ev('PAUSE_START', base + 4 * H), ev('PAUSE_END', base + 4.25 * H)];
  const j = jornadaStatus(job({ breaks_used: 1 }), evs, base + 6 * H);
  assert.equal(j.part.label, 'Até o fim');
  assert.equal(j.part.msLeft, 2 * H);
  assert.equal(jornadaStatus(job({ status: 'FINALIZADA' }), [...evs, ev('CHECK_OUT', base + 8 * H)], base + 8 * H).phase, 'fim');
});

test('formatos do relógio', () => {
  assert.equal(hms(2 * H + 5 * 60e3 + 9000), '02:05:09');
  assert.equal(hms(-190e3), '-00:03:10');
  assert.equal(minutesLeft(80 * 60e3), '1 h 20 min');
  assert.equal(minutesLeft(35 * 60e3), '35 min');
  assert.equal(minutesLeft(10e3), '1 min');
  assert.equal(minutesLeft(0), 'menos de 1 min');
});
