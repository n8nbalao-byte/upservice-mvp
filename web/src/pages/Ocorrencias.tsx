import { useEffect, useState, type FormEvent } from 'react';
import { useMe } from '../App';
import { Alert, EmptyState, Loading, PageHeader, Stat, StatusBadge } from '../components/ui';
import { api, fmtDateTime, isBlocked, label } from '../lib/api';

type History = { occurrences: any[]; penalties: any[]; contestations: any[]; strikes: number; strikesToBlock: number };
type Target = { penaltyId?: string; occurrenceId?: string; title: string };

/** O que o profissional vê sobre si: ocorrências, bloqueios (motivo e período) e contestações com protocolo. */
export default function Ocorrencias() {
  const { me } = useMe();
  const [data, setData] = useState<History>();
  const [target, setTarget] = useState<Target | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState('');

  const load = () => api<History>('/me/occurrences').then(setData, (e) => setError(e.message));
  useEffect(() => { load(); }, []);

  async function contest(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const message = new FormData(e.currentTarget).get('message');
    setError('');
    setSending(true);
    try {
      const { protocol } = await api('/me/contestations', { body: { penaltyId: target!.penaltyId, occurrenceId: target!.occurrenceId, message } });
      setDone(`Contestação enviada. Guarde o protocolo ${protocol}.`);
      setTarget(null);
      load();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSending(false);
    }
  }

  if (!data) return error ? <Alert kind="danger">{error}</Alert> : <Loading />;
  // Uma contestação por item: a mais recente (em análise ou já decidida) substitui o botão de contestar.
  const open = (key: 'penalty_id' | 'occurrence_id', id: string) => data.contestations.find((c) => c[key] === id);
  const contested = (c: any) => (c.status === 'ABERTA' ? `Contestação em análise · ${c.protocol}` : `Já contestada · ${label(c.status)} · ${c.protocol}`);
  const active = data.penalties.find((p) => p.status === 'ATIVA');

  return (
    <div className="page" style={{ maxWidth: 860 }}>
      <PageHeader title="Ocorrências" description="Suas ocorrências, bloqueios e contestações. Cada punição ou ocorrência pode ser contestada uma vez." />
      {isBlocked(me.user.status) && active && (
        <Alert kind="danger">
          <b>Sua conta está bloqueada {active.ends_at ? `até ${fmtDateTime(active.ends_at)}` : 'por tempo indeterminado'}.</b>{' '}
          Motivo: {active.reason}. Enquanto isso você não pode se candidatar nem registrar presença. Se discordar, conteste abaixo ou pelo e-mail contato@upserviceintermed.com.
        </Alert>
      )}
      {error && <Alert kind="danger">{error}</Alert>}
      {done && <Alert kind="success">{done}</Alert>}

      <div className="stats">
        <Stat label="Faltas desde o último bloqueio" value={`${data.strikes} de ${data.strikesToBlock}`} tone={data.strikes >= data.strikesToBlock - 1 ? 'danger' : data.strikes ? 'warning' : 'neutral'} hint={`Com ${data.strikesToBlock} faltas, a conta é bloqueada por 15 dias`} />
        <Stat label="Contestações em análise" value={data.contestations.filter((c) => c.status === 'ABERTA').length} tone="info" />
      </div>
      <p className="muted">Falhas de GPS, câmera ou internet não contam como falta.</p>

      {target && (
        <form className="card form" onSubmit={contest}>
          <h2>Contestar: {target.title}</h2>
          <label>Explique o que aconteceu<textarea name="message" rows={4} minLength={10} maxLength={1000} required autoFocus /></label>
          <p className="muted">A contestação não suspende o bloqueio, mas é analisada com prioridade. Você recebe a decisão aqui e por e-mail.</p>
          <div className="row"><button type="button" onClick={() => setTarget(null)}>Cancelar</button><button className="primary" disabled={sending}>{sending ? 'Enviando…' : 'Enviar contestação'}</button></div>
        </form>
      )}

      <section className="stack">
        <h2 className="section-title">Bloqueios</h2>
        {data.penalties.length === 0 ? <div className="card"><EmptyState title="Nenhum bloqueio" /></div> : data.penalties.map((p) => (
          <article key={p.id} className="card stack">
            <div className="row between"><h2>{label(p.type)}</h2><StatusBadge status={p.status} tone={p.status === 'ATIVA' ? 'danger' : 'neutral'}>{p.status === 'ATIVA' ? 'Em vigor' : label(p.status)}</StatusBadge></div>
            <p>Motivo: {p.reason}</p>
            <p className="muted">De {fmtDateTime(p.starts_at)} {p.ends_at ? `até ${fmtDateTime(p.ends_at)}` : '(sem prazo)'}{p.end_reason && ` · ${p.end_reason}`}</p>
            {p.status === 'ATIVA' && (open('penalty_id', p.id)
              ? <StatusBadge tone="info">{contested(open('penalty_id', p.id))}</StatusBadge>
              : <div><button className="primary" onClick={() => setTarget({ penaltyId: p.id, title: label(p.type) })}>Contestar bloqueio</button></div>)}
          </article>
        ))}
      </section>

      <section className="stack">
        <h2 className="section-title">Ocorrências</h2>
        {data.occurrences.length === 0 ? <div className="card"><EmptyState title="Nenhuma ocorrência" text="Continue assim!" /></div> : data.occurrences.map((o) => (
          <article key={o.id} className="card stack">
            <div className="row between"><h2>{label(o.type)}</h2><StatusBadge status={o.status} /></div>
            <p className="muted">{o.unit_name} · {fmtDateTime(o.created_at)}</p>
            {o.description && <p>{o.description}</p>}
            {o.status === 'CONFIRMADA' && (open('occurrence_id', o.id)
              ? <StatusBadge tone="info">{contested(open('occurrence_id', o.id))}</StatusBadge>
              : <div><button className="sm" onClick={() => setTarget({ occurrenceId: o.id, title: label(o.type) })}>Contestar ocorrência</button></div>)}
          </article>
        ))}
      </section>

      {data.contestations.length > 0 && (
        <section className="stack">
          <h2 className="section-title">Minhas contestações</h2>
          <div className="card tight">
            <div className="table-wrap">
              <table className="responsive">
                <thead><tr><th>Protocolo</th><th>Enviada</th><th>Canal</th><th>Status</th><th>Decisão</th></tr></thead>
                <tbody>
                  {data.contestations.map((c) => (
                    <tr key={c.id}>
                      <td data-label="Protocolo" className="strong nowrap">{c.protocol}</td>
                      <td data-label="Enviada" className="nowrap">{fmtDateTime(c.created_at)}</td>
                      <td data-label="Canal">{label(c.channel)}</td>
                      <td data-label="Status"><StatusBadge status={c.status} tone={c.status === 'ABERTA' ? 'info' : c.status === 'CANCELADA' ? 'success' : undefined}>{c.status === 'ABERTA' ? 'Em análise' : c.status === 'CANCELADA' ? 'Aceita' : label(c.status)}</StatusBadge></td>
                      <td data-label="Decisão">{c.decision_reason ?? <span className="muted">—</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
