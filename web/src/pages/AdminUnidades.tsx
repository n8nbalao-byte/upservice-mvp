import { useEffect, useState, type FormEvent } from 'react';
import { api, label, type Unit } from '../lib/api';

export default function AdminUnidades() {
  const [units, setUnits] = useState<Unit[]>([]);
  const [editing, setEditing] = useState<Partial<Unit> | null>(null);
  const [error, setError] = useState('');

  const load = () => api<Unit[]>('/units').then(setUnits, (e) => setError(e.message));
  useEffect(() => { load(); }, []);

  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const body = Object.fromEntries(new FormData(e.currentTarget));
    setError('');
    try {
      if (editing?.id) await api(`/units/${editing.id}`, { method: 'PUT', body });
      else await api('/units', { body });
      setEditing(null);
      load();
    } catch (err: any) {
      setError(err.message);
    }
  }

  async function setStatus(u: Unit, status: string) {
    const reason = prompt(`Justificativa para mudar ${u.code} para "${label(status)}" (10 a 500 caracteres):`);
    if (reason) await api(`/units/${u.id}/status`, { body: { status, reason } }).then(load, (e) => setError(e.message));
  }

  return (
    <div className="stack">
      <div className="row between"><h1>Unidades</h1><button className="primary" onClick={() => setEditing({})}>Nova unidade</button></div>
      {error && <p className="error">{error}</p>}

      {editing && (
        <form className="card stack" onSubmit={save} key={editing.id ?? 'new'}>
          <div className="cols">
            <label>Código<input name="code" defaultValue={editing.code} placeholder="ATC-001" required /></label>
            <label>Nome<input name="name" defaultValue={editing.name} required /></label>
            <label>Região<input name="region" defaultValue={editing.region ?? ''} /></label>
            <label>Endereço<input name="address" defaultValue={editing.address} required /></label>
            <label>Latitude<input name="lat" type="number" step="any" defaultValue={editing.lat} required /></label>
            <label>Longitude<input name="lng" type="number" step="any" defaultValue={editing.lng} required /></label>
            <label>Raio de presença (m)<input name="radiusM" type="number" min={100} max={500} defaultValue={editing.radius_m ?? 300} required /></label>
            <label>Precisão GPS máxima (m)<input name="maxAccuracyM" type="number" min={10} max={500} defaultValue={editing.max_accuracy_m ?? 100} required /></label>
          </div>
          <p className="muted">Dica: no Google Maps, clique com o botão direito na entrada da loja para copiar latitude e longitude.</p>
          <div className="row"><button className="primary">Salvar</button><button type="button" onClick={() => setEditing(null)}>Cancelar</button></div>
        </form>
      )}

      <div className="scroll">
        <table>
          <thead><tr><th>Código</th><th>Nome</th><th>Raio</th><th>Status</th><th></th></tr></thead>
          <tbody>
            {units.map((u) => (
              <tr key={u.id}>
                <td>{u.code}</td>
                <td>{u.name}<div className="muted">{u.address}</div></td>
                <td>{u.radius_m} m</td>
                <td>{label(u.status)}{u.status_reason && <div className="muted">{u.status_reason}</div>}</td>
                <td className="row">
                  <button onClick={() => setEditing(u)}>Editar</button>
                  {u.status !== 'ATIVA' && <button onClick={() => setStatus(u, 'ATIVA')}>Reativar</button>}
                  {u.status === 'ATIVA' && <button className="danger" onClick={() => setStatus(u, 'BLOQUEADA_FINANCEIRA')}>Bloquear (financeiro)</button>}
                  {u.status !== 'INATIVA' && <button onClick={() => setStatus(u, 'INATIVA')}>Inativar</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
