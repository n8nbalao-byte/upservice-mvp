import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMe } from '../App';
import { Alert, EmptyState, Loading, PageHeader, StatusBadge, reasonOpts, useAction, useDialog } from '../components/ui';
import { MensagemButton, Presenca } from '../components/Mensagem';
import { api, label, type Unit } from '../lib/api';

type User = { id: string; name: string; email: string; role: string; status: string; isOwner: boolean; unitIds: string[]; lastSeenAt: string | null };
const ROLES = ['PROFISSIONAL', 'GESTOR', 'ADMINISTRADOR'];
const STATUS = ['ATIVO', 'EM_ANALISE', 'BLOQUEADO_TEMPORARIAMENTE', 'BLOQUEADO_PERMANENTEMENTE', 'INATIVO'];
const FILTERS = [{ key: '', text: 'Todos' }, { key: 'PROFISSIONAL', text: 'Profissionais' }, { key: 'GESTOR', text: 'Gestores' }, { key: 'ADMINISTRADOR', text: 'Administradores' }];

/** Lojas de um gestor: busca e marcação, salvando a cada mudança. */
function UnitLinks({ user, units, onSaved }: { user: User; units: Unit[]; onSaved: () => void }) {
  const { busy, run } = useAction();
  const [filter, setFilter] = useState('');
  const shown = units.filter((u) => `${u.code} ${u.name}`.toLowerCase().includes(filter.toLowerCase()));
  async function toggle(unitId: string) {
    const unitIds = user.unitIds.includes(unitId) ? user.unitIds.filter((x) => x !== unitId) : [...user.unitIds, unitId];
    if (await run('units', () => api(`/admin/users/${user.id}/units`, { method: 'PUT', body: { unitIds } }), 'Lojas do gestor atualizadas.')) onSaved();
  }
  return (
    <div className="subpanel stack">
      <div className="row between"><b>Lojas de {user.name}</b><span className="muted">{user.unitIds.length} vinculada(s)</span></div>
      <input placeholder="Filtrar lojas por código ou nome" value={filter} onChange={(e) => setFilter(e.target.value)} />
      <div className="cols" style={{ maxHeight: 260, overflowY: 'auto', gap: 6 }}>
        {shown.map((u) => (
          <label key={u.id} className="check">
            <input type="checkbox" checked={user.unitIds.includes(u.id)} disabled={busy === 'units'} onChange={() => toggle(u.id)} /> {u.code} · {u.name}
          </label>
        ))}
      </div>
    </div>
  );
}

export default function AdminUsuarios() {
  const { me } = useMe();
  const { ask } = useDialog();
  const { busy, run } = useAction();
  const [users, setUsers] = useState<User[]>();
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [total, setTotal] = useState(0);
  const [units, setUnits] = useState<Unit[]>([]);
  const [search, setSearch] = useState('');
  const [role, setRole] = useState('');
  const [status, setStatus] = useState('');
  const [editing, setEditing] = useState('');
  const [error, setError] = useState('');

  type Lista = { items: User[]; total: number; counts: Record<string, number> };
  // Páginas de 100: busca, status e papel no servidor; "Carregar mais" acrescenta a próxima página.
  const fetchPage = (offset: number) => api<Lista>(`/admin/users?q=${encodeURIComponent(search)}&status=${status}&role=${role}&offset=${offset}`);
  const load = () => fetchPage(0).then((r) => { setUsers(r.items); setTotal(r.total); setCounts(r.counts); }, (e) => setError(e.message));
  const more = () => run('more', async () => { const r = await fetchPage(users?.length ?? 0); setUsers((u) => [...(u ?? []), ...r.items]); setTotal(r.total); setCounts(r.counts); });
  useEffect(() => { api<Unit[]>('/units').then(setUnits); }, []);
  useEffect(() => { const t = setTimeout(load, 300); return () => clearTimeout(t); }, [search, status, role]);

  async function update(u: User, change: { role?: string; status?: string }) {
    const what = change.role ? `papel para ${label(change.role)}` : `status para ${label(change.status)}`;
    const blocking = change.status?.startsWith('BLOQUEADO');
    const reason = await ask(reasonOpts(`Alterar ${what}?`, {
      message: blocking ? `${u.name}: o bloqueio vira penalidade (aviso por e-mail, vagas futuras liberadas e contestação).` : u.name,
      confirmText: 'Salvar alteração', tone: blocking ? 'danger' : 'primary',
    }));
    if (!reason) return;
    if (await run(u.id, () => api(`/admin/users/${u.id}`, { method: 'PATCH', body: { ...change, reason } }), 'Usuário atualizado.')) load();
  }

  // Exclusão: só o administrador principal (o servidor confere de novo). Duas confirmações: justificativa e "EXCLUIR".
  async function remove(u: User) {
    const reason = await ask(reasonOpts(`Excluir ${u.name}?`, {
      message: 'O acesso acaba na hora e os dados pessoais (nome, e-mail, CPF, documentos e selfies) são apagados. Diárias e registros de presença ficam anonimizados pelo prazo de retenção. Não dá para desfazer.',
      confirmText: 'Continuar', tone: 'danger',
    }));
    if (!reason) return;
    const typed = await ask({ title: 'Confirme a exclusão', label: 'Digite EXCLUIR para confirmar', requireText: 'EXCLUIR', confirmText: 'Excluir usuário', tone: 'danger' });
    if (!typed) return;
    if (await run(u.id, () => api(`/admin/users/${u.id}`, { method: 'DELETE', body: { reason } }), 'Usuário excluído.')) load();
  }

  const shown = users ?? [];
  return (
    <div className="page">
      <PageHeader title="Usuários" description="Gestores e administradores entram com Google; promova a conta aqui depois do primeiro acesso." />
      <div className="filters">
        <label style={{ maxWidth: 420 }}>Buscar<input placeholder="Nome ou e-mail" value={search} onChange={(e) => setSearch(e.target.value)} /></label>
        <label>Status
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">Todos</option>
            <option value="ATIVO">Ativos</option>
            <option value="EM_ANALISE">Em análise</option>
            <option value="BLOQUEADO">Bloqueados</option>
            <option value="INATIVO">Inativos</option>
          </select>
        </label>
      </div>
      {error && <Alert kind="danger">{error}</Alert>}
      <div className="card tight">
        <div className="tabs" role="tablist">
          {FILTERS.map((f) => (
            <button key={f.key} role="tab" aria-selected={role === f.key} className={`tab${role === f.key ? ' active' : ''}`} onClick={() => setRole(f.key)}>
              {f.text}<span className="count">{counts[f.key] ?? 0}</span>
            </button>
          ))}
        </div>
        {!users ? <Loading /> : shown.length === 0 ? <EmptyState icon="users" title="Nenhum usuário encontrado" text="Nenhum usuário com essa busca e esse status." /> : (
          <div className="table-wrap">
            <table className="responsive">
              <thead><tr><th>Usuário</th><th>Papel</th><th>Status</th><th>Lojas</th><th>Ações</th></tr></thead>
              <tbody>
                {shown.map((u) => {
                  // A própria conta, o principal e (para admin comum) outros admins não são alterados aqui; o servidor também recusa.
                  const isMe = u.id === me.user.id;
                  const locked = isMe || u.isOwner || (u.role === 'ADMINISTRADOR' && !me.user.isOwner);
                  return [
                    <tr key={u.id}>
                      <td data-label="Usuário"><span className="strong">{u.name}{isMe && ' (você)'}</span><span className="muted">{u.email}</span><Presenca lastSeenAt={u.lastSeenAt} /></td>
                      <td data-label="Papel">
                        {locked ? label(u.role) : (
                          <select value={u.role} onChange={(e) => update(u, { role: e.target.value })} aria-label={`Papel de ${u.name}`}>
                            {ROLES.map((r) => <option key={r} value={r} disabled={r === 'ADMINISTRADOR' && u.role !== 'ADMINISTRADOR' && !me.user.isOwner}>{label(r)}</option>)}
                          </select>
                        )}
                      </td>
                      <td data-label="Status">
                        {locked ? <StatusBadge status={u.status} /> : (
                          <select value={u.status} onChange={(e) => update(u, { status: e.target.value })} aria-label={`Status de ${u.name}`}>
                            {STATUS.map((s) => <option key={s} value={s}>{label(s)}</option>)}
                          </select>
                        )}
                      </td>
                      <td data-label="Lojas">{u.role === 'GESTOR' ? <button className="sm" onClick={() => setEditing(editing === u.id ? '' : u.id)}>{u.unitIds.length} loja(s) · {editing === u.id ? 'fechar' : 'editar'}</button> : <span className="muted">—</span>}</td>
                      <td data-label="Ações">
                        <div className="row">
                          {u.role === 'PROFISSIONAL' && <Link className="btn sm" to={`/gestao/profissionais/${u.id}`}>Ver perfil</Link>}
                          {u.role === 'PROFISSIONAL' && <MensagemButton id={u.id} name={u.name} className="sm ghost" />}
                          {u.isOwner && <span className="badge tone-accent plain">Administrador principal</span>}
                          {me.user.isOwner && !locked && <button className="sm ghost text-danger" onClick={() => remove(u)}>Excluir</button>}
                        </div>
                      </td>
                    </tr>,
                    editing === u.id && (
                      <tr key={`${u.id}-units`}><td colSpan={5}><UnitLinks user={u} units={units} onSaved={load} /></td></tr>
                    ),
                  ];
                })}
              </tbody>
            </table>
          </div>
        )}
        {users && users.length > 0 && (
          <div className="card-footer">
            <span className="muted">Mostrando {users.length} de {total}</span>
            {users.length < total && <button type="button" className="sm" disabled={busy === 'more'} onClick={more}>{busy === 'more' ? 'Carregando…' : `Carregar mais ${Math.min(100, total - users.length)}`}</button>}
          </div>
        )}
      </div>
      <p className="muted">Ninguém altera o próprio papel. Mudanças de papel e status exigem justificativa e ficam na auditoria.</p>
    </div>
  );
}
