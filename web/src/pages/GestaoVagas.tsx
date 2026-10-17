import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useMe } from '../App';
import { Icon } from '../components/icons';
import { Alert, EmptyState, Loading, PageHeader, Progress, StatusBadge, useAction, useDialog } from '../components/ui';
import { api, fmtMoney, fmtTime, label, todayBR, type Unit } from '../lib/api';

const store = {
  get: (k: string) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* sem armazenamento */ } },
};

/** Seletor de unidade compartilhado pelas telas de gestão; lembra a última escolha. */
export function useUnitPicker(initialId?: string | null) {
  const [units, setUnits] = useState<Unit[]>();
  const [unitId, setUnitIdState] = useState(() => initialId || store.get('unitId') || '');
  const setUnitId = (id: string) => { store.set('unitId', id); setUnitIdState(id); };
  useEffect(() => {
    api<Unit[]>('/units').then((list) => {
      setUnits(list);
      if (!list.some((u) => u.id === unitId)) setUnitId(list[0]?.id ?? '');
    });
  }, []);
  const picker = (
    <label>Unidade
      <select value={unitId} onChange={(e) => setUnitId(e.target.value)}>
        {(units ?? []).map((u) => <option key={u.id} value={u.id}>{u.code} · {u.name}{u.status !== 'ATIVA' ? ` (${label(u.status)})` : ''}</option>)}
      </select>
    </label>
  );
  return { units: units ?? [], loaded: !!units, unitId, unit: units?.find((u) => u.id === unitId), picker };
}

const TABS = [
  { key: 'ABERTA', text: 'Abertas' },
  { key: 'RASCUNHO', text: 'Rascunhos' },
  { key: 'ENCERRADA', text: 'Encerradas' },
  { key: 'CANCELADA', text: 'Canceladas' },
  { key: '', text: 'Todas' },
];
const dateBR = (s: string) => new Date(s).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo', weekday: 'short', day: '2-digit', month: '2-digit' });

function NewJob({ unitId, onDone, onCancel }: { unitId: string; onDone: () => void; onCancel: () => void }) {
  const { busy, run } = useAction();
  // Vaga de caixa: marcada sozinha quando o título tem "caixa"; o gestor pode mudar.
  const [title, setTitle] = useState('Repositor');
  const [cashier, setCashier] = useState<boolean | null>(null);
  const isCashier = cashier ?? /\bcaixa\b/i.test(title);
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;
    const startsAt = new Date(`${f.date}T${f.start}`);
    const endsAt = new Date(`${f.date}T${f.end}`);
    if (endsAt <= startsAt) endsAt.setDate(endsAt.getDate() + 1); // turno que vira a noite
    run('create', () => api('/manage/jobs', {
      body: { unitId, title: f.title, description: f.description, startsAt, endsAt, positions: f.positions, dailyValue: f.dailyValue, breakCount: f.breakCount, breakMinutes: f.breakMinutes, publish: f.publish === 'on', isCashier },
    }), f.publish === 'on' ? 'Vaga publicada.' : 'Rascunho salvo.').then((ok) => ok && onDone());
  }
  return (
    <form className="card form" onSubmit={submit}>
      <div className="card-header"><h2>Nova vaga</h2><span className="sub">Todos os horários no fuso de Brasília</span></div>
      <div className="cols">
        <label>Título<input name="title" required value={title} onChange={(e) => setTitle(e.target.value)} /></label>
        <label>Data<input name="date" type="date" required defaultValue={todayBR()} /></label>
        <label>Início<input name="start" type="time" required defaultValue="08:00" /></label>
        <label>Término<input name="end" type="time" required defaultValue="17:00" /><span className="hint">Antes do início = termina no dia seguinte</span></label>
      </div>
      <div className="cols">
        <label>Posições<input name="positions" type="number" min={1} max={500} required defaultValue={1} /></label>
        <label>Valor da diária (R$)<input name="dailyValue" type="number" min={0} step="0.01" required placeholder="0,00" /></label>
        <label>Quantidade de pausas<input name="breakCount" type="number" min={0} max={3} required defaultValue={1} /></label>
        <label>Duração de cada pausa (min)<input name="breakMinutes" type="number" min={1} max={120} required defaultValue={15} /></label>
      </div>
      <label>Descrição <span className="hint">(opcional)</span><textarea name="description" rows={2} maxLength={1000} placeholder="Atividades, uniforme, ponto de encontro…" /></label>
      <label className="check"><input type="checkbox" checked={isCashier} onChange={(e) => setCashier(e.target.checked)} /> Vaga de caixa (pode haver quebra de caixa: a diferença do caixa no fim do expediente é abatida da diária)</label>
      <div className="row between">
        <label className="check"><input name="publish" type="checkbox" defaultChecked /> Publicar agora (profissionais já podem se candidatar)</label>
        <div className="row">
          <button type="button" onClick={onCancel}>Cancelar</button>
          <button className="primary" disabled={busy === 'create'}>{busy === 'create' ? 'Salvando…' : 'Criar vaga'}</button>
        </div>
      </div>
    </form>
  );
}

export default function GestaoVagas() {
  const { me } = useMe();
  const { confirm } = useDialog();
  const { busy, run } = useAction();
  const { units, loaded, unitId, unit, picker } = useUnitPicker();
  const [jobs, setJobs] = useState<any[]>();
  const [tab, setTab] = useState('ABERTA');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');

  const load = async () => { if (unitId) await api<any[]>(`/manage/jobs?unitId=${unitId}`).then(setJobs, (e) => setError(e.message)); };
  useEffect(() => { setJobs(undefined); load(); }, [unitId]);

  async function setStatus(j: any, status: string) {
    if (status === 'CANCELADA') {
      const ok = await confirm({
        title: 'Cancelar esta vaga?',
        message: `${j.title} · ${dateBR(j.starts_at)} ${fmtTime(j.starts_at)}. A vaga sai da vitrine; candidaturas aprovadas não são canceladas automaticamente.`,
        confirmText: 'Cancelar vaga', tone: 'danger',
      });
      if (!ok) return;
    }
    const done = { ABERTA: 'Vaga publicada.', ENCERRADA: 'Vaga encerrada.', CANCELADA: 'Vaga cancelada.' }[status];
    await run(`${j.id}:${status}`, () => api(`/manage/jobs/${j.id}/status`, { body: { status } }), done);
    load();
  }

  if (loaded && !units.length) {
    return <div className="page"><PageHeader title="Vagas" /><div className="card"><EmptyState icon="store" title="Nenhuma unidade vinculada" text="Peça a um administrador para vincular sua conta a uma ou mais lojas." /></div></div>;
  }

  const count = (key: string) => (jobs ?? []).filter((j) => !key || j.status === key).length;
  const shown = (jobs ?? []).filter((j) => !tab || j.status === tab);

  return (
    <div className="page">
      <PageHeader
        title="Vagas"
        description="Publique vagas e acompanhe o preenchimento de cada uma."
        actions={<>
          <Link className="btn" to="/gestao/vagas/importar"><Icon name="download" size={18} />Importar escala</Link>
          <button className="primary" onClick={() => setCreating(true)} disabled={unit?.status !== 'ATIVA'}><Icon name="plus" size={18} />Nova vaga</button>
        </>}
      />
      <div className="filters">{picker}</div>
      {error && <Alert kind="danger">{error}</Alert>}
      {unit && unit.status !== 'ATIVA' && <Alert kind="warning">Unidade {label(unit.status).toLowerCase()}: não recebe novas vagas.{unit.status_reason && ` Motivo: ${unit.status_reason}`}</Alert>}

      {creating && unitId && <NewJob unitId={unitId} onCancel={() => setCreating(false)} onDone={() => { setCreating(false); setTab('ABERTA'); load(); }} />}

      <div className="card tight">
        <div className="tabs" role="tablist">
          {TABS.map((t) => (
            <button key={t.key} role="tab" aria-selected={tab === t.key} className={`tab${tab === t.key ? ' active' : ''}`} onClick={() => setTab(t.key)}>
              {t.text}<span className="count">{count(t.key)}</span>
            </button>
          ))}
        </div>
        {!jobs ? <Loading /> : shown.length === 0 ? (
          <EmptyState icon="briefcase" title={tab ? `Nenhuma vaga ${TABS.find((t) => t.key === tab)?.text.toLowerCase()}` : 'Nenhuma vaga nesta unidade'} text="Crie uma vaga para começar a receber candidaturas." />
        ) : (
          <div className="table-wrap">
            <table className="responsive">
              <thead>
                <tr><th>Data</th><th>Vaga</th><th>Preenchimento</th><th className="num">Pendentes</th><th className="num">Diária</th><th>Status</th><th>Ações</th></tr>
              </thead>
              <tbody>
                {shown.map((j) => (
                  <tr key={j.id}>
                    <td data-label="Data"><span className="strong">{dateBR(j.starts_at)}</span><span className="muted">{fmtTime(j.starts_at)}–{fmtTime(j.ends_at)}</span></td>
                    <td data-label="Vaga"><span className="strong">{j.title}</span><span className="muted">{j.break_count ? `${j.break_count} pausa(s) de ${j.break_minutes} min` : 'Sem pausas'}</span></td>
                    <td data-label="Preenchimento"><Progress value={Number(j.approved)} total={j.positions} /></td>
                    <td data-label="Pendentes" className="num">{Number(j.pending) > 0 ? <StatusBadge tone="warning">{j.pending}</StatusBadge> : <span className="muted">0</span>}</td>
                    <td data-label="Diária" className="num">{fmtMoney(j.daily_value)}</td>
                    <td data-label="Status"><StatusBadge status={j.status} /></td>
                    <td data-label="Ações">
                      <div className="row">
                        <Link className="btn sm dark" to={`/gestao/vagas/${j.id}`}>Candidaturas{Number(j.pending) > 0 && ` (${j.pending})`}</Link>
                        {j.status === 'RASCUNHO' && <button className="sm" disabled={!!busy} onClick={() => setStatus(j, 'ABERTA')}>Publicar</button>}
                        {j.status === 'ABERTA' && <button className="sm" disabled={!!busy} onClick={() => setStatus(j, 'ENCERRADA')}>Encerrar</button>}
                        {j.status === 'ENCERRADA' && me.user.role === 'ADMINISTRADOR' && <button className="sm" disabled={!!busy} onClick={() => setStatus(j, 'ABERTA')}>Reabrir</button>}
                        {(j.status === 'RASCUNHO' || j.status === 'ABERTA') && <button className="sm ghost text-danger" disabled={!!busy} onClick={() => setStatus(j, 'CANCELADA')}>Cancelar</button>}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
