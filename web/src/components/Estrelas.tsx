import { useEffect, useRef, useState, type ReactElement } from 'react';
import { fmtMoney } from '../lib/api';
import { Icon } from './icons';

export type Report = { items: { tone: 'ok' | 'warn' | 'bad'; text: string }[]; tips: string[] };
export type Diary = { id: string; title: string; unit: string; startsAt: string; day: number; state: 'feita' | 'hoje' | 'proxima' | 'em_analise'; stars: number | null; report?: Report };
export type Month = {
  month: string; stars: number; maxStars: number; diaries: Diary[]; days: { day: number; diaries: Diary[] }[];
  bonuses: { key: string; value: number; goal: number; unlocked: boolean; afterDay: number }[];
  perfect: { value: number; unlocked: boolean; lost: boolean };
};
export type StarsData = { current: string; total: number; level: number; inLevel: number; perLevel: number; months: Month[] };

const monthName = (m: string) => {
  const t = new Date(`${m}-15T12:00:00Z`).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric', timeZone: 'America/Sao_Paulo' });
  return t[0].toUpperCase() + t.slice(1);
};
const longDay = (s: string) => { const t = new Date(s).toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'America/Sao_Paulo' }); return t[0].toUpperCase() + t.slice(1); };
const STATE_TEXT: Record<Diary['state'], string> = { feita: '', hoje: 'Hoje', proxima: 'Bloqueada', em_analise: 'Em análise' };
const CHEER = ['Que pena!', 'Dá para melhorar!', 'Muito bem!', 'Excelente!'];

function Stars({ n, of = 3, big = false }: { n: number; of?: number; big?: boolean }) {
  return (
    <span className={`g-stars${big ? ' big' : ''}`} aria-hidden="true">
      {Array.from({ length: of }, (_, i) => <span key={i} className={i < n ? 'on' : ''} style={{ animationDelay: `${0.25 + i * 0.35}s` }}><Icon name="star" size={big ? 64 : 16} /></span>)}
    </span>
  );
}

/** Uma fase = um dia do mês. Sem diária: vazia, sem estrela. Diária futura: cadeado. Feita: 0 a 3 estrelas. Toque abre o resumo. */
function DayTile({ day, d, today, onOpen }: { day: number; d?: Diary; today: boolean; onOpen: (d: Diary) => void }) {
  if (!d) return <li className={`g-tile g-blank${today ? ' is-today' : ''}`} aria-label={`Dia ${day}: sem diária`}><b className="g-num">{day}</b></li>;
  const text = d.state === 'feita' ? `${d.stars} estrela${d.stars === 1 ? '' : 's'}` : STATE_TEXT[d.state];
  const cls = ['g-tile', d.state !== 'feita' && 'locked', d.state === 'hoje' && 'today', d.stars === 0 && 'zero', today && 'is-today'].filter(Boolean).join(' ');
  return (
    <li className={cls}>
      <button type="button" className="g-hit" onClick={() => onOpen(d)} aria-label={`Dia ${day}, ${d.title} em ${d.unit}: ${text}. Ver detalhes`}>
        {d.state === 'proxima' ? <><span className="g-lock"><Icon name="lock" size={20} /></span><small className="g-date">dia {day}</small></> : <b className="g-num">{day}</b>}
        {d.state === 'feita' ? <Stars n={d.stars ?? 0} /> : d.state !== 'proxima' && <span className="g-state">{STATE_TEXT[d.state]}</span>}
      </button>
    </li>
  );
}

function BonusTile({ value, unlocked, goal, have, label: text }: { value: number; unlocked: boolean; goal?: number; have?: number; label?: string }) {
  const missing = goal != null && have != null ? Math.max(0, goal - have) : null;
  const status = unlocked ? 'desbloqueado' : missing != null ? `faltam ${missing} estrelas` : 'bloqueado';
  return (
    <li className={`g-tile bonus${unlocked ? ' open' : ''}`} aria-label={`${text ?? 'Bônus'} de ${fmtMoney(value)}: ${status}`}>
      {!unlocked && <span className="g-lock sm"><Icon name="lock" size={14} /></span>}
      <b className="g-money">{fmtMoney(value).replace(',00', '')}</b>
      <small className="g-date">{text ?? (unlocked ? 'Aberto' : missing != null ? `faltam ${missing}★` : '')}</small>
    </li>
  );
}

function MonthPage({ m, todayKey, onOpen }: { m: Month; todayKey: string; onOpen: (d: Diary) => void }) {
  const items: ReactElement[] = [];
  const bonusAt = new Map<number, Month['bonuses']>();
  for (const b of m.bonuses) bonusAt.set(b.afterDay, [...(bonusAt.get(b.afterDay) ?? []), b]);
  for (const { day, diaries } of m.days) {
    const key = `${m.month}-${String(day).padStart(2, '0')}`;
    items.push(<DayTile key={day} day={day} d={diaries[0]} today={key === todayKey} onOpen={onOpen} />);
    if (m.diaries.length) for (const b of bonusAt.get(day) ?? []) items.push(<BonusTile key={b.key} value={b.value} unlocked={b.unlocked} goal={b.goal} have={m.stars} />);
  }
  if (m.diaries.length) items.push(<BonusTile key="perfeito" value={m.perfect.value} unlocked={m.perfect.unlocked} label={m.perfect.lost ? 'Perdido' : 'Perfeito'} />);
  return (
    <section className="g-month" aria-label={monthName(m.month)}>
      <header className="g-month-head">
        <h2>{monthName(m.month)}</h2>
        <span className="g-count"><Icon name="star" size={16} /> {m.stars} de {m.maxStars}</span>
      </header>
      {m.diaries.length === 0 && <p className="g-empty">Nenhuma diária neste mês ainda. Escolha vagas para ativar as fases e ganhar estrelas!</p>}
      <ul className="g-grid">{items}</ul>
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
          <p className="g-tips">{d.state === 'proxima' ? 'Esta fase abre no dia da diária. Faça check-in, pausa e checkout pelo app, dentro da loja, para ganhar 3 estrelas.' : d.state === 'hoje' ? 'Diária em andamento. Termine com o checkout pelo app para ganhar as estrelas.' : 'Esta diária está em análise pelo gestor. As estrelas aparecem quando ela for concluída.'}</p>
        )}
        <button type="button" className="g-pill" onClick={onClose}>Fechar</button>
      </div>
    </div>
  );
}

/** Comemoração ao terminar uma diária, como no fim de uma fase do jogo. */
function Celebrate({ d, onDetails, onClose }: { d: Diary; onDetails: () => void; onClose: () => void }) {
  const n = d.stars ?? 0;
  return (
    <div className="g-overlay celebrate" role="dialog" aria-modal="true" aria-label={`${CHEER[n]} ${n} estrelas`}>
      {n >= 2 && <div className="g-confetti" aria-hidden="true">{Array.from({ length: 28 }, (_, i) => <i key={i} style={{ left: `${(i * 37) % 100}%`, animationDelay: `${(i % 7) * 0.18}s`, background: ['#f6c343', '#5bb5f0', '#7ed26b', '#f08a3e', '#e05d8f'][i % 5] }} />)}</div>}
      <div className="g-celebrate">
        <h2>{CHEER[n]}</h2>
        <Stars n={n} big />
        <p>Dia {d.day} · {d.title}</p>
        <div className="g-celebrate-actions">
          <button type="button" className="g-pill" onClick={onDetails}>Ver detalhes</button>
          <button type="button" className="g-pill" onClick={onClose}>Continuar</button>
        </div>
      </div>
    </div>
  );
}

const SEEN_KEY = 'estrelas-vistas';
const readSeen = (): string[] => { try { return JSON.parse(localStorage.getItem(SEEN_KEY) ?? '[]'); } catch { return []; } };
const writeSeen = (ids: string[]) => { try { localStorage.setItem(SEEN_KEY, JSON.stringify(ids.slice(-400))); } catch { /* sem armazenamento: só comemora de novo */ } };

/** Mapa de estrelas "como um joguinho" (só o profissional vê): nível, total, meses lado a lado, resumo do dia e comemoração. */
export function EstrelasMapa({ data }: { data: StarsData }) {
  const track = useRef<HTMLDivElement>(null);
  const todayKey = new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });
  const idx = Math.max(0, data.months.findIndex((m) => m.month === data.current));
  const [open, setOpen] = useState<Diary | null>(null);
  const [party, setParty] = useState<Diary | null>(null);
  useEffect(() => {
    const el = track.current;
    if (el) el.scrollTo({ left: idx * el.clientWidth, behavior: 'instant' as ScrollBehavior });
  }, [idx]);
  // Comemora a diária concluída mais recente que ainda não foi vista neste aparelho.
  useEffect(() => {
    const done = data.months.flatMap((m) => m.diaries).filter((d) => d.state === 'feita');
    const seen = new Set(readSeen());
    const fresh = done.filter((d) => !seen.has(d.id)).sort((a, b) => b.startsAt.localeCompare(a.startsAt));
    const recent = (d: Diary) => Date.now() - new Date(d.startsAt).getTime() < 2 * 86400e3;
    if (fresh.length && (seen.size || recent(fresh[0]))) setParty(fresh[0]);
    writeSeen([...seen, ...done.map((d) => d.id)]);
  }, [data]);
  const go = (dir: number) => track.current?.scrollBy({ left: dir * track.current.clientWidth, behavior: 'smooth' });
  return (
    <div className="game">
      <div className="g-top">
        <div className="g-level">
          <span className="g-level-badge">Nível {data.level}</span>
          <div className="g-level-bar" role="progressbar" aria-label="Até o próximo nível" aria-valuenow={data.inLevel} aria-valuemin={0} aria-valuemax={data.perLevel}><span style={{ width: `${(data.inLevel / data.perLevel) * 100}%` }} /></div>
          <small>{data.perLevel - data.inLevel} estrelas para o nível {data.level + 1}</small>
        </div>
        <span className="g-total" aria-label={`${data.total} estrelas no total`}>{data.total} <Icon name="star" size={22} /></span>
      </div>
      <div className="g-nav">
        <button type="button" className="g-arrow" aria-label="Mês anterior" onClick={() => go(-1)}><Icon name="chevronLeft" size={22} /></button>
        <span>Deslize para ver os outros meses</span>
        <button type="button" className="g-arrow" aria-label="Próximo mês" onClick={() => go(1)}><Icon name="chevronRight" size={22} /></button>
      </div>
      <div className="g-track" ref={track}>{data.months.map((m) => <MonthPage key={m.month} m={m} todayKey={todayKey} onOpen={setOpen} />)}</div>
      <p className="g-legend"><Stars n={3} /> tudo certinho · <Stars n={2} /> uma mancadinha · <Stars n={1} /> mancada maior · faltou: nenhuma</p>
      <p className="g-note">Prévia: os valores dos bônus são de exemplo e as regras ainda estão em definição. Não gera pagamento.</p>
      {open && <DayDetail d={open} onClose={() => setOpen(null)} />}
      {party && <Celebrate d={party} onDetails={() => { setOpen(party); setParty(null); }} onClose={() => setParty(null)} />}
    </div>
  );
}
