import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, fmtMinutes, fmtTime, label, todayBR } from '../lib/api';
import { useUnitPicker } from './GestaoVagas';

const COUNTED = ['AGUARDANDO_CHECKIN', 'EM_ATIVIDADE', 'EM_PAUSA', 'PAUSA_EXCEDIDA', 'FINALIZADA'];

export default function GestaoAtividades() {
  const { unitId, picker } = useUnitPicker();
  const [date, setDate] = useState(todayBR());
  const [data, setData] = useState<{ serverNow: string; sessions: any[] }>();
  const [error, setError] = useState('');

  const load = async () => { if (unitId) await api(`/manage/sessions?unitId=${unitId}&date=${date}`).then(setData, (e) => setError(e.message)); };
  useEffect(() => {
    load();
    const t = setInterval(load, 30000); // painel atualiza enquanto estiver aberto
    return () => clearInterval(t);
  }, [unitId, date]);

  async function confirmDaily(applicationId: string, result: string) {
    const note = prompt(result === 'CONCLUIDA' ? 'Observação (opcional):' : 'Confirmar falta. Observação (opcional):');
    if (note === null) return;
    await api(`/manage/applications/${applicationId}/confirm`, { body: { result, note } }).then(load, (e) => setError(e.message));
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
      {sessions.map((s) => (
        <div key={s.id} className="card stack">
          <div className="row between">
            <span><Link to={`/gestao/profissionais/${s.user_id}`}><b>{s.worker_name}</b></Link> · {s.title} · {fmtTime(s.starts_at)}–{fmtTime(s.ends_at)}</span>
            <span className={`badge ${s.status === 'PAUSA_EXCEDIDA' ? 'warn' : ''}`}>{label(s.status)}</span>
          </div>
          {s.events.length > 0 && (
            <div className="row">
              {s.events.map((e: any) => (
                <a key={e.id} href={`/api/files/selfie/${e.id}`} target="_blank" rel="noreferrer" title={`${label(e.type)} · ${Math.round(e.distance_m)} m · precisão ${Math.round(e.accuracy_m)} m`}>
                  <img className="thumb" src={`/api/files/selfie/${e.id}`} alt={label(e.type)} loading="lazy" />
                  <div className="muted">{label(e.type)} {fmtTime(e.occurred_at)}</div>
                </a>
              ))}
            </div>
          )}
          {s.worked && <div>Trabalhado: <b>{fmtMinutes(s.worked.workedMin)}</b> · pausas {fmtMinutes(s.worked.breakMin)} · GPS validado</div>}
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
      ))}
    </div>
  );
}
