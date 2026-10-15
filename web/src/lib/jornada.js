// Situação da jornada do profissional para o relógio e as barras da tela "Minhas diárias".
// Puro (sem React) para rodar também nos testes do Node. Tempos em ms; `now` vem do relógio do servidor.

const t = (v) => new Date(v).getTime();
const clamp = (n) => Math.max(0, Math.min(100, Math.round(n)));
const pct = (from, to, now) => (to <= from ? 100 : clamp(((now - from) / (to - from)) * 100));
const PAUSE = ['EM_PAUSA', 'PAUSA_EXCEDIDA'];
const PENDING = ['PENDENTE_DE_EXCECAO', 'PENDENTE_DE_FECHAMENTO'];

/** Pausa sugerida nº k (1, 2…): distribuídas por igual na jornada (1 pausa = metade; 2 = 1/3 e 2/3). Só referência. */
export function suggestedBreakAt(s, k) {
  const start = t(s.starts_at);
  return start + (k * (t(s.ends_at) - start)) / (s.break_count + 1);
}

export function jornadaStatus(s, events, now) {
  const start = t(s.starts_at);
  const end = t(s.ends_at);
  const evs = [...events].sort((a, b) => t(a.occurred_at) - t(b.occurred_at));
  const last = (type) => evs.filter((e) => e.type === type).at(-1);
  const checkin = last('CHECK_IN');

  if (s.status === 'FINALIZADA' || s.status === 'CANCELADA_ADMINISTRATIVAMENTE' || last('CHECK_OUT')) {
    return { phase: 'fim', clock: null, total: 100, part: null };
  }
  if (s.status === 'AGUARDANDO_CHECKIN' || !checkin) {
    return { phase: 'antes', clock: { label: start - now > 0 ? 'Para começar' : 'Horário de início passou', ms: start - now }, total: 0, part: null };
  }

  const total = pct(start, end, now);
  const toEnd = { label: end - now >= 0 ? 'Para o fim do expediente' : 'Horário de saída passou: faça o checkout', ms: end - now };

  if (PAUSE.includes(s.status)) {
    const pauseStart = t(last('PAUSE_START')?.occurred_at ?? now);
    const pauseEnd = s.break_ends_at ? t(s.break_ends_at) : pauseStart + s.break_minutes * 60000;
    const left = pauseEnd - now;
    return {
      phase: 'pausa',
      clock: { label: left >= 0 ? 'Para acabar a pausa' : 'Pausa passou do tempo: volte agora', ms: left },
      total,
      part: { label: 'Pausa', pct: pct(pauseStart, pauseEnd, now), msLeft: left, ready: false },
    };
  }

  const resumed = last('PAUSE_END');
  const from = Math.max(t(checkin.occurred_at), resumed ? t(resumed.occurred_at) : 0);
  let part;
  if (s.breaks_used < s.break_count) {
    const target = suggestedBreakAt(s, s.breaks_used + 1);
    part = { label: 'Até a pausa', pct: pct(from, target, now), msLeft: target - now, ready: target - now <= 0 };
  } else {
    part = { label: 'Até o fim', pct: pct(from, end, now), msLeft: end - now, ready: false };
  }
  return { phase: PENDING.includes(s.status) ? 'pendente' : 'trabalhando', clock: toEnd, total, part };
}

/** "02:05:09" (ou "-00:03:10" quando o prazo já passou). */
export function hms(ms) {
  const sign = ms < 0 ? '-' : '';
  const s = Math.floor(Math.abs(ms) / 1000);
  return `${sign}${[Math.floor(s / 3600), Math.floor(s / 60) % 60, s % 60].map((n) => String(n).padStart(2, '0')).join(':')}`;
}

/** "1 h 20 min", "35 min", "menos de 1 min". */
export function minutesLeft(ms) {
  const m = Math.ceil(Math.max(0, ms) / 60000);
  if (m < 1) return 'menos de 1 min';
  return m >= 60 ? `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ''}` : `${m} min`;
}
