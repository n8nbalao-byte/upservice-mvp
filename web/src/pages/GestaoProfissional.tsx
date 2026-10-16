import { useEffect, useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useInbox } from '../App';
import { Icon } from '../components/icons';
import { Alert, EmptyState, Loading, PageHeader, StatusBadge, reasonOpts, useAction, useDialog } from '../components/ui';
import { api, fmtDateTime, label, type Me, type Unit } from '../lib/api';

const DOC_NAME: Record<string, string> = { SELFIE: 'Selfie', CPF: 'CPF', RG: 'RG', COMPROVANTE: 'Comprovante de residência' };
const MANUAL_TYPES = ['ABANDONO', 'FRAUDE', 'REGRA_OPERACIONAL'];

type History = { occurrences: any[]; penalties: any[]; contestations: any[]; strikes: number; strikesToBlock: number };

/** Ocorrências, bloqueios e contestações do profissional, com as ações do gestor/admin. */
function Disciplina({ workerId, workerName, onChange }: { workerId: string; workerName: string; onChange: () => void }) {
  const { refresh: refreshInbox } = useInbox();
  const { ask } = useDialog();
  const { busy, run } = useAction();
  const [h, setH] = useState<History>();
  const [units, setUnits] = useState<Unit[]>([]);
  const [form, setForm] = useState<'' | 'occurrence' | 'email'>('');
  const [error, setError] = useState('');

  const load = () => api<History>(`/manage/workers/${workerId}/penalties`).then(setH, (e) => setError(e.message));
  useEffect(() => { load(); api<Unit[]>('/units').then(setUnits); }, [workerId]);

  async function act(key: string, path: string, body: object, done: string) {
    if (await run(key, () => api(path, { body }), done)) {
      setForm('');
      await load();
      onChange();
      refreshInbox();
    }
  }

  async function blockForever() {
    const reason = await ask(reasonOpts(`Bloquear ${workerName} permanentemente?`, {
      message: 'O profissional verá este motivo. Vagas aprovadas futuras são canceladas e liberadas.', confirmText: 'Continuar', tone: 'danger',
    }));
    if (!reason) return;
    const confirm = await ask({
      title: 'Confirme o bloqueio permanente', label: 'Digite BLOQUEAR para confirmar', requireText: 'BLOQUEAR',
      message: 'O bloqueio vale por tempo indeterminado até que um gestor ou administrador reative.', confirmText: 'Bloquear permanentemente', tone: 'danger',
    });
    if (confirm) act('block', `/manage/workers/${workerId}/block`, { reason, confirm }, 'Profissional bloqueado.');
  }

  async function endPenalty(id: string) {
    const reason = await ask(reasonOpts(`Reativar ${workerName}?`, { message: 'O profissional recebe um aviso e volta a poder se candidatar.', confirmText: 'Reativar' }));
    if (reason) act(id, `/manage/penalties/${id}/end`, { reason }, 'Profissional reativado.');
  }

  const submitOccurrence = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    act('occurrence', '/manage/occurrences', { userId: workerId, ...Object.fromEntries(new FormData(e.currentTarget)) }, 'Ocorrência registrada.');
  };
  const submitEmail = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;
    const [kind, id] = f.target.split(':');
    act('email', '/manage/contestations', { userId: workerId, message: f.message, ...(kind === 'p' ? { penaltyId: id } : { occurrenceId: id }) }, 'Contestação registrada.');
  };

  if (!h) return error ? <Alert kind="danger">{error}</Alert> : <Loading text="Carregando histórico…" />;
  const activePenalties = h.penalties.filter((p) => p.status === 'ATIVA');
  const contestable = [
    ...activePenalties.map((p) => ({ value: `p:${p.id}`, text: `${label(p.type)} — ${p.reason}` })),
    ...h.occurrences.filter((o) => o.status === 'CONFIRMADA').map((o) => ({ value: `o:${o.id}`, text: `${label(o.type)} — ${fmtDateTime(o.created_at)}` })),
  ];

  return (
    <div className="card stack">
      <div className="card-header" style={{ marginBottom: 0 }}>
        <h2>Ocorrências e bloqueios</h2>
        <StatusBadge tone={h.strikes >= h.strikesToBlock - 1 ? 'danger' : h.strikes ? 'warning' : 'neutral'}>Faltas desde o último bloqueio: {h.strikes} de {h.strikesToBlock}</StatusBadge>
      </div>
      <div className="row">
        <button className="sm" onClick={() => setForm(form === 'occurrence' ? '' : 'occurrence')}>Registrar ocorrência</button>
        <button className="sm" onClick={() => setForm(form === 'email' ? '' : 'email')} disabled={!contestable.length}>Registrar contestação recebida por e-mail</button>
        {!activePenalties.some((p) => p.type === 'BLOQUEIO_PERMANENTE') && <button className="sm ghost text-danger" disabled={busy === 'block'} onClick={blockForever}>Bloquear permanentemente</button>}
      </div>

      {form === 'occurrence' && (
        <form className="subpanel form" onSubmit={submitOccurrence}>
          <p className="muted">Falta é registrada pela confirmação da diária ("Registrar falta" em Atividades).</p>
          <div className="cols">
            <label>Tipo<select name="type">{MANUAL_TYPES.map((t) => <option key={t} value={t}>{label(t)}</option>)}</select></label>
            <label>Unidade<select name="unitId">{units.map((u) => <option key={u.id} value={u.id}>{u.code} · {u.name}</option>)}</select></label>
          </div>
          <label>Descrição e evidências<textarea name="description" rows={3} minLength={10} maxLength={500} required /></label>
          <div className="row"><button type="button" onClick={() => setForm('')}>Cancelar</button><button className="primary" disabled={busy === 'occurrence'}>Registrar (o profissional será avisado)</button></div>
        </form>
      )}
      {form === 'email' && (
        <form className="subpanel form" onSubmit={submitEmail}>
          <label>Contestação sobre<select name="target">{contestable.map((c) => <option key={c.value} value={c.value}>{c.text}</option>)}</select></label>
          <label>Conteúdo do e-mail recebido<textarea name="message" rows={4} minLength={10} maxLength={1000} required /></label>
          <div className="row"><button type="button" onClick={() => setForm('')}>Cancelar</button><button className="primary" disabled={busy === 'email'}>Registrar contestação</button></div>
        </form>
      )}

      {h.penalties.length > 0 && (
        <div className="stack">
          <h3>Bloqueios</h3>
          {h.penalties.map((p) => (
            <div key={p.id} className="subpanel row between">
              <span><StatusBadge status={p.type} /> <StatusBadge status={p.status} tone={p.status === 'ATIVA' ? 'danger' : 'neutral'}>{p.status === 'ATIVA' ? 'Em vigor' : label(p.status)}</StatusBadge>
                <span className="muted" style={{ display: 'block', marginTop: 4 }}>{p.reason} · {fmtDateTime(p.starts_at)} {p.ends_at ? `até ${fmtDateTime(p.ends_at)}` : '(sem prazo)'}{p.end_reason && ` · ${p.end_reason}`}</span>
              </span>
              {p.status === 'ATIVA' && <button className="sm" disabled={busy === p.id} onClick={() => endPenalty(p.id)}>Reativar</button>}
            </div>
          ))}
        </div>
      )}

      <h3>Histórico de ocorrências</h3>
      {h.occurrences.length === 0 ? <p className="muted">Nenhuma ocorrência.</p> : (
        <div className="table-wrap">
          <table className="responsive">
            <thead><tr><th>Ocorrência</th><th>Loja</th><th>Data</th><th>Status</th></tr></thead>
            <tbody>
              {h.occurrences.map((o) => (
                <tr key={o.id}>
                  <td data-label="Ocorrência"><span className="strong">{label(o.type)}</span>{o.description && <span className="muted">{o.description}</span>}</td>
                  <td data-label="Loja">{o.unit_name}</td>
                  <td data-label="Data" className="nowrap">{fmtDateTime(o.created_at)}</td>
                  <td data-label="Status"><StatusBadge status={o.status === 'CONFIRMADA' ? 'CONFIRMADA' : o.status} tone={o.status === 'PENDENTE' ? 'warning' : undefined} />{o.penalty_id && <span className="muted">usada em bloqueio</span>}</td>
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
  const { ask } = useDialog();
  const { busy, run } = useAction();
  const [data, setData] = useState<Me>();
  const [error, setError] = useState('');

  const load = () => api<Me>(`/manage/workers/${id}`).then(setData, (e) => setError(e.message));
  useEffect(() => { load(); }, [id]);

  async function review(docId: string, status: 'APROVADO' | 'REJEITADO') {
    let reason: string | null = null;
    if (status === 'REJEITADO') {
      reason = await ask({ title: 'Rejeitar documento?', label: 'Motivo (o profissional verá e poderá reenviar)', multiline: true, minLength: 5, maxLength: 500, confirmText: 'Rejeitar', tone: 'danger' });
      if (!reason) return;
    }
    if (await run(docId, () => api(`/manage/documents/${docId}/review`, { body: { status, reason } }), status === 'APROVADO' ? 'Documento aprovado.' : 'Documento rejeitado.')) {
      load();
      refreshInbox();
    }
  }

  if (!data) return error ? <Alert kind="danger">{error}</Alert> : <Loading />;
  const p = data.profile;
  const selfie = data.documents.find((d) => d.type === 'SELFIE');
  return (
    <div className="page">
      <PageHeader
        back={{ to: '/gestao/documentos', label: 'Documentos' }}
        title={data.user.name}
        description={data.user.email}
        actions={<><StatusBadge status={data.user.status} /><Link className="btn sm" to={`/gestao/profissionais/${id}/estrelas`}>Ver estrelas</Link></>}
      />
      <Alert kind="info">Dados pessoais e documentos: todo acesso fica registrado na auditoria.</Alert>
      <div className="grid-2">
        <div className="card">
          <div className="card-header"><h2>Cadastro</h2></div>
          <div className="profile-photo">
            {selfie ? <a href={`/api/files/doc/${selfie.id}`} target="_blank" rel="noreferrer"><img src={`/api/files/doc/${selfie.id}`} alt={`Selfie de ${data.user.name}`} /></a> : <span className="none"><Icon name="user" size={32} /></span>}
            <span>{selfie ? <><b>Selfie do cadastro</b> <StatusBadge status={selfie.status} /><small>Usada para conferir a identidade (comparação facial no futuro).</small></> : <><b>Sem selfie</b><small>O cadastro só fica completo com a selfie.</small></>}</span>
          </div>
          {p ? (
            <table>
              <tbody>
                <tr><th>CPF</th><td className="tabular">{p.cpf}</td></tr>
                <tr><th>RG</th><td>{p.rg}</td></tr>
                <tr><th>Telefone</th><td className="tabular">{p.phone}</td></tr>
                <tr><th>Endereço</th><td>{p.address} · {p.city}/{p.uf}</td></tr>
                <tr><th>Emergência</th><td>{p.emergency_name} · {p.emergency_phone}</td></tr>
                <tr><th>Termos</th><td>{p.terms_accepted_at ? `Aceitos em ${fmtDateTime(p.terms_accepted_at)}` : 'Não aceitos'}</td></tr>
              </tbody>
            </table>
          ) : <EmptyState icon="user" title="Cadastro não preenchido" />}
        </div>
        <div className="card">
          <div className="card-header"><h2>Documentos</h2><span className="sub">{data.documents.filter((d) => d.status === 'APROVADO').length}/{Object.keys(DOC_NAME).length} aprovados</span></div>
          {data.documents.length === 0 ? <EmptyState icon="file" title="Nenhum documento enviado" /> : (
            <div className="stack">
              {data.documents.map((d) => (
                <div key={d.id} className="subpanel row between">
                  <span><b>{DOC_NAME[d.type]}</b> <StatusBadge status={d.status} />{d.rejection_reason && <span className="muted" style={{ display: 'block' }}>{d.rejection_reason}</span>}</span>
                  <span className="row">
                    <a className="btn sm" href={`/api/files/doc/${d.id}`} target="_blank" rel="noreferrer"><Icon name="file" size={16} />Ver</a>
                    {d.status === 'PENDENTE' && (
                      <>
                        <button className="primary sm" disabled={busy === d.id} onClick={() => review(d.id, 'APROVADO')}>Aprovar</button>
                        <button className="danger sm" disabled={busy === d.id} onClick={() => review(d.id, 'REJEITADO')}>Rejeitar</button>
                      </>
                    )}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
      {id && <Disciplina workerId={id} workerName={data.user.name} onChange={load} />}
    </div>
  );
}
