import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, fmtDateTime, fmtMoney, label } from '../lib/api';

export default function Minhas() {
  const [summary, setSummary] = useState<Record<string, number>>();
  const [apps, setApps] = useState<any[]>([]);
  const [error, setError] = useState('');

  const load = () => Promise.all([api('/me/summary').then(setSummary), api('/me/applications').then(setApps)]).catch((e) => setError(e.message));
  useEffect(() => { load(); }, []);

  async function cancel(id: string) {
    if (!confirm('Cancelar esta candidatura?')) return;
    await api(`/me/applications/${id}/cancel`, { body: {} }).then(load, (e) => setError(e.message));
  }

  return (
    <div>
      <h1>Minhas diárias</h1>
      {error && <p className="error">{error}</p>}
      {summary && (
        <div className="grid">
          <div className="card stat"><b>{summary.aprovadas}</b>cadastradas</div>
          <div className="card stat"><b>{summary.comparecidas}</b>comparecidas</div>
          <div className="card stat"><b>{summary.concluidas}</b>concluídas</div>
          <div className="card stat"><b>{fmtMoney(summary.valor)}</b>a receber</div>
        </div>
      )}
      <h2>Candidaturas</h2>
      {apps.length === 0 && <p className="muted">Você ainda não se candidatou a nenhuma vaga.</p>}
      {apps.map((a) => (
        <div key={a.id} className="card stack">
          <div className="row between">
            <b>{a.title}</b>
            <span className="badge">{label(a.confirmation ?? a.session_status ?? a.status)}</span>
          </div>
          <div>{a.unit_name} · {fmtDateTime(a.starts_at)} · {fmtMoney(a.daily_value)}</div>
          {a.cancel_reason && <div className="muted">Motivo do cancelamento: {a.cancel_reason}</div>}
          <div className="row">
            {a.status === 'APROVADA' && a.session_id && <Link className="button" to={`/atividade/${a.session_id}`}>Abrir atividade</Link>}
            {a.status === 'PENDENTE' && <button onClick={() => cancel(a.id)}>Cancelar candidatura</button>}
          </div>
        </div>
      ))}
    </div>
  );
}
