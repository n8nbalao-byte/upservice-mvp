import { useEffect, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useInbox } from '../App';
import { Icon } from '../components/icons';
import { Alert, EmptyState, Loading, PageHeader, Stat, StatusBadge, reasonOpts, useAction, useDialog } from '../components/ui';
import { api, fmtDateTime, fmtMinutes, fmtTime, label, toLocalInput, todayBR } from '../lib/api';
import { useUnitPicker } from './GestaoVagas';

const ACTIVE = ['EM_ATIVIDADE', 'EM_PAUSA', 'PAUSA_EXCEDIDA'];
type Level = 'urgent' | 'attention' | null;

/** O que pede ação do gestor agora. Localização não atualizada é só informação (tela fechada não é infração). */
function attentionOf(s: any, now: number): { level: Level; reasons: string[] } {
  const urgent: string[] = [];
  const attention: string[] = [];
  if (s.exceptions.some((x: any) => x.status === 'PENDENTE')) urgent.push('Exceção aguardando decisão');
  if (s.alerts?.some((a: any) => !a.acknowledged_at)) urgent.push('Saída do raio não vista');
  if (s.status === 'PAUSA_EXCEDIDA') urgent.push('Pausa excedida');
  if (s.status === 'PENDENTE_DE_FECHAMENTO') attention.push('Checkout pendente: encerrar a atividade');
  if (s.status === 'AGUARDANDO_CHECKIN' && !s.confirmation && now > new Date(s.starts_at).getTime() + 15 * 60e3) attention.push('Sem check-in após a tolerância de 15 min');
  return { level: urgent.length ? 'urgent' : attention.length ? 'attention' : null, reasons: [...urgent, ...attention] };
}

/** Checkout esquecido: o gestor escolhe a origem do horário de saída e justifica. */
function CloseForm({ s, onDone }: { s: any; onDone: () => void }) {
  const { busy, run } = useAction();
  const [source, setSource] = useState(s.reported_end_at ? 'INFORMADO_PROFISSIONAL' : 'PREVISTO');
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const time = source === 'CONFIRMADO_GESTOR' ? new Date(String(f.get('time'))).toISOString() : undefined;
    run('close', () => api(`/manage/sessions/${s.id}/close`, { body: { source, time, reason: f.get('reason') } }), 'Atividade encerrada.').then((ok) => ok && onDone());
  }
  return (
    <form className="subpanel form" onSubmit={submit}>
      <div><h3>Encerrar administrativamente</h3><p className="muted">Fica registrado como fechamento administrativo, não como checkout por GPS.</p></div>
      <div className="cols">
        <label>Horário de saída
          <select value={source} onChange={(e) => setSource(e.target.value)}>
            {s.reported_end_at && <option value="INFORMADO_PROFISSIONAL">Informado pelo profissional: {fmtDateTime(s.reported_end_at)}</option>}
            <option value="PREVISTO">Previsto da vaga: {fmtDateTime(s.ends_at)}</option>
            <option value="CONFIRMADO_GESTOR">Outro horário, confirmado por mim</option>
          </select>
        </label>
        {source === 'CONFIRMADO_GESTOR' && <label>Horário confirmado<input name="time" type="datetime-local" required defaultValue={toLocalInput(s.ends_at)} /></label>}
      </div>
      {s.reported_end_note && <p className="muted">Observação do profissional: “{s.reported_end_note}”</p>}
      <label>Justificativa<textarea name="reason" rows={2} minLength={10} maxLength={500} required placeholder="Ex.: confirmado com o encarregado da loja" /></label>
      <div><button className="primary" disabled={busy === 'close'}>{busy === 'close' ? 'Encerrando…' : 'Encerrar atividade'}</button></div>
    </form>
  );
}

export default function GestaoAtividades() {
  const [params] = useSearchParams();
  const { refresh: refreshInbox } = useInbox();
  const { ask } = useDialog();
  const { busy, run } = useAction();
  const { units, loaded, unitId, picker } = useUnitPicker(params.get('unit'));
  const [date, setDate] = useState(params.get('date') || todayBR());
  const [data, setData] = useState<{ serverNow: string; sessions: any[] }>();
  const [filter, setFilter] = useState('ALL');
  const [error, setError] = useState('');

  const load = async () => {
    if (!unitId) return;
    await api<{ serverNow: string; sessions: any[] }>(`/manage/sessions?unitId=${unitId}&date=${date}`).then((d) => { setData(d); setError(''); }, (e) => setError(e.message));
  };
  const afterAction = () => { load(); refreshInbox(); };
  useEffect(() => {
    setData(undefined);
    load();
    const t = setInterval(load, 30000); // painel atualiza enquanto estiver aberto
    return () => clearInterval(t);
  }, [unitId, date]);

  async function confirmDaily(s: any, result: 'CONCLUIDA' | 'NAO_COMPARECEU') {
    const absent = result === 'NAO_COMPARECEU';
    const note = await ask({
      title: absent ? `Registrar falta de ${s.worker_name}?` : `Confirmar diária de ${s.worker_name}`,
      message: absent ? 'A falta confirmada conta para o bloqueio de 15 dias (3 faltas). Falha técnica não deve ser registrada como falta.' : `${s.title} · ${fmtTime(s.starts_at)}–${fmtTime(s.ends_at)}`,
      label: 'Observação', optional: true, maxLength: 500, multiline: true,
      confirmText: absent ? 'Registrar falta' : 'Confirmar diária', tone: absent ? 'danger' : 'primary',
    });
    if (note === null) return;
    await run(`confirm:${s.id}`, () => api(`/manage/applications/${s.application_id}/confirm`, { body: { result, note } }), absent ? 'Falta registrada.' : 'Diária confirmada.');
    afterAction();
  }

  async function decide(s: any, exc: any, decision: 'APROVADA' | 'RECUSADA') {
    const ok = decision === 'APROVADA';
    const reason = await ask(reasonOpts(ok ? `Aprovar exceção de ${s.worker_name}?` : `Recusar exceção de ${s.worker_name}?`, {
      message: ok ? `O registro entra como exceção aprovada, com o horário do pedido (${fmtTime(exc.requested_at)}).` : 'A atividade volta ao estado anterior e o profissional pode tentar de novo.',
      confirmText: ok ? 'Aprovar exceção' : 'Recusar', tone: ok ? 'primary' : 'danger',
    }));
    if (!reason) return;
    await run(`exc:${exc.id}`, () => api(`/manage/exceptions/${exc.id}/decide`, { body: { decision, reason } }), ok ? 'Exceção aprovada.' : 'Exceção recusada.');
    afterAction();
  }

  async function ack(alertId: string) {
    await run(`ack:${alertId}`, () => api(`/manage/location-alerts/${alertId}/ack`, { body: {} }), 'Alerta marcado como ciente.');
    afterAction();
  }

  if (loaded && !units.length) {
    return <div className="page"><PageHeader title="Atividades" /><div className="card"><EmptyState icon="store" title="Nenhuma unidade vinculada" text="Peça a um administrador para vincular sua conta a uma loja." /></div></div>;
  }

  const now = data ? new Date(data.serverNow).getTime() : Date.now();
  const all = (data?.sessions ?? []).map((s) => ({ ...s, att: attentionOf(s, now) }));
  const by = (st: string) => all.filter((s) => s.status === st).length;
  const attentionCount = all.filter((s) => s.att.level).length;
  const rank = (s: any) => (s.att.level === 'urgent' ? 0 : s.att.level === 'attention' ? 1 : 2);
  const shown = all
    .filter((s) => filter === 'ALL' || (filter === 'ATTENTION' ? s.att.level : s.status === filter || (filter === 'EM_PAUSA' && s.status === 'PAUSA_EXCEDIDA')))
    .sort((a, b) => rank(a) - rank(b) || new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime());
  const toggle = (f: string) => setFilter(filter === f ? 'ALL' : f);

  return (
    <div className="page">
      <PageHeader
        title="Atividades"
        description="Jornada do dia por loja: registros, exceções e diárias a confirmar."
        actions={<>
          {data && <span className="muted"><Icon name="clock" size={14} /> Atualizado às {fmtTime(data.serverNow)}</span>}
          <button className="sm" onClick={load}><Icon name="refresh" size={16} />Atualizar</button>
        </>}
      />
      <div className="filters">
        {picker}
        <label>Data<input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
      </div>
      {error && <Alert kind="danger">{error}</Alert>}

      <div className="stats">
        <Stat label="Aguardando check-in" value={by('AGUARDANDO_CHECKIN')} tone="neutral" onClick={() => toggle('AGUARDANDO_CHECKIN')} selected={filter === 'AGUARDANDO_CHECKIN'} />
        <Stat label="Em atividade" value={by('EM_ATIVIDADE')} tone="gold" onClick={() => toggle('EM_ATIVIDADE')} selected={filter === 'EM_ATIVIDADE'} />
        <Stat label="Em pausa" value={by('EM_PAUSA') + by('PAUSA_EXCEDIDA')} tone="info" onClick={() => toggle('EM_PAUSA')} selected={filter === 'EM_PAUSA'} />
        <Stat label="Precisam de atenção" value={attentionCount} tone={attentionCount ? 'danger' : 'neutral'} onClick={() => toggle('ATTENTION')} selected={filter === 'ATTENTION'} />
        <Stat label="Finalizadas" value={by('FINALIZADA')} tone="success" onClick={() => toggle('FINALIZADA')} selected={filter === 'FINALIZADA'} />
      </div>
      <p className="muted">O status muda a cada registro do profissional. Entre registros, a localização só é conferida com a tela dele aberta.</p>

      <div className="card tight">
        <div className="card-header">
          <h2>{filter === 'ALL' ? 'Profissionais do dia' : filter === 'ATTENTION' ? 'Precisam de atenção' : label(filter)}</h2>
          {filter !== 'ALL' && <button className="sm ghost" onClick={() => setFilter('ALL')}>Ver todos</button>}
        </div>
        {!data ? <Loading /> : shown.length === 0 ? (
          <EmptyState icon="activity" title={all.length ? 'Ninguém neste filtro' : 'Nenhuma atividade nesta data'} text={all.length ? undefined : 'As atividades aparecem aqui quando há candidaturas aprovadas para o dia.'} />
        ) : (
          <div className="list">
            {shown.map((s) => {
              const pendingExc = s.exceptions.find((x: any) => x.status === 'PENDENTE');
              const stale = ACTIVE.includes(s.status) && (!s.last_ping_at || now - new Date(s.last_ping_at).getTime() > 20 * 60e3);
              return (
                <div key={s.id} className={`list-item${s.att.level ? ` ${s.att.level}` : ''}`}>
                  <div className="item-head">
                    <div className="item-title">
                      <Link to={`/gestao/profissionais/${s.user_id}`}>{s.worker_name}</Link>
                      <span className="muted">{s.title} · {fmtTime(s.starts_at)}–{fmtTime(s.ends_at)}</span>
                    </div>
                    <div className="row">
                      {s.confirmation && <StatusBadge status={s.confirmation}>Diária: {label(s.confirmation)}</StatusBadge>}
                      <StatusBadge status={s.status} />
                    </div>
                  </div>

                  {s.att.reasons.length > 0 && (
                    <div className="row">{s.att.reasons.map((r: string) => <StatusBadge key={r} tone={s.att.level === 'urgent' ? 'danger' : 'warning'}>{r}</StatusBadge>)}</div>
                  )}

                  {s.events.length > 0 && (
                    <div className="timeline">
                      {s.events.map((e: any) => (
                        <span key={e.id} className={`event${e.has_selfie ? '' : ' no-thumb'}`} title={e.distance_m != null ? `${Math.round(e.distance_m)} m da loja · precisão ${Math.round(e.accuracy_m)} m` : undefined}>
                          {e.has_selfie && <a href={`/api/files/selfie/${e.id}`} target="_blank" rel="noreferrer"><img className="thumb" src={`/api/files/selfie/${e.id}`} alt={`Selfie: ${label(e.type)}`} loading="lazy" /></a>}
                          <span><b>{label(e.type)}</b> {fmtTime(e.occurred_at)}</span>
                          {e.validation !== 'GPS_VALIDADO' && <span className="origin">{label(e.validation)}</span>}
                        </span>
                      ))}
                    </div>
                  )}

                  {ACTIVE.includes(s.status) && (
                    <div className="muted">
                      <Icon name="pin" size={14} />{' '}
                      {stale
                        ? `Localização não atualizada ${s.last_ping_at ? `desde ${fmtTime(s.last_ping_at)}` : 'desde o último registro'} (tela do profissional fechada ou sem sinal).`
                        : `Última localização às ${fmtTime(s.last_ping_at)} · ${s.last_ping_inside ? 'dentro do raio' : 'fora do raio'} (${Math.round(s.last_ping_distance_m)} m, precisão ${Math.round(s.last_ping_accuracy_m)} m)`}
                    </div>
                  )}
                  {s.alerts?.map((a: any) => (
                    <div key={a.id} className={`row${a.acknowledged_at ? ' muted' : ''}`}>
                      <span className={a.acknowledged_at ? '' : 'text-danger strong'}>Saída do raio às {fmtTime(a.at)} · {Math.round(a.distance_m)} m da loja (precisão {Math.round(a.accuracy_m)} m)</span>
                      {a.acknowledged_at ? <span>· ciente</span> : <button className="sm" disabled={busy === `ack:${a.id}`} onClick={() => ack(a.id)}>Ciente</button>}
                    </div>
                  ))}

                  {pendingExc && (
                    <div className="subpanel stack">
                      <h3>Exceção pedida: {label(pendingExc.type)} às {fmtTime(pendingExc.requested_at)}</h3>
                      <div className="row" style={{ alignItems: 'flex-start' }}>
                        <a href={`/api/files/exception/${pendingExc.id}`} target="_blank" rel="noreferrer">
                          <img className="thumb" src={`/api/files/exception/${pendingExc.id}`} alt="Selfie do pedido" loading="lazy" />
                        </a>
                        <div className="stack" style={{ gap: 2 }}>
                          <span>Motivo: <b>{label(pendingExc.reason)}</b>{pendingExc.distance_m != null && ` · ${Math.round(pendingExc.distance_m)} m da loja`}</span>
                          {pendingExc.error_message && <span className="muted">Erro: {pendingExc.error_message}</span>}
                          {pendingExc.message && <span>“{pendingExc.message}”</span>}
                        </div>
                      </div>
                      <div className="row">
                        <button className="primary sm" disabled={!!busy} onClick={() => decide(s, pendingExc, 'APROVADA')}>Aprovar exceção</button>
                        <button className="danger sm" disabled={!!busy} onClick={() => decide(s, pendingExc, 'RECUSADA')}>Recusar</button>
                      </div>
                    </div>
                  )}

                  {s.status === 'PENDENTE_DE_FECHAMENTO' && <CloseForm s={s} onDone={afterAction} />}

                  {(s.worked || (!s.confirmation && (s.status === 'FINALIZADA' || s.status === 'AGUARDANDO_CHECKIN'))) && (
                    <div className="row between">
                      <span className="muted">
                        {s.worked && <>Trabalhado <b className="tabular">{fmtMinutes(s.worked.workedMin)}</b> · pausas {fmtMinutes(s.worked.breakMin)} · origem: {s.worked.sources.map(label).join(', ')}</>}
                      </span>
                      {!s.confirmation && (
                        <div className="row">
                          {s.status === 'FINALIZADA' && <button className="primary sm" disabled={!!busy} onClick={() => confirmDaily(s, 'CONCLUIDA')}>Confirmar diária</button>}
                          {s.status === 'AGUARDANDO_CHECKIN' && <button className="danger sm" disabled={!!busy} onClick={() => confirmDaily(s, 'NAO_COMPARECEU')}>Registrar falta</button>}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
