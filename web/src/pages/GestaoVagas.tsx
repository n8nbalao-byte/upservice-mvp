import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useMe } from '../App';
import { api, fmtDateTime, fmtMoney, fmtTime, label, todayBR, type Unit } from '../lib/api';

/** Seletor de unidade compartilhado pelas telas de gestão; lembra a última escolha. */
export function useUnitPicker(initialId?: string | null) {
  const [units, setUnits] = useState<Unit[]>([]);
  const [unitId, setUnitIdState] = useState(() => initialId || localStorage.getItem('unitId') || '');
  const setUnitId = (id: string) => { localStorage.setItem('unitId', id); setUnitIdState(id); };
  useEffect(() => {
    api<Unit[]>('/units').then((list) => {
      setUnits(list);
      if (!list.some((u) => u.id === unitId)) setUnitId(list[0]?.id ?? '');
    });
  }, []);
  const picker = (
    <label>Unidade
      <select value={unitId} onChange={(e) => setUnitId(e.target.value)}>
        {units.map((u) => <option key={u.id} value={u.id}>{u.code} · {u.name}{u.status !== 'ATIVA' ? ` (${label(u.status)})` : ''}</option>)}
      </select>
    </label>
  );
  return { units, unitId, unit: units.find((u) => u.id === unitId), picker };
}

export default function GestaoVagas() {
  const { me } = useMe();
  const { units, unitId, unit, picker } = useUnitPicker();
  const [jobs, setJobs] = useState<any[]>([]);
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);

  const load = async () => { if (unitId) await api(`/manage/jobs?unitId=${unitId}`).then(setJobs, (e) => setError(e.message)); };
  useEffect(() => { load(); }, [unitId]);

  async function create(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;
    setError('');
    try {
      const startsAt = new Date(`${f.date}T${f.start}`);
      const endsAt = new Date(`${f.date}T${f.end}`);
      if (endsAt <= startsAt) endsAt.setDate(endsAt.getDate() + 1); // turno que vira a noite
      await api('/manage/jobs', {
        body: { unitId, title: f.title, description: f.description, startsAt, endsAt, positions: f.positions, dailyValue: f.dailyValue, breakCount: f.breakCount, breakMinutes: f.breakMinutes, publish: f.publish === 'on' },
      });
      setCreating(false);
      load();
    } catch (err: any) {
      setError(err.message);
    }
  }

  async function setStatus(id: string, status: string) {
    if (status === 'CANCELADA' && !confirm('Cancelar esta vaga?')) return;
    await api(`/manage/jobs/${id}/status`, { body: { status } }).then(load, (e) => setError(e.message));
  }

  if (!units.length) return <p className="muted">Nenhuma unidade vinculada à sua conta. Peça a um administrador.</p>;

  return (
    <div className="stack">
      <h1>Vagas</h1>
      <div className="row between">{picker}<button className="primary" onClick={() => setCreating(!creating)}>Nova vaga</button></div>
      {error && <p className="error">{error}</p>}
      {unit && unit.status !== 'ATIVA' && <p className="notice">Unidade {label(unit.status)}: não recebe novas vagas. {unit.status_reason}</p>}

      {creating && (
        <form className="card stack" onSubmit={create}>
          <div className="cols">
            <label>Título<input name="title" required defaultValue="Repositor" /></label>
            <label>Data<input name="date" type="date" required defaultValue={todayBR()} /></label>
            <label>Início<input name="start" type="time" required defaultValue="08:00" /></label>
            <label>Término<input name="end" type="time" required defaultValue="17:00" /></label>
            <label>Posições<input name="positions" type="number" min={1} max={500} required defaultValue={1} /></label>
            <label>Valor da diária (R$)<input name="dailyValue" type="number" min={0} step="0.01" required /></label>
            <label>Quantidade de pausas<input name="breakCount" type="number" min={0} max={3} required defaultValue={1} /></label>
            <label>Duração de cada pausa (min)<input name="breakMinutes" type="number" min={1} max={120} required defaultValue={15} /></label>
          </div>
          <label>Descrição<textarea name="description" rows={2} maxLength={1000} /></label>
          <label className="check"><input name="publish" type="checkbox" defaultChecked /> Publicar agora</label>
          <button className="primary">Criar vaga</button>
        </form>
      )}

      {jobs.length === 0 && <p className="muted">Nenhuma vaga nesta unidade.</p>}
      {jobs.map((j) => (
        <div key={j.id} className="card stack">
          <div className="row between"><b>{j.title}</b><span className="badge">{label(j.status)}</span></div>
          <div>{fmtDateTime(j.starts_at)} até {fmtTime(j.ends_at)} · {fmtMoney(j.daily_value)}</div>
          <div className="muted">{j.approved}/{j.positions} aprovados · {j.pending} pendente(s) · {j.break_count} pausa(s) de {j.break_minutes} min</div>
          <div className="row">
            <Link className="button" to={`/gestao/vagas/${j.id}`}>Candidaturas</Link>
            {j.status === 'RASCUNHO' && <button onClick={() => setStatus(j.id, 'ABERTA')}>Publicar</button>}
            {j.status === 'ABERTA' && <button onClick={() => setStatus(j.id, 'ENCERRADA')}>Encerrar</button>}
            {j.status === 'ENCERRADA' && me.user.role === 'ADMINISTRADOR' && <button onClick={() => setStatus(j.id, 'ABERTA')}>Reabrir</button>}
            {(j.status === 'RASCUNHO' || j.status === 'ABERTA') && <button className="danger" onClick={() => setStatus(j.id, 'CANCELADA')}>Cancelar</button>}
          </div>
        </div>
      ))}
    </div>
  );
}
