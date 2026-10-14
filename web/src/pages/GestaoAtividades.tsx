import { useEffect, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useInbox } from '../App';
import { api, fmtDateTime, fmtMinutes, fmtTime, label, toLocalInput, todayBR } from '../lib/api';
import { useUnitPicker } from './GestaoVagas';

const COUNTED = ['AGUARDANDO_CHECKIN', 'EM_ATIVIDADE', 'EM_PAUSA', 'PAUSA_EXCEDIDA', 'PENDENTE_DE_EXCECAO', 'PENDENTE_DE_FECHAMENTO', 'FINALIZADA'];

/** Checkout esquecido: o gestor escolhe de onde vem o horário de saída e justifica. */
function CloseForm({ s, onDone, onError }: { s: any; onDone: () => void; onError: (m: string) => void }) {
  const [source, setSource] = useState(s.reported_end_at ? 'INFORMADO_PROFISSIONAL' : 'PREVISTO');

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const time = source === 'CONFIRMADO_GESTOR' ? new Date(String(f.get('time'))).toISOString() : undefined;
    await api(`/manage/sessions/${s.id}/close`, { body: { source, time, reason: f.get('reason') } }).then(onDone, (err) => onError(err.message));
  }

  return (
    <form className="card stack" onSubmit={submit}>
      <b>Encerrar administrativamente</b>
      <p className="muted">Fica marcado como fechamento administrativo, não como checkout por GPS.</p>
      <label>Horário de saída
        <select value={source} onChange={(e) => setSource(e.target.value)}>
          {s.reported_end_at && <option value="INFORMADO_PROFISSIONAL">Informado pelo profissional: {fmtDateTime(s.reported_end_at)}</option>}
          <option value="PREVISTO">Previsto da vaga: {fmtDateTime(s.ends_at)}</option>
          <option value="CONFIRMADO_GESTOR">Outro horário, confirmado por mim</option>
        </select>
      </label>
      {s.reported_end_note && <p className="muted">Observação do profissional: {s.reported_end_note}</p>}
      {source === 'CONFIRMADO_GESTOR' && <label>Horário confirmado<input name="time" type="datetime-local" required defaultValue={toLocalInput(s.ends_at)} /></label>}
      <label>Justificativa<textarea name="reason" rows={2} minLength={10} maxLength={500} required /></label>
      <button className="primary">Encerrar atividade</button>
    </form>
  );
}

export default function GestaoAtividades() {
  const [params] = useSearchParams();
  const { refresh: refreshInbox } = useInbox();
  const { unitId, picker } = useUnitPicker(params.get('unit'));
  const [date, setDate] = useState(params.get('date') || todayBR());
  const [data, setData] = useState<{ serverNow: string; sessions: any[] }>();
  const [error, setError] = useState('');

  const load = async () => { if (unitId) await api(`/manage/sessions?unitId=${unitId}&date=${date}`).then(setData, (e) => setError(e.message)); };
  const afterAction = () => { load(); refreshInbox(); };
  useEffect(() => {
    load();
    const t = setInterval(load, 30000); // painel atualiza enquanto estiver aberto
    return () => clearInterval(t);
  }, [unitId, date]);

  async function confirmDaily(applicationId: string, result: string) {
    const note = prompt(result === 'CONCLUIDA' ? 'Observação (opcional):' : 'Confirmar falta. Observação (opcional):');
    if (note === null) return;
    await api(`/manage/applications/${applicationId}/confirm`, { body: { result, note } }).then(afterAction, (e) => setError(e.message));
  }

  async function decide(excId: string, decision: 'APROVADA' | 'RECUSADA') {
    const reason = prompt(`Justificativa para ${decision === 'APROVADA' ? 'aprovar' : 'recusar'} a exceção (10 a 500 caracteres):`);
    if (reason) await api(`/manage/exceptions/${excId}/decide`, { body: { decision, reason } }).then(afterAction, (e) => setError(e.message));
  }

  const sessions = data?.sessions ?? [];
  return (
    <div className="stack">
      <h1>Atividades</h1>
      <div className="cols">{picker}<label>Data<input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label></div>
      {error && <p className="error">{error}</p>}
      {data && <p className="muted">Atualizado às {fmtTime(data.serverNow)}. O status muda a cada registro do profissional; entre registros não há confirmação de localização.</p>}

      <div className="grid">
        {COUNTED.map((st) => (
          <div key={st} className="card stat"><b>{sessions.filter((s) => s.status === st).length}</b>{label(st)}</div>
        ))}
      </div>

      {sessions.length === 0 && <p className="muted">Nenhuma atividade aprovada nesta data.</p>}
      {sessions.map((s) => {
        const pendingExc = s.exceptions.find((x: any) => x.status === 'PENDENTE');
        return (
          <div key={s.id} className="card stack">
            <div className="row between">
              <span><Link to={`/gestao/profissionais/${s.user_id}`}><b>{s.worker_name}</b></Link> · {s.title} · {fmtTime(s.starts_at)}–{fmtTime(s.ends_at)}</span>
              <span className={`badge ${['PAUSA_EXCEDIDA', 'PENDENTE_DE_EXCECAO', 'PENDENTE_DE_FECHAMENTO'].includes(s.status) ? 'warn' : ''}`}>{label(s.status)}</span>
            </div>

            {s.events.length > 0 && (
              <div className="row">
                {s.events.map((e: any) => (
                  <div key={e.id}>
                    {e.has_selfie ? (
                      <a href={`/api/files/selfie/${e.id}`} target="_blank" rel="noreferrer" title={e.distance_m != null ? `${Math.round(e.distance_m)} m · precisão ${Math.round(e.accuracy_m)} m` : ''}>
                        <img className="thumb" src={`/api/files/selfie/${e.id}`} alt={label(e.type)} loading="lazy" />
                      </a>
                    ) : null}
                    <div className="muted">{label(e.type)} {fmtTime(e.occurred_at)}</div>
                    {e.validation !== 'GPS_VALIDADO' && <div className="muted warn">{label(e.validation)}</div>}
                  </div>
                ))}
              </div>
            )}

            {pendingExc && (
              <div className="card stack">
                <b>Exceção pedida: {label(pendingExc.type)} às {fmtTime(pendingExc.requested_at)}</b>
                <div className="row">
                  <a href={`/api/files/exception/${pendingExc.id}`} target="_blank" rel="noreferrer">
                    <img className="thumb" src={`/api/files/exception/${pendingExc.id}`} alt="Selfie do pedido" loading="lazy" />
                  </a>
                  <div>
                    <div>Motivo: {label(pendingExc.reason)}{pendingExc.distance_m != null && ` · ${Math.round(pendingExc.distance_m)} m da loja`}</div>
                    {pendingExc.error_message && <div className="muted">Erro: {pendingExc.error_message}</div>}
                    {pendingExc.message && <div>Mensagem: “{pendingExc.message}”</div>}
                  </div>
                </div>
                <div className="row">
                  <button className="primary" onClick={() => decide(pendingExc.id, 'APROVADA')}>Aprovar exceção</button>
                  <button className="danger" onClick={() => decide(pendingExc.id, 'RECUSADA')}>Recusar</button>
                </div>
              </div>
            )}

            {s.status === 'PENDENTE_DE_FECHAMENTO' && <CloseForm s={s} onDone={afterAction} onError={setError} />}

            {s.worked && (
              <div>Trabalhado: <b>{fmtMinutes(s.worked.workedMin)}</b> · pausas {fmtMinutes(s.worked.breakMin)} · {s.worked.sources.map(label).join(', ')}</div>
            )}
            <div className="row">
              {s.confirmation ? (
                <span className="badge">Diária: {label(s.confirmation)}</span>
              ) : (
                <>
                  {s.status === 'FINALIZADA' && <button className="primary" onClick={() => confirmDaily(s.application_id, 'CONCLUIDA')}>Confirmar diária</button>}
                  {s.status === 'AGUARDANDO_CHECKIN' && <button className="danger" onClick={() => confirmDaily(s.application_id, 'NAO_COMPARECEU')}>Registrar falta</button>}
                </>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
