// Estrelas e bônus do profissional ("como um joguinho"). Cada nível é um mês; cada fase, um dia do mês.
// As estrelas saem do que o app já registra (resultado, validação dos registros, ocorrências). O bônus do mês é
// definido pela gestão (valor total); o sistema sorteia os dias e divide o valor. Quem faz 3 estrelas no dia ganha.

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

export const daysInMonth = (month) => { const [y, mo] = month.split('-').map(Number); return new Date(Date.UTC(y, mo, 0)).getUTCDate(); };
const dayKey = (month, day) => `${month}-${String(day).padStart(2, '0')}`;

/** Sorteia os dias de bônus do mês e divide o total: de 3 a 5 dias (menos se o valor for pequeno), um em cada trecho
 *  do mês, fora dos dias já ocupados (sorteio). Valores sempre crescentes, em múltiplos de R$ 5; a soma é o total. */
export function planBonuses(month, total, taken = [], rand = Math.random) {
  const cents = Math.round(Number(total) * 100);
  if (!(cents > 0)) return [];
  const daysIn = daysInMonth(month);
  // Série mínima crescente 5, 10, 15...: n dias cabem se 5·n(n+1)/2 <= total.
  let n = 3 + Math.floor(rand() * 3);
  while (n > 1 && 500 * (n * (n + 1)) / 2 > cents) n--;
  const days = [];
  for (let i = 0; i < n; i++) {
    const from = Math.floor((i * daysIn) / n) + 1;
    const to = Math.floor(((i + 1) * daysIn) / n);
    const free = [];
    for (let d = from; d <= to; d++) if (!taken.includes(dayKey(month, d))) free.push(d);
    if (free.length) days.push(free[Math.floor(rand() * free.length)]);
  }
  n = days.length;
  if (!n) return [];
  // Base 5, 10, 15... e o resto dividido por pesos crescentes (arredondado para baixo em R$ 5); o último leva a sobra.
  const base = days.map((_, i) => 500 * (i + 1));
  const rest = cents - base.reduce((a, b) => a + b, 0);
  const weights = days.map((_, i) => i + 1);
  const wsum = weights.reduce((a, b) => a + b, 0);
  const values = base.map((b, i) => (rest > 0 ? b + Math.floor((rest * weights[i]) / wsum / 500) * 500 : b));
  values[n - 1] = cents - values.slice(0, -1).reduce((a, b) => a + b, 0);
  return days.map((d, i) => ({ day: dayKey(month, d), kind: 'BONUS', value: values[i] / 100 }));
}

/** Situação de um dia (fase): com diária, a da diária (agendada = ainda vai acontecer); sem diária, "livre" de hoje em
 *  diante (cadeado: desbloqueia agendando uma vaga) ou "passou" (apagado, não dá mais para agendar). */
export function dayStatus(key, diaries, today) {
  const d = diaries[0];
  if (d) return d.state === 'proxima' ? 'agendada' : d.state;
  return key < today ? 'passou' : 'livre';
}

/** Monta um mês (um nível) com TODOS os dias (cada dia é uma fase; sem diária fica vazio). O valor de um bônus só vai
 *  quando o dia chega (today = 'AAAA-MM-DD'); ganho = diária do dia com 3 estrelas. */
export function buildMonth(month, diaries, bonusDays = [], today = '9999-12-31') {
  const daysIn = daysInMonth(month);
  const byDay = new Map();
  for (const d of diaries) { const k = Number(d.day); if (!byDay.has(k)) byDay.set(k, []); byDay.get(k).push(d); }
  const bonusOf = new Map(bonusDays.map((b) => [b.day, b]));
  const days = Array.from({ length: daysIn }, (_, i) => {
    const key = dayKey(month, i + 1);
    const ds = byDay.get(i + 1) ?? [];
    const b = bonusOf.get(key);
    const bonus = b && { kind: b.kind, label: b.label ?? null, value: key <= today && b.value != null ? Number(b.value) : null, revealed: key <= today, earned: ds.some((d) => d.stars === 3) };
    return { day: i + 1, status: dayStatus(key, ds, today), diaries: ds, ...(bonus ? { bonus } : {}) };
  });
  const stars = diaries.reduce((s, d) => s + (d.stars ?? 0), 0);
  const bonusGanho = days.reduce((s, d) => s + (d.bonus?.kind === 'BONUS' && d.bonus.earned && d.bonus.value ? d.bonus.value : 0), 0);
  // Nota do mês no mapa (0 a 3 estrelas): a média das diárias feitas, arredondada; sem diária feita, sem nota.
  const feitas = diaries.filter((d) => d.state === 'feita');
  const rating = feitas.length ? Math.round(feitas.reduce((s, d) => s + (d.stars ?? 0), 0) / feitas.length) : null;
  const hasBonus = bonusDays.some((b) => b.kind === 'BONUS');
  const hasDraw = bonusDays.some((b) => b.kind === 'SORTEIO');
  return { month, level: Number(month.slice(5, 7)), days, diaries, stars, maxStars: daysIn * 3, bonusGanho, done: dayKey(month, daysIn) < today, rating, hasBonus, hasDraw };
}

/** Sorteio (ex.: TV em 20/12): qualifica quem tem `need` dias com 3 estrelas no ano até o dia do sorteio,
 *  e o próprio dia do sorteio também com 3 estrelas. `diaries` = [{ date: 'AAAA-MM-DD', stars }]. */
export function sorteioStatus(diaries, day, need = 15) {
  const year = day.slice(0, 4);
  const perfectDays = new Set(diaries.filter((d) => d.stars === 3 && d.date.startsWith(year) && d.date <= day).map((d) => d.date));
  const dayDone = perfectDays.has(day);
  return { day, need, threeStarDays: perfectDays.size, dayDone, qualifies: perfectDays.size >= need && dayDone };
}

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
