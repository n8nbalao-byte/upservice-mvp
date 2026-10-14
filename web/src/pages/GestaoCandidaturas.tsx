import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMe } from '../App';
import { api, fmtDateTime, fmtTime, label } from '../lib/api';

export default function GestaoCandidaturas() {
  const { id } = useParams();
  const { me } = useMe();
  const [data, setData] = useState<{ job: any; applications: any[] }>();
  const [error, setError] = useState('');

  const load = () => api(`/manage/jobs/${id}/applications`).then(setData, (e) => setError(e.message));
  useEffect(() => { load(); }, [id]);

  async function call(path: string, body: object) {
    setError('');
    await api(path, { body }).then(load, (e) => setError(e.message));
  }

  function cancel(appId: string) {
    const reason = prompt('Motivo do cancelamento (10 a 500 caracteres):');
    if (reason) call(`/manage/applications/${appId}/cancel`, { reason });
  }

  if (!data) return <p>{error || 'Carregando…'}</p>;
  const { job, applications } = data;
  const approved = applications.filter((a) => a.status === 'APROVADA').length;

  return (
    <div className="stack">
      <h1>{job.title}</h1>
      <p className="muted">{job.unit_name} · {fmtDateTime(job.starts_at)} até {fmtTime(job.ends_at)} · {approved}/{job.positions} aprovados · {label(job.status)}</p>
      {error && <p className="error">{error}</p>}
      {applications.length === 0 && <p className="muted">Nenhuma candidatura ainda.</p>}
      <div className="scroll">
        <table>
          <thead><tr><th>Profissional</th><th>Contato</th><th>Docs aprovados</th><th>Status</th><th></th></tr></thead>
          <tbody>
            {applications.map((a) => (
              <tr key={a.id}>
                <td><Link to={`/gestao/profissionais/${a.user_id}`}>{a.name}</Link></td>
                <td>{a.phone}<div className="muted">{a.city}/{a.uf}</div></td>
                <td>{a.docs_approved}/3</td>
                <td>{label(a.status)}{a.session_status && <div className="muted">{label(a.session_status)}</div>}</td>
                <td className="row">
                  {a.status === 'PENDENTE' && (
                    <>
                      <button className="primary" onClick={() => call(`/manage/applications/${a.id}/decide`, { decision: 'APROVADA' })}>Aprovar</button>
                      <button onClick={() => call(`/manage/applications/${a.id}/decide`, { decision: 'RECUSADA' })}>Recusar</button>
                    </>
                  )}
                  {a.status === 'APROVADA' && me.user.role === 'GESTOR' && a.session_status === 'AGUARDANDO_CHECKIN' && !a.confirmation && (
                    <button className="danger" onClick={() => cancel(a.id)}>Cancelar aprovação</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
