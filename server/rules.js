// Regras puras do domínio: sem banco e sem HTTP. Testadas em test/rules.test.js.

const EARTH_RADIUS_M = 6371000;
const rad = (d) => (d * Math.PI) / 180;

export function distanceMeters(a, b) {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
}

export const CHECKIN_EARLY_MS = 2 * 60 * 60 * 1000;
export const CHECKIN_LATE_MS = 15 * 60 * 1000;

/** Check-in vale de 2 h antes até 15 min depois do início. Retorna o motivo da recusa ou null. */
export function checkinWindowError(startsAt, now) {
  const diff = new Date(now) - new Date(startsAt);
  if (diff < -CHECKIN_EARLY_MS) return 'Check-in liberado somente 2 horas antes do início da vaga.';
  if (diff > CHECKIN_LATE_MS) return 'Prazo de check-in encerrado (tolerância de 15 minutos).';
  return null;
}

export const EVENT_TYPES = ['CHECK_IN', 'PAUSE_START', 'PAUSE_END', 'CHECK_OUT'];

/** Próximo estado da jornada, ou null se a transição não é permitida. */
export function nextState(state, type, { breaksUsed = 0, breakCount = 0 } = {}) {
  if (type === 'CHECK_IN') return state === 'AGUARDANDO_CHECKIN' ? 'EM_ATIVIDADE' : null;
  if (type === 'PAUSE_START') return state === 'EM_ATIVIDADE' && breaksUsed < breakCount ? 'EM_PAUSA' : null;
  if (type === 'PAUSE_END') return state === 'EM_PAUSA' || state === 'PAUSA_EXCEDIDA' ? 'EM_ATIVIDADE' : null;
  if (type === 'CHECK_OUT') return state === 'EM_ATIVIDADE' ? 'FINALIZADA' : null;
  return null;
}

export function transitionError(state, type, { breaksUsed = 0, breakCount = 0 } = {}) {
  if (state === 'FINALIZADA') return 'Atividade já finalizada.';
  if (state === 'CANCELADA_ADMINISTRATIVAMENTE') return 'Atividade cancelada pelo gestor.';
  if (type === 'CHECK_OUT' && (state === 'EM_PAUSA' || state === 'PAUSA_EXCEDIDA')) return 'Registre o retorno da pausa antes do checkout.';
  if (type === 'PAUSE_START' && state === 'EM_ATIVIDADE' && breaksUsed >= breakCount) return 'Limite de pausas desta vaga atingido.';
  return 'Ação não permitida no estado atual da atividade.';
}

/** tempo_trabalhado = checkout - checkin - soma das pausas. null enquanto a jornada estiver incompleta. */
export function workedTime(events) {
  let start, end, pauseStart;
  let breakMs = 0;
  for (const e of events) {
    const t = new Date(e.occurred_at).getTime();
    if (e.type === 'CHECK_IN') start = t;
    else if (e.type === 'PAUSE_START') pauseStart = t;
    else if (e.type === 'PAUSE_END' && pauseStart != null) { breakMs += t - pauseStart; pauseStart = null; }
    else if (e.type === 'CHECK_OUT') end = t;
  }
  if (start == null || end == null) return null;
  return { workedMin: Math.round((end - start - breakMs) / 60000), breakMin: Math.round(breakMs / 60000) };
}

export function isValidCpf(value) {
  const d = String(value ?? '').replace(/\D/g, '');
  if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false;
  for (const n of [9, 10]) {
    let sum = 0;
    for (let i = 0; i < n; i++) sum += Number(d[i]) * (n + 1 - i);
    if (((sum * 10) % 11) % 10 !== Number(d[n])) return false;
  }
  return true;
}
