import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { fmtMoney } from '../lib/api';
import { Icon } from './icons';

export type Report = { items: { tone: 'ok' | 'warn' | 'bad'; text: string }[]; tips: string[] };
export type Diary = { id: string; title: string; unit: string; startsAt: string; date: string; day: number; state: 'feita' | 'hoje' | 'proxima' | 'em_analise'; stars: number | null; report?: Report };
export type Bonus = { kind: 'BONUS' | 'SORTEIO'; label: string | null; value: number | null; revealed: boolean; earned: boolean };
export type DayStatus = 'feita' | 'hoje' | 'em_analise' | 'agendada' | 'livre' | 'passou';
export type Day = { day: number; status: DayStatus; diaries: Diary[]; bonus?: Bonus };
export type Month = { month: string; level: number; stars: number; maxStars: number; diaries: Diary[]; days: Day[]; bonusGanho: number; done: boolean; rating: number | null; hasBonus: boolean; hasDraw: boolean };
export type Sorteio = { label: string | null; day: string; need: number; threeStarDays: number; dayDone: boolean; qualifies: boolean };
export type StarsData = { current: string; year: number; today: string; total: number; bonusGanho: number; sorteio: Sorteio | null; months: Month[]; personagem?: string | null };

export const monthName = (m: string) => {
  const t = new Date(`${m}-15T12:00:00Z`).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric', timeZone: 'America/Sao_Paulo' });
  return t[0].toUpperCase() + t.slice(1);
};
const longDay = (s: string) => { const t = new Date(s).toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'America/Sao_Paulo' }); return t[0].toUpperCase() + t.slice(1); };
const dayMonth = (key: string) => `${key.slice(8, 10)}/${key.slice(5, 7)}`;
const STATE_TEXT: Record<Diary['state'], string> = { feita: '', hoje: 'Hoje', proxima: 'Agendada', em_analise: 'Em análise' };
const CHEER = ['Que pena!', 'Dá para melhorar!', 'Muito bem!', 'Excelente!'];
const HOW_TO = 'Faça check-in, pausa e checkout pelo app, dentro da loja: assim a fase vale 3 estrelas.';

function Stars({ n, of = 3, big = false }: { n: number; of?: number; big?: boolean }) {
  return (
    <span className={`g-stars${big ? ' big' : ''}`} aria-hidden="true">
      {Array.from({ length: of }, (_, i) => <span key={i} className={i < n ? 'on' : ''} style={{ animationDelay: `${0.25 + i * 0.35}s` }}><Icon name="star" size={big ? 64 : 16} /></span>)}
    </span>
  );
}

export type Open = { kind: 'diary'; d: Diary } | { kind: 'bonus'; key: string; b: Bonus; d?: Diary } | { kind: 'livre'; key: string; b?: Bonus };

/** Uma fase = um dia do mês, pela situação vinda do servidor: feita (estrelas), agendada, hoje, em análise,
 *  livre (cadeado: desbloqueia agendando uma vaga nesse dia) ou passou (apagado). Dia de bônus: selo de presente (ou TV). */
function DayTile({ month, day, onOpen, isToday }: { month: string; day: Day; onOpen: (o: Open) => void; isToday: boolean }) {
  const d = day.diaries[0];
  const b = day.bonus;
  const key = `${month}-${String(day.day).padStart(2, '0')}`;
  const badge = b && <span className={`g-badge${b.kind === 'SORTEIO' ? ' tv' : ''}${b.earned ? ' won' : ''}`} aria-hidden="true"><Icon name={b.kind === 'SORTEIO' ? 'tv' : 'gift'} size={14} /></span>;
  const bonusText = b ? (b.kind === 'SORTEIO' ? ', dia do sorteio' : `, dia de bônus${b.earned ? ' ganho' : ''}`) : '';
  const cls = ['g-tile', `s-${day.status}`, d?.stars === 0 && 'zero', isToday && 'is-today', b?.kind === 'SORTEIO' && 'tv'].filter(Boolean).join(' ');
  // Dia livre (cadeado): o toque abre o cartão explicando como desbloquear (candidatar-se a uma vaga nesse dia).
  if (day.status === 'livre') {
    return (
      <li className={cls}>
        <button type="button" className="g-hit" onClick={() => onOpen({ kind: 'livre', key, b })} aria-label={`Dia ${day.day}: bloqueado${bonusText}. Ver como desbloquear`}>
          <span className="g-lock"><Icon name="lock" size={18} /></span><small className="g-date">{day.day}</small>
        </button>
        {badge}
      </li>
    );
  }
  if (!d) {
    if (!b) return <li className={cls} aria-label={`Dia ${day.day}: sem diária`}><b className="g-num">{day.day}</b></li>;
    return (
      <li className={cls}>
        <button type="button" className="g-hit" onClick={() => onOpen({ kind: 'bonus', key, b })} aria-label={`Dia ${day.day}: sem diária${bonusText}. Ver detalhes`}><b className="g-num">{day.day}</b></button>
        {badge}
      </li>
    );
  }
  const text = d.state === 'feita' ? `${d.stars} estrela${d.stars === 1 ? '' : 's'}` : d.state === 'proxima' ? 'diária agendada' : STATE_TEXT[d.state];
  return (
    <li className={cls}>
      <button type="button" className="g-hit" onClick={() => onOpen(b ? { kind: 'bonus', key, b, d } : { kind: 'diary', d })} aria-label={`Dia ${day.day}, ${d.title} em ${d.unit}: ${text}${bonusText}. Ver detalhes`}>
        <b className="g-num">{day.day}</b>
        {d.state === 'feita' ? <Stars n={d.stars ?? 0} /> : d.state === 'proxima' ? <span className="g-sched" aria-hidden="true"><Icon name="calendar" size={12} /></span> : <span className="g-state">{STATE_TEXT[d.state]}</span>}
      </button>
      {badge}
    </li>
  );
}

function MonthPage({ m, today, onOpen }: { m: Month; today: string; onOpen: (o: Open) => void }) {
  return (
    <section className="g-month" aria-label={`Nível ${m.level}: ${monthName(m.month)}`}>
      {/* A prancha mede o espaço que sobra: os quadros encolhem para o mês inteiro caber na tela, sem rolagem. */}
      <div className="g-board">
        <ul className="g-grid" style={{ '--rows5': Math.ceil(m.days.length / 5), '--rows7': Math.ceil(m.days.length / 7) } as CSSProperties}>{m.days.map((day) => <DayTile key={day.day} month={m.month} day={day} isToday={`${m.month}-${String(day.day).padStart(2, '0')}` === today} onOpen={onOpen} />)}</ul>
      </div>
    </section>
  );
}

/** Resumo do dia (sem horários): como foi cada registro e como ganhar mais estrelas. */
function DayDetail({ d, onClose }: { d: Diary; onClose: () => void }) {
  return (
    <div className="g-overlay" role="dialog" aria-modal="true" aria-label={`Dia ${d.day}`} onClick={onClose}>
      <div className="g-sheet" onClick={(e) => e.stopPropagation()}>
        <p className="g-sheet-day">{longDay(d.startsAt)}</p>
        <h2>{d.title}</h2>
        <p className="g-sheet-unit">{d.unit}</p>
        {d.state === 'feita' ? (
          <>
            <Stars n={d.stars ?? 0} big />
            <ul className="g-report">{d.report?.items.map((i) => <li key={i.text} className={i.tone}><span aria-hidden="true">{i.tone === 'ok' ? '✓' : i.tone === 'warn' ? '!' : '✕'}</span>{i.text}</li>)}</ul>
            {!!d.report?.tips.length && <div className="g-tips"><b>Como ganhar mais estrelas</b>{d.report.tips.map((t) => <p key={t}>{t}</p>)}</div>}
          </>
        ) : (
          <p className="g-tips">{d.state === 'proxima' ? `Esta fase abre no dia da diária. ${HOW_TO}` : d.state === 'hoje' ? 'Diária em andamento. Termine com o checkout pelo app para ganhar as estrelas.' : 'Esta diária está em análise pelo gestor. As estrelas aparecem quando ela for concluída.'}</p>
        )}
        <button type="button" className="g-pill" onClick={onClose}>Fechar</button>
      </div>
    </div>
  );
}

/** Dia de bônus (ou do sorteio): regras, valor (só no dia) e se já ganhou. */
function BonusDetail({ o, sorteio, onDiary, onClose }: { o: Extract<Open, { kind: 'bonus' }>; sorteio: Sorteio | null; onDiary: (d: Diary) => void; onClose: () => void }) {
  const { b, d, key } = o;
  const tv = b.kind === 'SORTEIO';
  return (
    <div className="g-overlay" role="dialog" aria-modal="true" aria-label={tv ? 'Dia do sorteio' : `Bônus do dia ${dayMonth(key)}`} onClick={onClose}>
      <div className="g-sheet" onClick={(e) => e.stopPropagation()}>
        <span className={`g-gift${tv ? ' tv' : ''}`} aria-hidden="true"><Icon name={tv ? 'tv' : 'gift'} size={40} /></span>
        <p className="g-sheet-day">{tv ? 'Dia do sorteio' : 'Dia de bônus'} · {dayMonth(key)}</p>
        {tv ? (
          <>
            <h2>{b.label ?? 'Sorteio'}</h2>
            <div className="g-tips">
              <p>Concorre quem tiver <b>{sorteio?.need ?? 15} dias com 3 estrelas</b> no ano e fizer <b>3 estrelas neste dia</b>.</p>
              {sorteio && <p>Você tem <b>{sorteio.threeStarDays} de {sorteio.need}</b> dias com 3 estrelas{sorteio.qualifies ? ' e já está concorrendo!' : '.'}</p>}
              <p>{HOW_TO}</p>
            </div>
          </>
        ) : (
          <>
            <h2>{b.revealed && b.value != null ? fmtMoney(b.value) : 'Bônus surpresa'}</h2>
            <div className="g-tips">
              {b.earned ? <p><b>Você ganhou este bônus!</b> O valor já está no seu A receber.</p> : <p>Faça <b>3 estrelas neste dia</b> e ganhe o bônus: o valor entra no seu A receber.</p>}
              {!b.revealed && <p>O valor é revelado no próprio dia.</p>}
              <p>{HOW_TO}</p>
            </div>
          </>
        )}
        <div className="g-celebrate-actions">
          {d && <button type="button" className="g-pill sm" onClick={() => onDiary(d)}>Ver a diária</button>}
          <button type="button" className="g-pill sm" onClick={onClose}>Fechar</button>
        </div>
      </div>
    </div>
  );
}

/** Dia bloqueado (cadeado): sem vaga neste dia. Para ganhar as estrelas, candidate-se a uma vaga nele. */
function LivreDetail({ o, sorteio, onClose }: { o: Extract<Open, { kind: 'livre' }>; sorteio: Sorteio | null; onClose: () => void }) {
  return (
    <div className="g-overlay" role="dialog" aria-modal="true" aria-label={`Dia ${dayMonth(o.key)} bloqueado`} onClick={onClose}>
      <div className="g-sheet" onClick={(e) => e.stopPropagation()}>
        <span className="g-gift lock" aria-hidden="true"><Icon name="lock" size={36} /></span>
        <p className="g-sheet-day">{longDay(`${o.key}T12:00:00-03:00`)}</p>
        <h2>Dia bloqueado</h2>
        <div className="g-tips">
          <p>Você ainda não tem vaga neste dia. Para ganhar as estrelas dele, <b>candidate-se a uma vaga neste dia</b>: a fase desbloqueia e vale até 3 estrelas.</p>
          {o.b?.kind === 'BONUS' && <p><b>Dia de bônus!</b> Quem fizer 3 estrelas neste dia ganha o bônus em dinheiro.</p>}
          {o.b?.kind === 'SORTEIO' && <p><b>Dia do sorteio!</b> {o.b.label ?? ''}: concorre quem tiver {sorteio?.need ?? 15} dias com 3 estrelas no ano e fizer 3 estrelas neste dia.{sorteio && ` Você tem ${sorteio.threeStarDays} de ${sorteio.need}.`}</p>}
          <p>{HOW_TO}</p>
        </div>
        <div className="g-celebrate-actions">
          <button type="button" className="g-pill sm" onClick={onClose}>Fechar</button>
          <Link className="g-pill sm" to={`/vagas?dia=${o.key}`}>Procurar uma vaga neste dia</Link>
        </div>
      </div>
    </div>
  );
}

/** Cartão de resumo do topo: estrelas do ano, nível e barra do mês, mês e "x de N". Usado no mapa e no calendário. */
export function Resumo({ data, m, left }: { data: StarsData; m: Month; left?: ReactNode }) {
  return (
    <section className="g-summary" aria-label="Resumo">
      {left}
      <div className="g-summary-total" aria-label={`${data.total} estrelas no ano`}>
        <BigStar />
        <span><b>{data.total}</b><small>estrela{data.total === 1 ? '' : 's'}</small></span>
      </div>
      <div className="g-summary-level">
        <span className="g-level-badge">Nível {m.level}</span>
        <div className="g-level-bar" role="progressbar" aria-label={`Estrelas do nível ${m.level}`} aria-valuenow={m.stars} aria-valuemin={0} aria-valuemax={m.maxStars}><span style={{ width: `${(m.stars / m.maxStars) * 100}%` }} /></div>
      </div>
      {/* Mês visível (muda ao arrastar) e as estrelas dele, dentro do mesmo cartão. */}
      <div className="g-summary-month">
        <span><Icon name="calendar" size={15} />{monthName(m.month)}</span>
        <span aria-label={`${m.stars} de ${m.maxStars} estrelas no mês`}><Icon name="star" size={14} /> {m.stars} de {m.maxStars}</span>
      </div>
    </section>
  );
}

/** Estrela grande do resumo (desenho próprio, em SVG). */
function BigStar() {
  return (
    <svg className="g-bigstar" viewBox="0 0 100 100" aria-hidden="true">
      <defs>
        <linearGradient id="gs-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#ffe680" /><stop offset="0.55" stopColor="#ffc21a" /><stop offset="1" stopColor="#f08a00" /></linearGradient>
      </defs>
      <path d="M50 6 L62 36 L94 38 L69 58 L77 90 L50 72 L23 90 L31 58 L6 38 L38 36 Z" fill="url(#gs-fill)" stroke="#c46a00" strokeWidth="4" strokeLinejoin="round" />
      <path d="M50 18 L58 39 L80 41 L63 54" fill="none" stroke="#fff6c8" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" opacity="0.8" />
      <path d="M86 70 l3 7 7 3 -7 3 -3 7 -3 -7 -7 -3 7 -3z" fill="#ffd84d" />
    </svg>
  );
}

/** Baú de estrelas do rodapé (desenho próprio, em SVG). */
function Chest() {
  return (
    <svg className="g-chest-art" viewBox="0 0 240 150" aria-hidden="true">
      <defs>
        <linearGradient id="gc-wood" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#c8742c" /><stop offset="1" stopColor="#8a4a17" /></linearGradient>
        <linearGradient id="gc-gold" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#ffe27a" /><stop offset="1" stopColor="#e09a12" /></linearGradient>
        <radialGradient id="gc-glow"><stop offset="0" stopColor="#fff3b0" stopOpacity="0.95" /><stop offset="1" stopColor="#fff3b0" stopOpacity="0" /></radialGradient>
      </defs>
      <ellipse cx="120" cy="62" rx="92" ry="52" fill="url(#gc-glow)" />
      <path d="M58 70 Q58 22 120 22 Q182 22 182 70 Z" fill="url(#gc-wood)" stroke="#5c2f0c" strokeWidth="4" transform="rotate(-14 58 70)" />
      {[[92, 58], [118, 50], [144, 58], [104, 70], [132, 70]].map(([x, y], i) => (
        <path key={i} d={`M${x} ${y - 13} l4 9 10 1 -8 6 3 10 -9 -6 -9 6 3 -10 -8 -6 10 -1z`} fill="url(#gc-gold)" stroke="#c46a00" strokeWidth="2" strokeLinejoin="round" />
      ))}
      <rect x="56" y="72" width="128" height="62" rx="8" fill="url(#gc-wood)" stroke="#5c2f0c" strokeWidth="4" />
      <rect x="56" y="72" width="128" height="14" fill="url(#gc-gold)" stroke="#5c2f0c" strokeWidth="3" />
      <rect x="74" y="72" width="12" height="62" fill="url(#gc-gold)" stroke="#5c2f0c" strokeWidth="2.5" />
      <rect x="154" y="72" width="12" height="62" fill="url(#gc-gold)" stroke="#5c2f0c" strokeWidth="2.5" />
      <rect x="108" y="88" width="24" height="24" rx="5" fill="url(#gc-gold)" stroke="#5c2f0c" strokeWidth="3" />
      <circle cx="120" cy="99" r="3.5" fill="#5c2f0c" />
      <path d="M30 40 l3 7 7 3 -7 3 -3 7 -3 -7 -7 -3 7 -3z M210 30 l3 7 7 3 -7 3 -3 7 -3 -7 -7 -3 7 -3z" fill="#ffd84d" />
    </svg>
  );
}

/** Comemoração ao terminar uma diária (ou um nível), como no fim de uma fase do jogo. */
function Celebrate({ title, n, text, onDetails, onClose }: { title: string; n: number; text: string; onDetails?: () => void; onClose: () => void }) {
  return (
    <div className="g-overlay celebrate" role="dialog" aria-modal="true" aria-label={`${title} ${text}`}>
      {n >= 2 && <div className="g-confetti" aria-hidden="true">{Array.from({ length: 28 }, (_, i) => <i key={i} style={{ left: `${(i * 37) % 100}%`, animationDelay: `${(i % 7) * 0.18}s`, background: ['#f6c343', '#5bb5f0', '#7ed26b', '#f08a3e', '#e05d8f'][i % 5] }} />)}</div>}
      <div className="g-celebrate">
        <h2>{title}</h2>
        <Stars n={n} big />
        <p>{text}</p>
        <div className="g-celebrate-actions">
          {onDetails && <button type="button" className="g-pill" onClick={onDetails}>Ver detalhes</button>}
          <button type="button" className="g-pill" onClick={onClose}>Continuar</button>
        </div>
      </div>
    </div>
  );
}

/** Verso do cartão: como valem as estrelas, os bônus e o sorteio. */
function Rules({ sorteio }: { sorteio: Sorteio | null }) {
  return (
    <div className="g-rules">
      <h2>Regras</h2>
      <p>Cada mês é um nível. Cada dia do mês é uma fase e vale até 3 estrelas.</p>
      <ul className="g-legend-list">
        <li><Stars n={3} /><span><b>Tudo certinho</b>: check-in, pausa e checkout pelo app, dentro da loja.</span></li>
        <li><Stars n={2} /><span><b>Uma mancadinha</b>: precisou de exceção ou a pausa passou do tempo.</span></li>
        <li><Stars n={1} /><span><b>Mancada maior</b>: checkout feito pelo gestor ou ocorrência registrada.</span></li>
        <li><Stars n={0} /><span><b>Faltou</b>: nenhuma estrela.</span></li>
      </ul>
      <h3><Icon name="gift" size={18} /> Bônus</h3>
      <p>Os dias com presente têm bônus em dinheiro. O valor só aparece no próprio dia. Faça 3 estrelas nesse dia e o bônus entra no seu A receber.</p>
      {sorteio && (
        <>
          <h3><Icon name="tv" size={18} /> {sorteio.label ?? 'Sorteio'}</h3>
          <p>No dia {dayMonth(sorteio.day)}. Concorre quem tiver {sorteio.need} dias com 3 estrelas no ano e fizer 3 estrelas no dia do sorteio. Você tem {sorteio.threeStarDays} de {sorteio.need}.</p>
        </>
      )}
    </div>
  );
}

const SEEN_KEY = 'estrelas-vistas';
const readSeen = (): string[] => { try { return JSON.parse(localStorage.getItem(SEEN_KEY) ?? '[]'); } catch { return []; } };
const writeSeen = (ids: string[]) => { try { localStorage.setItem(SEEN_KEY, JSON.stringify(ids.slice(-400))); } catch { /* sem armazenamento: só comemora de novo */ } };

type Party = { title: string; n: number; text: string; d?: Diary };

/** Tela "como um joguinho" (só o profissional vê): nível do mês, estrelas do ano, meses lado a lado (arrastando),
 *  regras no verso do cartão, resumo do dia, bônus e comemorações. */
export function EstrelasMapa({ data, back, month, onMonth }: { data: StarsData; back?: ReactNode; month?: string; onMonth?: (month: string) => void }) {
  const track = useRef<HTMLDivElement>(null);
  const start = Math.max(0, data.months.findIndex((m) => m.month === (month ?? data.current)));
  const [idx, setIdx] = useState(start);
  const [flipped, setFlipped] = useState(false);
  const [open, setOpen] = useState<Open | null>(null);
  const [party, setParty] = useState<Party | null>(null);
  useEffect(() => {
    const el = track.current;
    if (el) el.scrollTo({ left: start * el.clientWidth, behavior: 'instant' as ScrollBehavior });
  }, [start]);
  // Comemora a diária concluída mais recente ainda não vista neste aparelho; senão, o último nível (mês) concluído.
  useEffect(() => {
    const done = data.months.flatMap((m) => m.diaries).filter((d) => d.state === 'feita');
    const seen = new Set(readSeen());
    const fresh = done.filter((d) => !seen.has(d.id)).sort((a, b) => b.startsAt.localeCompare(a.startsAt));
    const recent = (d: Diary) => Date.now() - new Date(d.startsAt).getTime() < 2 * 86400e3;
    const level = [...data.months].reverse().find((m) => m.done && m.stars > 0);
    const levelKey = level && `nivel-${level.month}`;
    if (fresh.length && (seen.size || recent(fresh[0]))) {
      const d = fresh[0];
      setParty({ title: CHEER[d.stars ?? 0], n: d.stars ?? 0, text: `Dia ${d.day} · ${d.title}`, d });
    } else if (level && levelKey && !seen.has(levelKey) && seen.size) {
      setParty({ title: `Nível ${level.level} concluído!`, n: Math.round((level.stars / level.maxStars) * 3), text: `${monthName(level.month)}: ${level.stars} de ${level.maxStars} estrelas` });
    }
    writeSeen([...seen, ...done.map((d) => d.id), ...data.months.filter((m) => m.done).map((m) => `nivel-${m.month}`)]);
  }, [data]);
  const m = data.months[idx] ?? data.months[0];
  // Avisa a página qual mês está visível (o fundo da tela é a imagem desse mês).
  useEffect(() => { onMonth?.(m.month); }, [m.month]);
  const onScroll = () => { const el = track.current; if (el) setIdx(Math.round(el.scrollLeft / el.clientWidth)); };
  return (
    <>
    <div className={`game g-flip${flipped ? ' flipped' : ''}`}>
      <div className="g-flip-inner">
        <div className="g-face g-front" inert={flipped}>
          <Resumo data={data} m={m} left={back} />
          <div className="g-track" ref={track} onScroll={onScroll}>{data.months.map((mm) => <MonthPage key={mm.month} m={mm} today={data.today} onOpen={setOpen} />)}</div>
          <div className="g-foot">
            <Chest />
            <button type="button" className="g-cta" onClick={() => setFlipped(true)}><Icon name="eye" size={22} />Ver Regras</button>
          </div>
        </div>
        <div className="g-face g-reverse" inert={!flipped}>
          <Rules sorteio={data.sorteio} />
          <button type="button" className="g-pill sm g-rules-btn" onClick={() => setFlipped(false)}>Voltar ao calendário</button>
        </div>
      </div>
    </div>
      {/* Diálogos no corpo da página: ficam acima da barra de baixo (que fica por cima da tela do jogo no celular). */}
      {createPortal(<>
      {open?.kind === 'diary' && <DayDetail d={open.d} onClose={() => setOpen(null)} />}
      {open?.kind === 'bonus' && <BonusDetail o={open} sorteio={data.sorteio} onDiary={(d) => setOpen({ kind: 'diary', d })} onClose={() => setOpen(null)} />}
      {open?.kind === 'livre' && <LivreDetail o={open} sorteio={data.sorteio} onClose={() => setOpen(null)} />}
      {party && <Celebrate title={party.title} n={party.n} text={party.text} onDetails={party.d ? () => { setOpen({ kind: 'diary', d: party.d! }); setParty(null); } : undefined} onClose={() => setParty(null)} />}
      </>, document.body)}
    </>
  );
}
