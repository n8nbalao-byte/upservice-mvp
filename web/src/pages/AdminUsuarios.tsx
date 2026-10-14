import { useEffect, useState } from 'react';
import { useMe } from '../App';
import { api, label, type Unit } from '../lib/api';

type User = { id: string; name: string; email: string; role: string; status: string; unitIds: string[] };
const ROLES = ['PROFISSIONAL', 'GESTOR', 'ADMINISTRADOR'];
const STATUS = ['ATIVO', 'EM_ANALISE', 'BLOQUEADO_TEMPORARIAMENTE', 'BLOQUEADO_PERMANENTEMENTE', 'INATIVO'];

export default function AdminUsuarios() {
  const { me } = useMe();
  const [users, setUsers] = useState<User[]>([]);
  const [units, setUnits] = useState<Unit[]>([]);
  const [search, setSearch] = useState('');
  const [error, setError] = useState('');

  const load = () => api<User[]>(`/admin/users?q=${encodeURIComponent(search)}`).then(setUsers, (e) => setError(e.message));
  useEffect(() => { api<Unit[]>('/units').then(setUnits); }, []);
  useEffect(() => { const t = setTimeout(load, 300); return () => clearTimeout(t); }, [search]);

  async function update(u: User, change: { role?: string; status?: string }) {
    const reason = prompt(`Justificativa para alterar ${u.name} (10 a 500 caracteres):`);
    if (!reason) return load();
    await api(`/admin/users/${u.id}`, { method: 'PATCH', body: { ...change, reason } }).then(load, (e) => setError(e.message));
  }

  async function toggleUnit(u: User, unitId: string) {
    const unitIds = u.unitIds.includes(unitId) ? u.unitIds.filter((x) => x !== unitId) : [...u.unitIds, unitId];
    await api(`/admin/users/${u.id}/units`, { method: 'PUT', body: { unitIds } }).then(load, (e) => setError(e.message));
  }

  return (
    <div className="stack">
      <h1>Usuários</h1>
      <p className="muted">Gestores e administradores entram com Google; promova a conta aqui depois do primeiro acesso.</p>
      <input placeholder="Buscar por nome ou e-mail" value={search} onChange={(e) => setSearch(e.target.value)} />
      {error && <p className="error">{error}</p>}
      {users.map((u) => (
        <div key={u.id} className="card stack">
          <div className="row between"><b>{u.name}</b><span className="muted">{u.email}</span></div>
          {u.id === me.user.id ? (
            <p className="muted">Sua conta ({label(u.role)}). Ninguém altera o próprio papel.</p>
          ) : (
            <div className="cols">
              <label>Papel
                <select value={u.role} onChange={(e) => update(u, { role: e.target.value })}>
                  {ROLES.map((r) => <option key={r} value={r}>{label(r)}</option>)}
                </select>
              </label>
              <label>Status
                <select value={u.status} onChange={(e) => update(u, { status: e.target.value })}>
                  {STATUS.map((s) => <option key={s} value={s}>{label(s)}</option>)}
                </select>
              </label>
            </div>
          )}
          {u.role === 'GESTOR' && (
            <div className="row">
              <span className="muted">Unidades:</span>
              {units.map((un) => (
                <label key={un.id} className="check">
                  <input type="checkbox" checked={u.unitIds.includes(un.id)} onChange={() => toggleUnit(u, un.id)} /> {un.code}
                </label>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
