import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMe } from '../App';
import { Alert, EmptyState, Loading, PageHeader, StatusBadge } from '../components/ui';
import { api, fmtDateTime } from '../lib/api';

type Pending = { id: string; name: string; email: string; pending: number; oldest: string };
const PAGE = 50;
const DAY = 86400e3;

export default function GestaoDocumentos() {
  const { me } = useMe();
  const [rows, setRows] = useState<Pending[]>();
  const [search, setSearch] = useState('');
  const [visible, setVisible] = useState(PAGE);
  const [error, setError] = useState('');

  useEffect(() => { api<Pending[]>('/manage/documents/pending').then(setRows, (e) => setError(e.message)); }, []);

  const term = search.trim().toLowerCase();
  const shown = (rows ?? []).filter((r) => !term || `${r.name} ${r.email}`.toLowerCase().includes(term));

  return (
    <div className="page">
      <PageHeader
        title="Documentos pendentes"
        description={`${me.user.role === 'ADMINISTRADOR' ? 'Todos os profissionais' : 'Profissionais que se candidataram nas suas lojas'}, do envio mais antigo para o mais recente.`}
      />
      {error && <Alert kind="danger">{error}</Alert>}
      <div className="filters"><label style={{ maxWidth: 420 }}>Buscar<input placeholder="Nome ou e-mail" value={search} onChange={(e) => { setSearch(e.target.value); setVisible(PAGE); }} /></label></div>
      <div className="card tight">
        <div className="card-header"><h2>Aguardando análise</h2><span className="sub">{rows ? `${rows.length} profissional(is)` : ''}</span></div>
        {!rows ? <Loading /> : shown.length === 0 ? (
          <EmptyState title={rows.length ? 'Ninguém encontrado' : 'Nenhum documento pendente'} text={rows.length ? undefined : 'Todos os documentos enviados já foram analisados.'} />
        ) : (
          <div className="table-wrap">
            <table className="responsive">
              <thead><tr><th>Profissional</th><th className="num">Pendentes</th><th>Enviado em</th><th>Ações</th></tr></thead>
              <tbody>
                {shown.slice(0, visible).map((r) => {
                  const waiting = Date.now() - new Date(r.oldest).getTime();
                  return (
                    <tr key={r.id}>
                      <td data-label="Profissional"><span className="strong">{r.name}</span><span className="muted">{r.email}</span></td>
                      <td data-label="Pendentes" className="num">{r.pending}</td>
                      <td data-label="Enviado em">
                        <span className="nowrap">{fmtDateTime(r.oldest)}</span>
                        {waiting > 2 * DAY && <StatusBadge tone="warning">há {Math.floor(waiting / DAY)} dias</StatusBadge>}
                      </td>
                      <td data-label="Ações"><Link className="btn sm dark" to={`/gestao/profissionais/${r.id}`}>Analisar</Link></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {shown.length > visible && (
          <div className="card-footer"><span className="muted">Mostrando {visible} de {shown.length}</span><button className="sm" onClick={() => setVisible(visible + PAGE)}>Mostrar mais</button></div>
        )}
      </div>
    </div>
  );
}
