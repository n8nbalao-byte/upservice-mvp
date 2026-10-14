import { useEffect, useState, type FormEvent } from 'react';
import { useMe } from '../App';
import { api, fmtDateTime, isBlocked, label } from '../lib/api';

type History = { occurrences: any[]; penalties: any[]; contestations: any[]; strikes: number; strikesToBlock: number };
type Target = { penaltyId?: string; occurrenceId?: string; title: string };

/** O que o profissional vê sobre si: ocorrências, bloqueios (motivo e período) e contestações com protocolo. */
export default function Ocorrencias() {
  const { me } = useMe();
  const [data, setData] = useState<History>();
  const [target, setTarget] = useState<Target | null>(null);
  const [error, setError] = useState('');
  const [done, setDone] = useState('');

  const load = () => api<History>('/me/occurrences').then(setData, (e) => setError(e.message));
  useEffect(() => { load(); }, []);

  async function contest(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const message = new FormData(e.currentTarget).get('message');
    setError('');
    try {
      const { protocol } = await api('/me/contestations', { body: { penaltyId: target!.penaltyId, occurrenceId: target!.occurrenceId, message } });
      setDone(`Contestação enviada. Protocolo ${protocol}.`);
      setTarget(null);
      load();
    } catch (err: any) {
      setError(err.message);
    }
  }

  if (!data) return <p>{error || 'Carregando…'}</p>;
  const open = (key: 'penalty_id' | 'occurrence_id', id: string) => data.contestations.find((c) => c[key] === id && c.status === 'ABERTA');
  const active = data.penalties.find((p) => p.status === 'ATIVA');

  return (
    <div className="stack">
      <h1>Ocorrências</h1>
      {isBlocked(me.user.status) && active && (
        <div className="error stack">
          <b>Sua conta está bloqueada {active.ends_at ? `até ${fmtDateTime(active.ends_at)}` : 'por tempo indeterminado'}.</b>
          <span>Motivo: {active.reason}</span>
          <span>Enquanto isso você não pode se candidatar nem registrar presença. Se discordar, conteste abaixo ou pelo e-mail contato@upserviceintermed.com.</span>
        </div>
      )}
      {error && <p className="error">{error}</p>}
      {done && <p className="notice">{done}</p>}
      <p className="muted">Faltas confirmadas desde o último bloqueio: <b>{data.strikes} de {data.strikesToBlock}</b>. Ao chegar em {data.strikesToBlock}, a conta é bloqueada por 15 dias. Falhas de GPS, câmera ou internet não contam como falta.</p>

      {target && (
        <form className="card stack" onSubmit={contest}>
          <b>Contestar: {target.title}</b>
          <label>Explique o que aconteceu<textarea name="message" rows={4} minLength={10} maxLength={1000} required /></label>
          <p className="muted">A contestação não suspende o bloqueio, mas é analisada com prioridade. Você recebe a decisão aqui e por e-mail.</p>
          <div className="row"><button className="primary">Enviar contestação</button><button type="button" onClick={() => setTarget(null)}>Cancelar</button></div>
        </form>
      )}

      <h2>Bloqueios</h2>
      {data.penalties.length === 0 && <p className="muted">Nenhum bloqueio.</p>}
      {data.penalties.map((p) => (
        <div key={p.id} className="card stack">
          <div className="row between"><b>{label(p.type)}</b><span className="badge">{label(p.status)}</span></div>
          <div>Motivo: {p.reason}</div>
          <div className="muted">De {fmtDateTime(p.starts_at)} {p.ends_at ? `até ${fmtDateTime(p.ends_at)}` : '(sem prazo)'}{p.end_reason && ` · ${p.end_reason}`}</div>
          {p.status === 'ATIVA' && (open('penalty_id', p.id)
            ? <span className="muted">Contestação em análise (protocolo {open('penalty_id', p.id).protocol})</span>
            : <button onClick={() => setTarget({ penaltyId: p.id, title: label(p.type) })}>Contestar bloqueio</button>)}
        </div>
      ))}

      <h2>Ocorrências</h2>
      {data.occurrences.length === 0 && <p className="muted">Nenhuma ocorrência.</p>}
      {data.occurrences.map((o) => (
        <div key={o.id} className="card stack">
          <div className="row between"><b>{label(o.type)}</b><span className="badge">{label(o.status)}</span></div>
          <div className="muted">{o.unit_name} · {fmtDateTime(o.created_at)}</div>
          {o.description && <div>{o.description}</div>}
          {o.status === 'CONFIRMADA' && (open('occurrence_id', o.id)
            ? <span className="muted">Contestação em análise (protocolo {open('occurrence_id', o.id).protocol})</span>
            : <button onClick={() => setTarget({ occurrenceId: o.id, title: label(o.type) })}>Contestar ocorrência</button>)}
        </div>
      ))}

      {data.contestations.length > 0 && (
        <>
          <h2>Minhas contestações</h2>
          {data.contestations.map((c) => (
            <div key={c.id} className="card">
              <div className="row between"><b>{c.protocol}</b><span className="badge">{label(c.status)}</span></div>
              <div className="muted">{fmtDateTime(c.created_at)} · {label(c.channel)}</div>
              {c.decision_reason && <div>Decisão: {c.decision_reason}</div>}
            </div>
          ))}
        </>
      )}
    </div>
  );
}
