// Estrelas e bônus do profissional ("como um joguinho"). PRÉVIA: regras e valores ainda serão definidos com a
// UP Service; nada aqui gera pagamento. Tudo sai do que o app já registra (resultado, validação dos registros, ocorrências).

/** Estrelas de uma diária: 3 tudo certinho, 2 mancada pequena, 1 mancada maior, 0 falta; null = ainda não vale. */
export function diaryStars({ result, sessionStatus, endsAt, validations = [], occurrences = [] }, now = Date.now()) {
  if (result === 'NAO_COMPARECEU' || occurrences.includes('FALTA')) return { state: 'feita', stars: 0 };
  const done = result === 'CONCLUIDA' || sessionStatus === 'FINALIZADA';
  if (!done) {
    if (['PENDENTE_DE_FECHAMENTO', 'PENDENTE_DE_EXCECAO'].includes(sessionStatus) || (new Date(endsAt).getTime() < now && sessionStatus !== 'AGUARDANDO_CHECKIN')) return { state: 'em_analise', stars: null };
    if (['EM_ATIVIDADE', 'EM_PAUSA', 'PAUSA_EXCEDIDA'].includes(sessionStatus)) return { state: 'hoje', stars: null };
    return { state: 'proxima', stars: null };
  }
  // Mancada maior: gestor precisou fechar o checkout, ou ocorrência séria.
  if (validations.includes('FECHAMENTO_ADMINISTRATIVO') || occurrences.some((o) => ['CHECKOUT_AUSENTE', 'ABANDONO', 'FRAUDE', 'REGRA_OPERACIONAL'].includes(o))) return { state: 'feita', stars: 1 };
  // Mancada pequena: precisou de exceção (gestor aprovou) ou estourou a pausa.
  if (validations.includes('EXCECAO_APROVADA') || occurrences.includes('PAUSA_EXCEDIDA')) return { state: 'feita', stars: 2 };
  return { state: 'feita', stars: 3 };
}

// Bônus de exemplo por mês (fração das estrelas possíveis no mês) e o "mês perfeito" (todas as diárias, sem falta).
export const BONUSES = [
  { key: 'b1', value: 10, share: 0.3 },
  { key: 'b2', value: 20, share: 0.55 },
  { key: 'b3', value: 30, share: 0.8 },
];
export const PERFECT_BONUS = 50;
export const STARS_PER_LEVEL = 30;

/** Monta um mês com TODOS os dias (cada dia é uma fase; dia sem diária fica vazio, sem estrela), as estrelas,
 *  os bônus (meta, se já abriu e depois de qual dia aparecem na grade) e o mês perfeito. */
export function buildMonth(month, diaries) {
  const [y, mo] = month.split('-').map(Number);
  const daysIn = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  const byDay = new Map();
  for (const d of diaries) { const k = Number(d.day); if (!byDay.has(k)) byDay.set(k, []); byDay.get(k).push(d); }
  const days = Array.from({ length: daysIn }, (_, i) => ({ day: i + 1, diaries: byDay.get(i + 1) ?? [] }));
  const max = diaries.length * 3;
  const stars = diaries.reduce((s, d) => s + (d.stars ?? 0), 0);
  const bonuses = BONUSES.map((b) => {
    const goal = Math.max(1, Math.ceil(max * b.share));
    return { key: b.key, value: b.value, goal, unlocked: max > 0 && stars >= goal, afterDay: Math.round(daysIn * b.share) };
  });
  const finished = diaries.length > 0 && diaries.every((d) => d.state === 'feita');
  const perfect = { value: PERFECT_BONUS, unlocked: finished && diaries.every((d) => d.stars > 0), lost: diaries.some((d) => d.stars === 0) };
  return { month, days, diaries, stars, maxStars: max, bonuses, perfect };
}

export const levelOf = (total) => ({ level: Math.floor(total / STARS_PER_LEVEL) + 1, inLevel: total % STARS_PER_LEVEL, perLevel: STARS_PER_LEVEL });

// Resumo da diária para o profissional (sem horários): como foi cada registro e como ganhar mais estrelas.
const STEP_NAME = { CHECK_IN: 'Check-in feito', PAUSE_START: 'Início da pausa feito', PAUSE_END: 'Volta da pausa feita', CHECK_OUT: 'Checkout feito' };
const TIPS = {
  exception: 'Faça os registros dentro da loja, com a localização ligada e o celular com sinal: assim não precisa de exceção.',
  closed: 'Antes de ir embora, segure o botão de checkout no app. Checkout esquecido vale só 1 estrela.',
  pause: 'Volte da pausa no horário: o app avisa quando o tempo está acabando.',
  absent: 'Se não puder ir, desista pelo app antes do início: a vaga vai para a reserva e você não leva falta.',
  serious: 'Fique até o fim da diária e siga as regras da loja: ocorrência registrada vale só 1 estrela.',
  perfect: 'Perfeito! Continue assim: check-in, pausa e checkout pelo app, dentro da loja.',
};
export function diaryReport({ stars, steps = {}, occurrences = [] }) {
  if (stars === 0) return { items: [{ tone: 'bad', text: 'Você não compareceu a esta diária.' }], tips: [TIPS.absent] };
  const items = [];
  const tips = new Set();
  for (const type of ['CHECK_IN', 'PAUSE_START', 'PAUSE_END', 'CHECK_OUT']) {
    const v = steps[type];
    if (!v) continue;
    if (v === 'GPS_VALIDADO') items.push({ tone: 'ok', text: `${STEP_NAME[type]} na loja, pelo app` });
    else if (v === 'EXCECAO_APROVADA') { items.push({ tone: 'warn', text: `${STEP_NAME[type].replace(/ feit[oa]$/, '')} precisou de exceção (o gestor aprovou)` }); tips.add(TIPS.exception); }
    else if (v === 'FECHAMENTO_ADMINISTRATIVO') { items.push({ tone: 'bad', text: `${STEP_NAME[type]} pelo gestor (ficou faltando no app)` }); tips.add(TIPS.closed); }
  }
  for (const o of occurrences) {
    if (o === 'PAUSA_EXCEDIDA') { items.push({ tone: 'warn', text: 'A pausa passou do tempo combinado' }); tips.add(TIPS.pause); }
    if (o === 'CHECKOUT_AUSENTE') { items.push({ tone: 'bad', text: 'O checkout não foi feito no app' }); tips.add(TIPS.closed); }
    if (['ABANDONO', 'FRAUDE', 'REGRA_OPERACIONAL'].includes(o)) { items.push({ tone: 'bad', text: 'Houve uma ocorrência registrada nesta diária' }); tips.add(TIPS.serious); }
  }
  if (stars === 3) tips.add(TIPS.perfect);
  return { items, tips: [...tips] };
}
