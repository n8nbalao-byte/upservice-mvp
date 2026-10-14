import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useInbox } from '../App';
import { Alert, EmptyState, Loading, PageHeader, Stat, StatusBadge, reasonOpts, useAction, useDialog } from '../components/ui';
import { api, fmtDate, fmtDateTime, label } from '../lib/api';

type Data = { occurrences: any[]; contestations: any[]; penalties: any[] };

export default function GestaoOcorrencias() {
  const { refresh: refreshInbox } = useInbox();
  const { ask } = useDialog();
  const { busy, run } = useAction();
  const [data, setData] = useState<Data>();
  const [error, setError] = useState('');

  const load = () => api<Data>('/manage/occurrences').then(setData, (e) => setError(e.message));
  useEffect(() => {
    load();
    const t = setInterval(load, 20000);
    return () => clearInterval(t);
  }, []);

  async function act(key: string, path: string, body: object, done: string) {
    if (await run(key, () => api(path, { body }), done)) { load(); refreshInbox(); }
  }

  async function decideOccurrence(o: any, decision: 'CONFIRMADA' | 'CANCELADA') {
    const confirmIt = decision === 'CONFIRMADA';
    const reason = await ask(reasonOpts(confirmIt ? `Confirmar ${label(o.type).toLowerCase()} de ${o.worker_name}?` : 'Cancelar esta ocorrência?', {
      message: confirmIt ? 'O profissional recebe um aviso por e-mail e pode contestar.' : 'Use quando foi falha técnica ou engano. Não gera punição.',
      confirmText: confirmIt ? 'Confirmar ocorrência' : 'Cancelar ocorrência', tone: confirmIt ? 'danger' : 'primary',
    }));
    if (reason) act(o.id, `/manage/occurrences/${o.id}/decide`, { decision, reason }, confirmIt ? 'Ocorrência confirmada.' : 'Ocorrência cancelada.');
  }

  async function decideContestation(c: any, decision: 'MANTIDA' | 'CANCELADA' | 'AJUSTADA') {
    let newEndsAt;
    if (decision === 'AJUSTADA') {
      const day = await ask({
        title: 'Novo fim do bloqueio', label: 'Último dia do bloqueio', type: 'date',
        initial: c.penalty_ends_at ? new Date(c.penalty_ends_at).toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' }) : '',
        message: 'Se a data já passou, o bloqueio é encerrado na hora.', confirmText: 'Continuar',
      });
      if (!day) return;
      newEndsAt = new Date(`${day}T23:59:59-03:00`).toISOString();
    }
    const titles = { MANTIDA: 'Manter a punição?', CANCELADA: 'Cancelar a punição?', AJUSTADA: 'Ajustar o prazo do bloqueio?' };
    const reason = await ask(reasonOpts(`${titles[decision]} (${c.protocol})`, {
      message: 'O profissional recebe a decisão no app e por e-mail.',
      confirmText: { MANTIDA: 'Manter', CANCELADA: 'Cancelar punição', AJUSTADA: 'Ajustar prazo' }[decision],
    }));
    if (reason) act(c.id, `/manage/contestations/${c.id}/decide`, { decision, reason, newEndsAt }, 'Contestação decidida.');
  }

  async function endPenalty(p: any) {
    const reason = await ask(reasonOpts(`Reativar ${p.worker_name}?`, { message: 'O profissional volta a poder se candidatar e recebe um aviso.', confirmText: 'Reativar' }));
    if (reason) act(p.id, `/manage/penalties/${p.id}/end`, { reason }, `${p.worker_name} reativado(a).`);
  }

  if (!data) return error ? <Alert kind="danger">{error}</Alert> : <Loading />;
  return (
    <div className="page">
      <PageHeader title="Ocorrências" description="Contestações, ocorrências a confirmar e bloqueios ativos das suas lojas." />
      {error && <Alert kind="danger">{error}</Alert>}
      <div className="stats">
        <Stat label="Contestações em análise" value={data.contestations.length} tone={data.contestations.length ? 'warning' : 'neutral'} />
        <Stat label="Ocorrências a confirmar" value={data.occurrences.length} tone={data.occurrences.length ? 'warning' : 'neutral'} />
        <Stat label="Bloqueios ativos" value={data.penalties.length} tone={data.penalties.length ? 'danger' : 'neutral'} />
      </div>

      <div className="card tight">
        <div className="card-header"><h2>Contestações em análise</h2><span className="sub">Análise prioritária; não suspendem o bloqueio</span></div>
        {data.contestations.length === 0 ? <EmptyState title="Nenhuma contestação aberta" /> : (
          <div className="list">
            {data.contestations.map((c) => (
              <div key={c.id} className="list-item">
                <div className="item-head">
                  <div className="item-title"><Link to={`/gestao/profissionais/${c.user_id}`}>{c.worker_name}</Link><span className="muted">{c.protocol} · {label(c.channel)} · {fmtDateTime(c.created_at)}</span></div>
                  <StatusBadge tone="warning">Em análise</StatusBadge>
                </div>
                <div className="muted">
                  Sobre: {c.penalty_id ? `${label(c.penalty_type)} — ${c.penalty_reason}${c.penalty_ends_at ? ` (até ${fmtDate(c.penalty_ends_at)})` : ''}` : `${label(c.occurrence_type)}${c.occurrence_description ? ` — ${c.occurrence_description}` : ''}`}
                </div>
                <div className="subpanel">“{c.message}”</div>
                <div className="row">
                  <button className="primary sm" disabled={busy === c.id} onClick={() => decideContestation(c, 'CANCELADA')}>Cancelar punição</button>
                  {c.penalty_type === 'BLOQUEIO_TEMPORARIO' && <button className="sm" disabled={busy === c.id} onClick={() => decideContestation(c, 'AJUSTADA')}>Ajustar prazo</button>}
                  <button className="sm" disabled={busy === c.id} onClick={() => decideContestation(c, 'MANTIDA')}>Manter punição</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="card tight">
        <div className="card-header"><h2>Ocorrências a confirmar</h2><span className="sub">Geradas automaticamente. Falha de GPS, câmera ou internet não deve virar punição.</span></div>
        {data.occurrences.length === 0 ? <EmptyState title="Nenhuma ocorrência pendente" /> : (
          <div className="list">
            {data.occurrences.map((o) => (
              <div key={o.id} className="list-item">
                <div className="item-head">
                  <div className="item-title"><Link to={`/gestao/profissionais/${o.user_id}`}>{o.worker_name}</Link><span className="muted">{o.unit_name} · {fmtDateTime(o.created_at)}</span></div>
                  <StatusBadge tone="warning">{label(o.type)}</StatusBadge>
                </div>
                {o.description && <div className="muted">{o.description}</div>}
                <div className="row">
                  <button className="sm danger" disabled={busy === o.id} onClick={() => decideOccurrence(o, 'CONFIRMADA')}>Confirmar</button>
                  <button className="sm" disabled={busy === o.id} onClick={() => decideOccurrence(o, 'CANCELADA')}>Cancelar (falha técnica)</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="card tight">
        <div className="card-header"><h2>Bloqueios ativos</h2></div>
        {data.penalties.length === 0 ? <EmptyState title="Ninguém bloqueado" /> : (
          <div className="table-wrap">
            <table className="responsive">
              <thead><tr><th>Profissional</th><th>Tipo</th><th>Motivo</th><th>Até</th><th>Ações</th></tr></thead>
              <tbody>
                {data.penalties.map((p) => (
                  <tr key={p.id}>
                    <td data-label="Profissional"><Link className="strong" to={`/gestao/profissionais/${p.user_id}`}>{p.worker_name}</Link></td>
                    <td data-label="Tipo"><StatusBadge status={p.type} /></td>
                    <td data-label="Motivo">{p.reason}</td>
                    <td data-label="Até" className="nowrap">{p.ends_at ? fmtDateTime(p.ends_at) : 'Sem prazo'}</td>
                    <td data-label="Ações"><button className="sm" disabled={busy === p.id} onClick={() => endPenalty(p)}>Reativar</button></td>
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
