import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useInbox, useMe } from '../App';
import { Alert, EmptyState, Loading, PageHeader, Progress, StatusBadge, reasonOpts, useAction, useDialog } from '../components/ui';
import { api, fmtDateTime, fmtMoney, fmtTime, label } from '../lib/api';

export default function GestaoCandidaturas() {
  const { id } = useParams();
  const { me } = useMe();
  const { refresh: refreshInbox } = useInbox();
  const { ask, confirm } = useDialog();
  const { busy, run } = useAction();
  const [data, setData] = useState<{ job: any; applications: any[] }>();
  const [error, setError] = useState('');

  const load = () => api(`/manage/jobs/${id}/applications`).then(setData, (e) => setError(e.message));
  useEffect(() => { load(); }, [id]);

  async function decide(a: any, decision: 'APROVADA' | 'RECUSADA') {
    if (decision === 'RECUSADA' && !(await confirm({ title: `Recusar ${a.name}?`, message: 'A candidatura fica recusada e o profissional vê o status no app.', confirmText: 'Recusar', tone: 'danger' }))) return;
    await run(`${a.id}`, () => api(`/manage/applications/${a.id}/decide`, { body: { decision } }), decision === 'APROVADA' ? `${a.name} aprovado(a).` : 'Candidatura recusada.');
    load();
    refreshInbox();
  }

  async function cancel(a: any) {
    const reason = await ask(reasonOpts(`Cancelar a aprovação de ${a.name}?`, {
      message: 'A posição volta a ficar livre. O profissional vê o motivo no app.', confirmText: 'Cancelar aprovação', tone: 'danger',
    }));
    if (!reason) return;
    await run(`${a.id}`, () => api(`/manage/applications/${a.id}/cancel`, { body: { reason } }), 'Aprovação cancelada.');
    load();
  }

  if (!data) return error ? <Alert kind="danger">{error}</Alert> : <Loading />;
  const { job, applications } = data;
  const approved = applications.filter((a) => a.status === 'APROVADA').length;
  const pending = applications.filter((a) => a.status === 'PENDENTE');
  const full = approved >= job.positions;
  const order: Record<string, number> = { PENDENTE: 0, APROVADA: 1, RECUSADA: 2, CANCELADA: 3 };
  const sorted = [...applications].sort((x, y) => (order[x.status] ?? 9) - (order[y.status] ?? 9));

  return (
    <div className="page">
      <PageHeader
        back={{ to: '/gestao/vagas', label: 'Vagas' }}
        title={job.title}
        description={<>{job.unit_name} · {fmtDateTime(job.starts_at)} até {fmtTime(job.ends_at)} · {fmtMoney(job.daily_value)}</>}
        actions={<StatusBadge status={job.status} />}
      />
      <div className="card row between">
        <div style={{ minWidth: 220, flex: 1, maxWidth: 360 }}><Progress value={approved} total={job.positions} /></div>
        <span className="muted">{pending.length} pendente(s) · {applications.length} candidatura(s)</span>
      </div>
      {full && pending.length > 0 && <Alert kind="info">Todas as posições estão preenchidas. Para aprovar outra pessoa, cancele uma aprovação antes do check-in.</Alert>}
      {job.status !== 'ABERTA' && pending.length > 0 && <Alert kind="warning">A vaga está {label(job.status).toLowerCase()}: candidaturas pendentes não podem ser aprovadas.</Alert>}

      <div className="card tight">
        <div className="card-header"><h2>Candidaturas</h2><span className="sub">Documentos aprovados ajudam a decidir</span></div>
        {applications.length === 0 ? <EmptyState icon="users" title="Nenhuma candidatura ainda" text="Quando profissionais se candidatarem, eles aparecem aqui." /> : (
          <div className="table-wrap">
            <table className="responsive">
              <thead><tr><th>Profissional</th><th>Contato</th><th className="num">Documentos</th><th>Status</th><th>Ações</th></tr></thead>
              <tbody>
                {sorted.map((a) => (
                  <tr key={a.id}>
                    <td data-label="Profissional"><Link className="strong" to={`/gestao/profissionais/${a.user_id}`}>{a.name}</Link></td>
                    <td data-label="Contato"><span>{a.phone}</span><span className="muted">{a.city}/{a.uf}</span></td>
                    <td data-label="Documentos" className="num"><StatusBadge tone={Number(a.docs_approved) === 3 ? 'success' : 'warning'}>{a.docs_approved}/3</StatusBadge></td>
                    <td data-label="Status">
                      <StatusBadge status={a.status} />
                      {a.session_status && <span className="muted">{label(a.session_status)}</span>}
                    </td>
                    <td data-label="Ações">
                      <div className="row">
                        {a.status === 'PENDENTE' && (
                          <>
                            <button className="primary sm" disabled={!!busy || full || job.status !== 'ABERTA'} onClick={() => decide(a, 'APROVADA')}>Aprovar</button>
                            <button className="sm" disabled={!!busy} onClick={() => decide(a, 'RECUSADA')}>Recusar</button>
                          </>
                        )}
                        {a.status === 'APROVADA' && me.user.role === 'GESTOR' && a.session_status === 'AGUARDANDO_CHECKIN' && !a.confirmation && (
                          <button className="sm ghost text-danger" disabled={!!busy} onClick={() => cancel(a)}>Cancelar aprovação</button>
                        )}
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
