import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMedia } from '../components/fit';
import { Icon } from '../components/icons';
import { Alert, EmptyState, Loading, PageHeader, Progress, StatusBadge } from '../components/ui';
import { api, fmtTime, todayBR, type Unit } from '../lib/api';

type CalJob = {
  id: string; title: string; starts_at: string; ends_at: string; positions: number; status: string; unit_id: string; code: string;
  filial: string | null; unit_name: string; approved: number; reserve: number; working: number; finished: number;
};

const TZ = 'America/Sao_Paulo';
const WEEK = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const MONTHS = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
const iso = (d: Date) => d.toISOString().slice(0, 10);
const dayOf = (s: string) => new Date(s).toLocaleDateString('sv-SE', { timeZone: TZ });
const longDay = (d: string) => {
  const s = new Date(`${d}T12:00:00Z`).toLocaleDateString('pt-BR', { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long' });
  return s.charAt(0).toUpperCase() + s.slice(1);
};

/** Dias da grade do mês (domingo a sábado), em datas "AAAA-MM-DD" (meio-dia UTC para não escorregar de dia). */
function monthGrid(year: number, month: number) {
  const first = new Date(Date.UTC(year, month, 1, 12));
  const start = new Date(first.getTime() - first.getUTCDay() * 86400e3);
  const last = new Date(Date.UTC(year, month + 1, 0, 12));
  const end = new Date(last.getTime() + (6 - last.getUTCDay()) * 86400e3);
  const days: string[] = [];
  for (let t = start.getTime(); t <= end.getTime(); t += 86400e3) days.push(iso(new Date(t)));
  return days;
}

function DayJobs({ jobs }: { jobs: CalJob[] }) {
  return (
    <ul className="cal-jobs">
      {jobs.map((j) => (
        <li key={j.id}>
          <div className="cal-job-head">
            <span className="strong">{fmtTime(j.starts_at)}–{fmtTime(j.ends_at)}</span>
            <StatusBadge status={j.status} />
          </div>
          <div><span className="strong">{j.code}</span>{j.filial && <span className="muted"> · filial {j.filial}</span>} · {j.unit_name}</div>
          <div className="muted">{j.title}{j.reserve ? ` · ${j.reserve} na reserva` : ''}{j.working ? ` · ${j.working} trabalhando` : ''}{j.finished ? ` · ${j.finished} finalizada(s)` : ''}</div>
          <Progress value={j.approved} total={j.positions} />
          <div className="row">
            <Link className="btn sm" to={`/gestao/atividades?unit=${j.unit_id}&date=${dayOf(j.starts_at)}`}><Icon name="activity" size={16} />Atividades</Link>
            <Link className="btn sm ghost" to={`/gestao/vagas/${j.id}`}>Candidaturas</Link>
          </div>
        </li>
      ))}
    </ul>
  );
}

/** Calendário do mês: outra forma de ver as vagas e atividades por data (gestor e admin, no escopo de lojas de cada um). */
export default function Calendario() {
  const today = todayBR();
  const [ym, setYm] = useState(() => ({ y: Number(today.slice(0, 4)), m: Number(today.slice(5, 7)) - 1 }));
  const [unitId, setUnitId] = useState('');
  const [units, setUnits] = useState<Unit[]>([]);
  const [data, setData] = useState<{ jobs: CalJob[]; truncated: boolean }>();
  const [selected, setSelected] = useState<string | null>(today);
  const [error, setError] = useState('');
  const mobile = useMedia('(max-width: 767px)');
  const grid = useMemo(() => monthGrid(ym.y, ym.m), [ym]);
  const monthKey = `${ym.y}-${String(ym.m + 1).padStart(2, '0')}`;

  useEffect(() => { api<Unit[]>('/units').then(setUnits, () => {}); }, []);
  useEffect(() => {
    setData(undefined);
    setError('');
    api<{ jobs: CalJob[]; truncated: boolean }>(`/manage/calendar?from=${grid[0]}&to=${grid.at(-1)}${unitId ? `&unitId=${unitId}` : ''}`).then(setData, (e) => setError(e.message));
  }, [grid, unitId]);

  const byDay = useMemo(() => {
    const m = new Map<string, CalJob[]>();
    for (const j of data?.jobs ?? []) m.set(dayOf(j.starts_at), [...(m.get(dayOf(j.starts_at)) ?? []), j]);
    return m;
  }, [data]);
  const shift = (n: number) => { setYm(({ y, m }) => ({ y: y + Math.floor((m + n) / 12), m: ((m + n) % 12 + 12) % 12 })); setSelected(null); };
  const goToday = () => { setYm({ y: Number(today.slice(0, 4)), m: Number(today.slice(5, 7)) - 1 }); setSelected(today); };
  const monthDays = grid.filter((d) => d.startsWith(monthKey) && byDay.has(d));
  const totals = monthDays.reduce((t, d) => { for (const j of byDay.get(d)!) { t.jobs += 1; t.positions += j.positions; t.approved += j.approved; } return t; }, { jobs: 0, positions: 0, approved: 0 });
  const sel = selected ? byDay.get(selected) ?? [] : [];

  return (
    <div className="page">
      <PageHeader
        title="Calendário"
        description="Vagas e atividades por dia. Clique num dia para ver as vagas e abrir as atividades."
        actions={
          <label className="cal-unit">Unidade
            <select value={unitId} onChange={(e) => setUnitId(e.target.value)}>
              <option value="">Todas as minhas unidades</option>
              {units.map((u) => <option key={u.id} value={u.id}>{u.code}{u.filial ? ` · ${u.filial}` : ''} · {u.name}</option>)}
            </select>
          </label>
        }
      />
      <div className="card cal-toolbar">
        <div className="row">
          <button className="icon-btn" onClick={() => shift(-1)} aria-label="Mês anterior"><Icon name="chevronLeft" /></button>
          <h2 className="cal-month">{MONTHS[ym.m]} {ym.y}</h2>
          <button className="icon-btn" onClick={() => shift(1)} aria-label="Próximo mês"><Icon name="chevronRight" /></button>
          <button className="sm" onClick={goToday}>Hoje</button>
        </div>
        <span className="muted">{totals.jobs} vaga(s) no mês · {totals.approved} de {totals.positions} posições preenchidas</span>
      </div>
      {error && <Alert kind="danger">{error}</Alert>}
      {data?.truncated && <Alert kind="warning">Muitas vagas no período: escolha uma unidade para ver todas.</Alert>}

      {!data ? <Loading /> : mobile ? (
        monthDays.length === 0 ? <div className="card"><EmptyState icon="calendar" title="Nenhuma vaga neste mês" /></div> : (
          <div className="stack">
            {monthDays.map((d) => {
              const jobs = byDay.get(d)!;
              const open = d === selected;
              return (
                <section key={d} className={`card tight cal-agenda${d === today ? ' today' : ''}`}>
                  {/* Celular: um resumo por dia; toque abre as vagas daquele dia (cerca de 57 lojas por dia na operação real). */}
                  <button type="button" className="cal-agenda-head" aria-expanded={open} onClick={() => setSelected(open ? null : d)}>
                    <span><b>{longDay(d)}</b><small>{jobs.length} vaga(s) · {jobs.reduce((t, j) => t + j.approved, 0)}/{jobs.reduce((t, j) => t + j.positions, 0)} preenchidas</small></span>
                    <Icon name={open ? 'chevronDown' : 'chevronRight'} size={18} />
                  </button>
                  {open && <DayJobs jobs={jobs} />}
                </section>
              );
            })}
          </div>
        )
      ) : (
        <div className="cal-layout">
          <div className="card tight cal">
            <div className="cal-grid cal-week">{WEEK.map((w) => <span key={w}>{w}</span>)}</div>
            <div className="cal-grid">
              {grid.map((d) => {
                const jobs = byDay.get(d) ?? [];
                const positions = jobs.reduce((t, j) => t + j.positions, 0);
                const approved = jobs.reduce((t, j) => t + j.approved, 0);
                const stores = [...new Set(jobs.map((j) => j.code))];
                return (
                  <button
                    key={d}
                    type="button"
                    className={`cal-day${d.startsWith(monthKey) ? '' : ' out'}${d === today ? ' today' : ''}${d === selected ? ' selected' : ''}${jobs.length ? ' has' : ''}`}
                    onClick={() => setSelected(d)}
                    aria-label={`${longDay(d)}: ${jobs.length} vaga(s)`}
                    aria-pressed={d === selected}
                  >
                    <span className="cal-num">{Number(d.slice(8))}</span>
                    {jobs.length > 0 && (
                      <>
                        <span className="cal-count">{jobs.length} vaga(s)</span>
                        <span className="cal-fill"><span style={{ width: `${positions ? Math.round((approved / positions) * 100) : 0}%` }} /></span>
                        <span className="cal-meta">{approved}/{positions}</span>
                        <span className="cal-stores">{stores.slice(0, 2).join(' · ')}{stores.length > 2 ? ` +${stores.length - 2}` : ''}</span>
                      </>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
          <aside className="card tight cal-panel">
            <div className="card-header"><h2>{selected ? longDay(selected) : 'Escolha um dia'}</h2>{selected && <span className="sub">{sel.length} vaga(s)</span>}</div>
            {!selected ? <EmptyState icon="calendar" title="Clique num dia do calendário" /> : sel.length === 0 ? <EmptyState icon="calendar" title="Nenhuma vaga neste dia" /> : <DayJobs jobs={sel} />}
          </aside>
        </div>
      )}
    </div>
  );
}
