import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api, fmtDateTime, label, type Me } from '../lib/api';

const DOC_NAME: Record<string, string> = { CPF: 'CPF', RG: 'RG', COMPROVANTE: 'Comprovante de residência' };

export default function GestaoProfissional() {
  const { id } = useParams();
  const [data, setData] = useState<Me>();
  const [error, setError] = useState('');

  const load = () => api<Me>(`/manage/workers/${id}`).then(setData, (e) => setError(e.message));
  useEffect(() => { load(); }, [id]);

  async function review(docId: string, status: 'APROVADO' | 'REJEITADO') {
    const reason = status === 'REJEITADO' ? prompt('Motivo da rejeição (o profissional verá):') : null;
    if (status === 'REJEITADO' && !reason) return;
    await api(`/manage/documents/${docId}/review`, { body: { status, reason } }).then(load, (e) => setError(e.message));
  }

  if (!data) return <p>{error || 'Carregando…'}</p>;
  const p = data.profile;
  return (
    <div className="stack">
      <h1>{data.user.name}</h1>
      {error && <p className="error">{error}</p>}
      <p className="notice">Dados pessoais e documentos: todo acesso fica registrado na auditoria.</p>
      <div className="card">
        <div><span className="badge">{label(data.user.status)}</span> {data.user.email}</div>
        {p ? (
          <table>
            <tbody>
              <tr><th>CPF</th><td>{p.cpf}</td></tr>
              <tr><th>RG</th><td>{p.rg}</td></tr>
              <tr><th>Telefone</th><td>{p.phone}</td></tr>
              <tr><th>Endereço</th><td>{p.address} · {p.city}/{p.uf}</td></tr>
              <tr><th>Emergência</th><td>{p.emergency_name} · {p.emergency_phone}</td></tr>
              <tr><th>Termos</th><td>{p.terms_accepted_at ? fmtDateTime(p.terms_accepted_at) : 'não aceitos'}</td></tr>
            </tbody>
          </table>
        ) : <p className="muted">Cadastro não preenchido.</p>}
      </div>
      <div className="card stack">
        <h2>Documentos</h2>
        {data.documents.length === 0 && <p className="muted">Nenhum documento enviado.</p>}
        {data.documents.map((d) => (
          <div key={d.id} className="row between">
            <span>
              <b>{DOC_NAME[d.type]}</b> <span className="badge">{label(d.status)}</span>
              {d.rejection_reason && <span className="muted"> · {d.rejection_reason}</span>}
            </span>
            <span className="row">
              <a className="button" href={`/api/files/doc/${d.id}`} target="_blank" rel="noreferrer">Ver</a>
              {d.status === 'PENDENTE' && (
                <>
                  <button className="primary" onClick={() => review(d.id, 'APROVADO')}>Aprovar</button>
                  <button className="danger" onClick={() => review(d.id, 'REJEITADO')}>Rejeitar</button>
                </>
              )}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
