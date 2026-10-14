import { useEffect, useState, type FormEvent } from 'react';
import { useParams } from 'react-router-dom';
import { useInbox } from '../App';
import { api, fmtDateTime, label, type Me, type Unit } from '../lib/api';

const DOC_NAME: Record<string, string> = { CPF: 'CPF', RG: 'RG', COMPROVANTE: 'Comprovante de residência' };
const MANUAL_TYPES = ['ABANDONO', 'FRAUDE', 'REGRA_OPERACIONAL'];

type History = { occurrences: any[]; penalties: any[]; contestations: any[]; strikes: number; strikesToBlock: number };

/** Ocorrências, bloqueios e contestações do profissional, com as ações do gestor/admin. */
function Disciplina({ workerId, onChange }: { workerId: string; onChange: () => void }) {
  const { refresh: refreshInbox } = useInbox();
  const [h, setH] = useState<History>();
  const [units, setUnits] = useState<Unit[]>([]);
  const [form, setForm] = useState<'' | 'occurrence' | 'email'>('');
  const [error, setError] = useState('');

  const load = () => api<History>(`/manage/workers/${workerId}/penalties`).then(setH, (e) => setError(e.message));
  useEffect(() => { load(); api<Unit[]>('/units').then(setUnits); }, [workerId]);

  async function act(path: string, body: object) {
    setError('');
    try {
      await api(path, { body });
      setForm('');
      await load();
      onChange();
      refreshInbox();
    } catch (e: any) {
      setError(e.message);
    }
  }

  function blockForever() {
    const reason = prompt('Motivo do bloqueio permanente (10 a 500 caracteres). O profissional verá este motivo:');
    if (!reason) return;
    const confirm = prompt('Esta ação bloqueia o profissional por tempo indeterminado e cancela as vagas aprovadas futuras. Para confirmar, digite BLOQUEAR:');
    if (confirm) act(`/manage/workers/${workerId}/block`, { reason, confirm });
  }

  function endPenalty(id: string) {
    const reason = prompt('Justificativa da reativação (10 a 500 caracteres):');
    if (reason) act(`/manage/penalties/${id}/end`, { reason });
  }

  const submitOccurrence = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.currentTarget));
    act('/manage/occurrences', { userId: workerId, ...f });
  };

  const submitEmail = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;
    const [kind, id] = f.target.split(':');
    act('/manage/contestations', { userId: workerId, message: f.message, ...(kind === 'p' ? { penaltyId: id } : { occurrenceId: id }) });
  };

  if (!h) return <p>{error || 'Carregando histórico…'}</p>;
  const activePenalties = h.penalties.filter((p) => p.status === 'ATIVA');
  const contestable = [
    ...activePenalties.map((p) => ({ value: `p:${p.id}`, text: `${label(p.type)} — ${p.reason}` })),
    ...h.occurrences.filter((o) => o.status === 'CONFIRMADA').map((o) => ({ value: `o:${o.id}`, text: `${label(o.type)} — ${fmtDateTime(o.created_at)}` })),
  ];

  return (
    <div className="card stack">
      <h2>Ocorrências e bloqueios</h2>
      {error && <p className="error">{error}</p>}
      <p>Faltas confirmadas desde o último bloqueio: <b>{h.strikes} de {h.strikesToBlock}</b></p>
      <div className="row">
        <button onClick={() => setForm(form === 'occurrence' ? '' : 'occurrence')}>Registrar ocorrência</button>
        <button onClick={() => setForm(form === 'email' ? '' : 'email')} disabled={!contestable.length}>Registrar contestação recebida por e-mail</button>
        {!activePenalties.some((p) => p.type === 'BLOQUEIO_PERMANENTE') && <button className="danger" onClick={blockForever}>Bloquear permanentemente</button>}
      </div>

      {form === 'occurrence' && (
        <form className="card stack" onSubmit={submitOccurrence}>
          <p className="muted">Falta é registrada pela confirmação da diária ("Registrar falta" em Atividades).</p>
          <div className="cols">
            <label>Tipo<select name="type">{MANUAL_TYPES.map((t) => <option key={t} value={t}>{label(t)}</option>)}</select></label>
            <label>Unidade<select name="unitId">{units.map((u) => <option key={u.id} value={u.id}>{u.code} · {u.name}</option>)}</select></label>
          </div>
          <label>Descrição e evidências<textarea name="description" rows={3} minLength={10} maxLength={500} required /></label>
          <button className="primary">Registrar (o profissional será avisado)</button>
        </form>
      )}

      {form === 'email' && (
        <form className="card stack" onSubmit={submitEmail}>
          <label>Contestação sobre<select name="target">{contestable.map((c) => <option key={c.value} value={c.value}>{c.text}</option>)}</select></label>
          <label>Conteúdo do e-mail recebido<textarea name="message" rows={4} minLength={10} maxLength={1000} required /></label>
          <button className="primary">Registrar contestação</button>
        </form>
      )}

      {h.penalties.map((p) => (
        <div key={p.id} className="row between">
          <span><b>{label(p.type)}</b> <span className="badge">{label(p.status)}</span>
            <div className="muted">{p.reason} · {fmtDateTime(p.starts_at)} {p.ends_at ? `até ${fmtDateTime(p.ends_at)}` : '(sem prazo)'}{p.end_reason && ` · ${p.end_reason}`}</div>
          </span>
          {p.status === 'ATIVA' && <button onClick={() => endPenalty(p.id)}>Reativar</button>}
        </div>
      ))}
      {h.occurrences.length === 0 && <p className="muted">Nenhuma ocorrência.</p>}
      {h.occurrences.length > 0 && (
        <div className="scroll">
          <table>
            <thead><tr><th>Ocorrência</th><th>Loja</th><th>Data</th><th>Status</th></tr></thead>
            <tbody>
              {h.occurrences.map((o) => (
                <tr key={o.id}>
                  <td>{label(o.type)}{o.description && <div className="muted">{o.description}</div>}</td>
                  <td>{o.unit_name}</td>
                  <td>{fmtDateTime(o.created_at)}</td>
                  <td>{label(o.status)}{o.penalty_id && <div className="muted">usada em bloqueio</div>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {h.contestations.map((c) => (
        <div key={c.id} className="muted">Contestação {c.protocol} ({label(c.channel)}): {label(c.status)}{c.decision_reason && ` — ${c.decision_reason}`}</div>
      ))}
    </div>
  );
}

export default function GestaoProfissional() {
  const { id } = useParams();
  const { refresh: refreshInbox } = useInbox();
  const [data, setData] = useState<Me>();
  const [error, setError] = useState('');

  const load = () => api<Me>(`/manage/workers/${id}`).then(setData, (e) => setError(e.message));
  useEffect(() => { load(); }, [id]);

  async function review(docId: string, status: 'APROVADO' | 'REJEITADO') {
    const reason = status === 'REJEITADO' ? prompt('Motivo da rejeição (o profissional verá):') : null;
    if (status === 'REJEITADO' && !reason) return;
    await api(`/manage/documents/${docId}/review`, { body: { status, reason } }).then(() => { load(); refreshInbox(); }, (e) => setError(e.message));
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
      {id && <Disciplina workerId={id} onChange={load} />}
    </div>
  );
}
