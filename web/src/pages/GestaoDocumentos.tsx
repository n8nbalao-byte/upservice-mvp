import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMe } from '../App';
import { api, fmtDateTime } from '../lib/api';

type Pending = { id: string; name: string; email: string; pending: number; oldest: string };

export default function GestaoDocumentos() {
  const { me } = useMe();
  const [rows, setRows] = useState<Pending[]>();
  const [error, setError] = useState('');

  useEffect(() => { api<Pending[]>('/manage/documents/pending').then(setRows, (e) => setError(e.message)); }, []);

  return (
    <div className="stack">
      <h1>Documentos pendentes</h1>
      <p className="muted">
        {me.user.role === 'ADMINISTRADOR' ? 'Todos os profissionais' : 'Profissionais que se candidataram nas suas lojas'}, do envio mais antigo para o mais recente.
      </p>
      {error && <p className="error">{error}</p>}
      {rows?.length === 0 && <p className="notice">Nenhum documento pendente.</p>}
      {!!rows?.length && (
        <div className="scroll">
          <table>
            <thead><tr><th>Profissional</th><th>Pendentes</th><th>Desde</th><th></th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>{r.name}<div className="muted">{r.email}</div></td>
                  <td>{r.pending}</td>
                  <td>{fmtDateTime(r.oldest)}</td>
                  <td><Link className="button" to={`/gestao/profissionais/${r.id}`}>Analisar</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
