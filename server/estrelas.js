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

/** Monta um mês: diárias em ordem, estrelas, bônus (posição na grade, meta e se já abriu) e o mês perfeito. */
export function buildMonth(month, diaries) {
  const max = diaries.length * 3;
  const stars = diaries.reduce((s, d) => s + (d.stars ?? 0), 0);
  const bonuses = BONUSES.map((b) => {
    const goal = Math.max(1, Math.ceil(max * b.share));
    return { key: b.key, value: b.value, goal, unlocked: max > 0 && stars >= goal, after: Math.min(diaries.length, Math.ceil(goal / 3)) };
  });
  const finished = diaries.length > 0 && diaries.every((d) => d.state === 'feita');
  const perfect = { value: PERFECT_BONUS, unlocked: finished && diaries.every((d) => d.stars > 0), lost: diaries.some((d) => d.stars === 0) };
  return { month, diaries, stars, maxStars: max, bonuses, perfect };
}

export const levelOf = (total) => ({ level: Math.floor(total / STARS_PER_LEVEL) + 1, inLevel: total % STARS_PER_LEVEL, perLevel: STARS_PER_LEVEL });
