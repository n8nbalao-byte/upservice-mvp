import { useEffect, useRef, type ReactElement } from 'react';
import { fmtMoney } from '../lib/api';
import { Icon } from './icons';

export type Diary = { id: string; title: string; unit: string; startsAt: string; state: 'feita' | 'hoje' | 'proxima' | 'em_analise'; stars: number | null };
export type Month = {
  month: string; stars: number; maxStars: number; diaries: Diary[];
  bonuses: { key: string; value: number; goal: number; unlocked: boolean; after: number }[];
  perfect: { value: number; unlocked: boolean; lost: boolean };
};
export type StarsData = { current: string; total: number; level: number; inLevel: number; perLevel: number; months: Month[] };

const monthName = (m: string) => { const t = new Date(`${m}-15T12:00:00Z`).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric', timeZone: 'America/Sao_Paulo' }); return t[0].toUpperCase() + t.slice(1); };
const dayMonth = (s: string) => new Date(s).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', timeZone: 'America/Sao_Paulo' });
const STATE_TEXT: Record<Diary['state'], string> = { feita: '', hoje: 'Hoje', proxima: 'Bloqueada', em_analise: 'Em análise' };

function Stars({ n, of = 3 }: { n: number; of?: number }) {
  return <span className="g-stars" aria-hidden="true">{Array.from({ length: of }, (_, i) => <span key={i} className={i < n ? 'on' : ''}><Icon name="star" size={16} /></span>)}</span>;
}

function DiaryTile({ d, n }: { d: Diary; n: number }) {
  const locked = d.state !== 'feita';
  const text = d.state === 'feita' ? `${d.stars} estrela${d.stars === 1 ? '' : 's'}` : STATE_TEXT[d.state];
  return (
    <li className={`g-tile${locked ? ' locked' : ''}${d.state === 'hoje' ? ' today' : ''}${d.stars === 0 ? ' zero' : ''}`} aria-label={`Diária ${n}, ${dayMonth(d.startsAt)}, ${d.unit}: ${text}`} title={`${d.title} · ${d.unit} · ${dayMonth(d.startsAt)}`}>
      {locked && d.state === 'proxima' ? <span className="g-lock"><Icon name="lock" size={22} /></span> : <b className="g-num">{n}</b>}
      <small className="g-date">{dayMonth(d.startsAt)}</small>
      {d.state === 'feita' ? <Stars n={d.stars ?? 0} /> : d.state !== 'proxima' && <span className="g-state">{STATE_TEXT[d.state]}</span>}
    </li>
  );
}

function BonusTile({ value, unlocked, goal, have, label: text }: { value: number; unlocked: boolean; goal?: number; have?: number; label?: string }) {
  const missing = goal != null && have != null ? Math.max(0, goal - have) : null;
  return (
    <li className={`g-tile bonus${unlocked ? ' open' : ''}`} aria-label={`${text ?? 'Bônus'} de ${fmtMoney(value)}: ${unlocked ? 'desbloqueado' : missing != null ? `faltam ${missing} estrelas` : 'bloqueado'}`}>
      {!unlocked && <span className="g-lock sm"><Icon name="lock" size={14} /></span>}
      <b className="g-money">{fmtMoney(value).replace(',00', '')}</b>
      <small className="g-date">{text ?? (unlocked ? 'Aberto' : missing != null ? `faltam ${missing}★` : '')}</small>
    </li>
  );
}

function MonthPage({ m }: { m: Month }) {
  const items: ReactElement[] = [];
  const bonusAt = new Map<number, Month['bonuses']>();
  for (const b of m.bonuses) bonusAt.set(b.after, [...(bonusAt.get(b.after) ?? []), b]);
  m.diaries.forEach((d, i) => {
    items.push(<DiaryTile key={d.id} d={d} n={i + 1} />);
    for (const b of bonusAt.get(i + 1) ?? []) items.push(<BonusTile key={b.key} value={b.value} unlocked={b.unlocked} goal={b.goal} have={m.stars} />);
  });
  if (m.diaries.length) items.push(<BonusTile key="perfeito" value={m.perfect.value} unlocked={m.perfect.unlocked} label={m.perfect.lost ? 'Perdido' : 'Perfeito'} />);
  return (
    <section className="g-month" aria-label={monthName(m.month)}>
      <header className="g-month-head">
        <h2>{monthName(m.month)}</h2>
        <span className="g-count"><Icon name="star" size={16} /> {m.stars} de {m.maxStars}</span>
      </header>
      {m.diaries.length === 0 ? <p className="g-empty">Nenhuma diária neste mês ainda. Escolha uma vaga e comece a ganhar estrelas!</p> : <ul className="g-grid">{items}</ul>}
    </section>
  );
}

/** Mapa de estrelas "como um joguinho": nível, total e os meses lado a lado (rola para o lado). PRÉVIA: valores de exemplo. */
export function EstrelasMapa({ data }: { data: StarsData }) {
  const track = useRef<HTMLDivElement>(null);
  const idx = Math.max(0, data.months.findIndex((m) => m.month === data.current));
  useEffect(() => {
    const el = track.current;
    if (el) el.scrollTo({ left: idx * el.clientWidth, behavior: 'instant' as ScrollBehavior });
  }, [idx]);
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
      <div className="g-track" ref={track}>{data.months.map((m) => <MonthPage key={m.month} m={m} />)}</div>
      <p className="g-legend"><Stars n={3} /> tudo certinho · <Stars n={2} /> uma mancadinha · <Stars n={1} /> mancada maior · faltou: nenhuma</p>
      <p className="g-note">Prévia: os valores dos bônus são de exemplo e as regras ainda estão em definição. Não gera pagamento.</p>
    </div>
  );
}
