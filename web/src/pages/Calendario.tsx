import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useMe } from '../App';
import { useMedia } from '../components/fit';
import { Icon } from '../components/icons';
import { Alert, EmptyState, Loading, PageHeader, StatusBadge, useAction, useDialog } from '../components/ui';
import { api, fmtTime, todayBR, type Unit } from '../lib/api';

type CalJob = {
  id: string; title: string; starts_at: string; ends_at: string; positions: number; status: string; unit_id: string; code: string;
  filial: string | null; unit_name: string; approved: number; reserve: number; working: number; finished: number;
};

type Brinde = { id: string; day: string; unitId: string | null; unitCode: string | null; unitName: string | null; premio: string; status: 'AGENDADO' | 'SORTEADO' | 'SEM_PARTICIPANTES'; participants: number | null; winner: string | null };

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

/** Vagas do dia em cartões compactos (duas linhas), para caberem todas no painel ao lado do calendário. A faixa da
 *  esquerda mostra o preenchimento: verde (completa), amarela (em parte) ou vermelha (ninguém). */
function DayJobs({ jobs }: { jobs: CalJob[] }) {
  return (
    <ul className="cal-jobs">
      {jobs.map((j) => {
        const fill = j.approved >= j.positions ? 'f-full' : j.approved > 0 ? 'f-part' : 'f-none';
        const extra = [j.reserve && `${j.reserve} na reserva`, j.working && `${j.working} trabalhando`, j.finished && `${j.finished} finalizada(s)`].filter(Boolean).join(' · ');
        return (
          <li key={j.id} className={`cal-job ${fill}`}>
            <div className="cal-job-top">
              <b className="tabular">{fmtTime(j.starts_at)}–{fmtTime(j.ends_at)}</b>
              <span className="cal-job-what" title={`${j.code}${j.filial ? ` · filial ${j.filial}` : ''} · ${j.unit_name} · ${j.title}`}><b>{j.code}</b>{j.filial && ` · ${j.filial}`} · {j.title}</span>
              {j.status !== 'ABERTA' && <StatusBadge status={j.status} />}
            </div>
            <div className="cal-job-bottom">
              <span className="cal-job-fill" aria-hidden="true"><span style={{ width: `${j.positions ? Math.round((j.approved / j.positions) * 100) : 0}%` }} /></span>
              <span className="cal-job-count"><b>{j.approved}/{j.positions}</b>{extra && <span className="muted"> · {extra}</span>}</span>
              <Link className="icon-btn sm" to={`/gestao/atividades?unit=${j.unit_id}&date=${dayOf(j.starts_at)}`} title="Atividades" aria-label={`Atividades de ${j.code} às ${fmtTime(j.starts_at)}`}><Icon name="activity" size={16} /></Link>
              <Link className="icon-btn sm" to={`/gestao/vagas/${j.id}`} title="Candidaturas" aria-label={`Candidaturas de ${j.code} às ${fmtTime(j.starts_at)}`}><Icon name="users" size={16} /></Link>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/** Brindes do dia: o administrador cadastra um brinde para sortear (na unidade do filtro ou em todas) e cancela
 *  enquanto não foi sorteado. Concorre quem fizer 3 estrelas no dia; o sorteio é às 9h do dia seguinte. */
function BrindesDia({ day, items, unit, canAdd, admin, onChange }: { day: string; items: Brinde[]; unit: Unit | null; canAdd: boolean; admin: boolean; onChange: () => void }) {
  const { busy, run } = useAction();
  const { confirm } = useDialog();
  const [open, setOpen] = useState(false);
  const [premio, setPremio] = useState('');
  const [todas, setTodas] = useState(!unit);
  if (!items.length && !(admin && canAdd)) return null;
  async function salvar(e: FormEvent) {
    e.preventDefault();
    if (await run('brinde', () => api('/admin/brindes', { body: { day, premio, unitId: todas || !unit ? null : unit.id } }), 'Brinde cadastrado. O sorteio é às 9h do dia seguinte.')) {
      setOpen(false); setPremio(''); onChange();
    }
  }
  async function cancelar(b: Brinde) {
    if (!(await confirm({ title: 'Cancelar este brinde?', message: `${b.premio} · ${b.unitName ?? 'todas as unidades'}`, confirmText: 'Cancelar brinde', tone: 'danger' }))) return;
    if (await run(b.id, () => api(`/admin/brindes/${b.id}`, { method: 'DELETE' }), 'Brinde cancelado.')) onChange();
  }
  return (
    <div className="cal-brindes">
      {items.map((b) => (
        <div key={b.id} className="cal-brinde-item">
          <Icon name="gift" size={18} />
          <span>
            <span><b>{b.premio}</b> · {b.unitName ?? 'todas as unidades'}</span>
            <small>{b.status === 'SORTEADO' ? `Ganhou ${b.winner}, entre ${b.participants} participante(s).` : b.status === 'SEM_PARTICIPANTES' ? 'Ninguém fez 3 estrelas: sem sorteio.' : 'Sorteio às 9h do dia seguinte, entre quem fizer 3 estrelas.'}</small>
          </span>
          {admin && b.status === 'AGENDADO' && <button type="button" className="sm ghost text-danger" disabled={busy === b.id} onClick={() => cancelar(b)}>Cancelar</button>}
        </div>
      ))}
      {admin && canAdd && (open ? (
        <form className="cal-brinde-form" onSubmit={salvar}>
          <label>Brinde<input value={premio} onChange={(e) => setPremio(e.target.value)} placeholder="Ex.: boné, camiseta, celular" required minLength={2} maxLength={120} autoFocus /></label>
          {unit ? (
            <fieldset className="pix-types">
              <legend>Onde</legend>
              <label className={`pix-type${!todas ? ' selected' : ''}`}><input type="radio" checked={!todas} onChange={() => setTodas(false)} />{unit.code} · {unit.name}</label>
              <label className={`pix-type${todas ? ' selected' : ''}`}><input type="radio" checked={todas} onChange={() => setTodas(true)} />Todas as unidades</label>
            </fieldset>
          ) : <p className="muted">Vale para todas as unidades. Para uma loja só, escolha a unidade no filtro acima.</p>}
          <p className="muted">Concorre quem fizer 3 estrelas neste dia. O sorteio é às 9h do dia seguinte e todos veem o resultado; o ganhador é avisado no app e pelo WhatsApp.</p>
          <div className="row"><button className="primary sm" disabled={busy === 'brinde'}>Cadastrar brinde</button><button type="button" className="sm ghost" onClick={() => setOpen(false)}>Voltar</button></div>
        </form>
      ) : <button type="button" className="sm" onClick={() => setOpen(true)}><Icon name="gift" size={16} />Sortear um brinde neste dia</button>)}
    </div>
  );
}

/** Calendário do mês: outra forma de ver as vagas e atividades por data (gestor e admin, no escopo de lojas de cada um). */
export default function Calendario() {
  const today = todayBR();
  const { me } = useMe();
  const admin = me.user.role === 'ADMINISTRADOR';
  const [brindes, setBrindes] = useState<Brinde[]>([]);
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
  const loadBrindes = () => api<{ items: Brinde[] }>(`/manage/brindes?from=${grid[0]}&to=${grid.at(-1)}${unitId ? `&unitId=${unitId}` : ''}`).then((r) => setBrindes(r.items), () => {});
  useEffect(() => { loadBrindes(); }, [grid, unitId]);
  const unit = units.find((u) => u.id === unitId) ?? null;
  const brindesDia = (d: string) => (
    <BrindesDia key={`${d}-${unitId}`} day={d} items={brindes.filter((b) => b.day === d)} unit={unit} canAdd={d >= today} admin={admin} onChange={loadBrindes} />
  );

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
                  {open && <>{brindesDia(d)}<DayJobs jobs={jobs} /></>}
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
                    <span className="cal-num">{Number(d.slice(8))}{brindes.some((b) => b.day === d) && <span className="cal-brinde-dot" title="Sorteio de brinde"><Icon name="gift" size={13} /></span>}</span>
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
            {selected && brindesDia(selected)}
            {!selected ? <EmptyState icon="calendar" title="Clique num dia do calendário" /> : sel.length === 0 ? <EmptyState icon="calendar" title="Nenhuma vaga neste dia" /> : <DayJobs jobs={sel} />}
          </aside>
        </div>
      )}
    </div>
  );
}
