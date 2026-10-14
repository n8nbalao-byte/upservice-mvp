import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useInbox } from '../App';
import { api, fmtDate, fmtDateTime, label } from '../lib/api';

type Data = { occurrences: any[]; contestations: any[]; penalties: any[] };

export default function GestaoOcorrencias() {
  const { refresh: refreshInbox } = useInbox();
  const [data, setData] = useState<Data>();
  const [error, setError] = useState('');

  const load = () => api<Data>('/manage/occurrences').then(setData, (e) => setError(e.message));
  useEffect(() => {
    load();
    const t = setInterval(load, 20000);
    return () => clearInterval(t);
  }, []);

  async function act(path: string, body: object) {
    setError('');
    await api(path, { body }).then(() => { load(); refreshInbox(); }, (e) => setError(e.message));
  }
  const ask = (msg: string) => prompt(`${msg} (justificativa de 10 a 500 caracteres):`);

  function decideOccurrence(id: string, decision: string) {
    const reason = ask(decision === 'CONFIRMADA' ? 'Confirmar ocorrência' : 'Cancelar ocorrência');
    if (reason) act(`/manage/occurrences/${id}/decide`, { decision, reason });
  }

  function decideContestation(c: any, decision: string) {
    let newEndsAt;
    if (decision === 'AJUSTADA') {
      const day = prompt('Novo último dia do bloqueio (AAAA-MM-DD):', c.penalty_ends_at ? new Date(c.penalty_ends_at).toISOString().slice(0, 10) : '');
      if (!day) return;
      newEndsAt = new Date(`${day}T23:59:59-03:00`).toISOString();
    }
    const reason = ask({ MANTIDA: 'Manter a punição', CANCELADA: 'Cancelar a punição', AJUSTADA: 'Ajustar o prazo' }[decision]!);
    if (reason) act(`/manage/contestations/${c.id}/decide`, { decision, reason, newEndsAt });
  }

  function endPenalty(p: any) {
    const reason = ask(`Reativar ${p.worker_name}`);
    if (reason) act(`/manage/penalties/${p.id}/end`, { reason });
  }

  if (!data) return <p>{error || 'Carregando…'}</p>;
  return (
    <div className="stack">
      <h1>Ocorrências</h1>
      {error && <p className="error">{error}</p>}

      <h2>Contestações em análise <span className="badge">{data.contestations.length}</span></h2>
      {data.contestations.length === 0 && <p className="muted">Nenhuma contestação aberta.</p>}
      {data.contestations.map((c) => (
        <div key={c.id} className="card stack">
          <div className="row between"><b>{c.protocol} · <Link to={`/gestao/profissionais/${c.user_id}`}>{c.worker_name}</Link></b><span className="muted">{label(c.channel)} · {fmtDateTime(c.created_at)}</span></div>
          <div className="muted">
            Sobre: {c.penalty_id ? `${label(c.penalty_type)} — ${c.penalty_reason}${c.penalty_ends_at ? ` (até ${fmtDate(c.penalty_ends_at)})` : ''}` : `${label(c.occurrence_type)}${c.occurrence_description ? ` — ${c.occurrence_description}` : ''}`}
          </div>
          <div>“{c.message}”</div>
          <div className="row">
            <button onClick={() => decideContestation(c, 'MANTIDA')}>Manter punição</button>
            <button className="primary" onClick={() => decideContestation(c, 'CANCELADA')}>Cancelar punição</button>
            {c.penalty_type === 'BLOQUEIO_TEMPORARIO' && <button onClick={() => decideContestation(c, 'AJUSTADA')}>Ajustar prazo</button>}
          </div>
        </div>
      ))}

      <h2>Ocorrências a confirmar <span className="badge">{data.occurrences.length}</span></h2>
      <p className="muted">Geradas automaticamente (pausa excedida, checkout ausente). Cancele se foi falha técnica: falha de GPS, câmera ou internet não deve virar punição.</p>
      {data.occurrences.length === 0 && <p className="muted">Nenhuma ocorrência pendente.</p>}
      {data.occurrences.map((o) => (
        <div key={o.id} className="card stack">
          <div className="row between"><b>{label(o.type)} · <Link to={`/gestao/profissionais/${o.user_id}`}>{o.worker_name}</Link></b><span className="muted">{o.unit_name} · {fmtDateTime(o.created_at)}</span></div>
          {o.description && <div className="muted">{o.description}</div>}
          <div className="row">
            <button className="primary" onClick={() => decideOccurrence(o.id, 'CONFIRMADA')}>Confirmar</button>
            <button onClick={() => decideOccurrence(o.id, 'CANCELADA')}>Cancelar</button>
          </div>
        </div>
      ))}

      <h2>Bloqueios ativos <span className="badge">{data.penalties.length}</span></h2>
      {data.penalties.length === 0 && <p className="muted">Ninguém bloqueado.</p>}
      {data.penalties.map((p) => (
        <div key={p.id} className="card row between">
          <span>
            <b><Link to={`/gestao/profissionais/${p.user_id}`}>{p.worker_name}</Link></b> · {label(p.type)}
            <div className="muted">{p.reason} · {p.ends_at ? `até ${fmtDateTime(p.ends_at)}` : 'sem prazo'}</div>
          </span>
          <button onClick={() => endPenalty(p)}>Reativar</button>
        </div>
      ))}
    </div>
  );
}
