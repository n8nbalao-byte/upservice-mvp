import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useParams } from 'react-router-dom';
import { Icon } from '../components/icons';
import { Alert, Loading, PageHeader, Stat, StatusBadge } from '../components/ui';
import { ApiError, api, fmtDateTime, fmtMinutes, fmtTime, label, toLocalInput } from '../lib/api';
import { GeoError, Selfie, alertBreakOver, distanceMeters, getPosition } from '../lib/device';

type EventType = 'CHECK_IN' | 'PAUSE_START' | 'PAUSE_END' | 'CHECK_OUT';
type Failure = { type: EventType; reason: string; error: string; pos?: GeolocationPosition };
type Data = { session: any; events: any[]; exceptions: any[]; worked: { workedMin: number; breakMin: number; sources: string[] } | null; serverNow: string };

const ACTIVE = ['EM_ATIVIDADE', 'EM_PAUSA', 'PAUSA_EXCEDIDA'];
const coords = (pos?: GeolocationPosition) => (pos ? { lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy } : {});

export default function Atividade() {
  const { id } = useParams();
  const [data, setData] = useState<Data>();
  const [pending, setPending] = useState<{ type: EventType; pos: GeolocationPosition } | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null); // última falha: permite pedir exceção
  const [excepting, setExcepting] = useState<Failure | null>(null); // pedido de exceção em preenchimento
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [now, setNow] = useState(Date.now());
  const clockOffset = useRef(0);
  const alerted = useRef(false);

  const load = () => api<Data>(`/me/sessions/${id}`).then((d) => {
    clockOffset.current = new Date(d.serverNow).getTime() - Date.now();
    setData(d);
  }, (e) => setError(e.message));

  useEffect(() => {
    load();
    const poll = setInterval(load, 30000);
    const tick = setInterval(() => setNow(Date.now() + clockOffset.current), 1000);
    return () => { clearInterval(poll); clearInterval(tick); };
  }, [id]);

  const s = data?.session;
  const breakLeft = s?.break_ends_at ? new Date(s.break_ends_at).getTime() - now : null;
  const onBreak = s?.status === 'EM_PAUSA' || s?.status === 'PAUSA_EXCEDIDA';
  const [lastPing, setLastPing] = useState<string | null>(null);

  // Em atividade e com a tela visível: confere a localização a cada 10 min e ao voltar para a aba (v4.0 §9).
  // Com a tela fechada nada é lido; o gestor vê "localização não atualizada".
  useEffect(() => {
    if (s?.status !== 'EM_ATIVIDADE') return;
    let stopped = false;
    const ping = async () => {
      if (document.visibilityState !== 'visible') return;
      try {
        const p = await getPosition();
        if (stopped) return;
        const r = await api(`/sessions/${id}/ping`, { body: { lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy } });
        if (!r.ignored) setLastPing(new Date().toISOString());
      } catch { /* sem GPS agora: tenta na próxima */ }
    };
    ping();
    const timer = setInterval(ping, 10 * 60e3);
    const onVisible = () => { if (document.visibilityState === 'visible') ping(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { stopped = true; clearInterval(timer); document.removeEventListener('visibilitychange', onVisible); };
  }, [s?.status, id]);

  useEffect(() => {
    if (!onBreak) alerted.current = false;
    else if (breakLeft != null && breakLeft <= 0 && !alerted.current) {
      alerted.current = true;
      alertBreakOver();
    }
  }, [onBreak, breakLeft]);

  async function run(what: string, fn: () => Promise<unknown>) {
    setError('');
    setBusy(what);
    try {
      await fn();
      return true;
    } catch (e: any) {
      setError(e.message);
      return false;
    } finally {
      setBusy('');
    }
  }

  async function start(type: EventType) {
    setError('');
    setFailure(null);
    setBusy('Obtendo localização…');
    try {
      const pos = await getPosition();
      const here = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      const dist = distanceMeters(here, { lat: s.unit_lat, lng: s.unit_lng });
      if (pos.coords.accuracy > s.max_accuracy_m) {
        throw Object.assign(new Error(`Precisão do GPS baixa (${Math.round(pos.coords.accuracy)} m). Vá para uma área aberta e tente de novo.`), { reason: 'PRECISAO_INSUFICIENTE', pos });
      }
      if (dist > s.radius_m) {
        throw Object.assign(new Error(`Você está a ${Math.round(dist)} m da loja. É preciso estar a até ${s.radius_m} m.`), { reason: 'FORA_DO_RAIO', pos });
      }
      if (type === 'PAUSE_START' && 'Notification' in window && Notification.permission === 'default') Notification.requestPermission();
      setPending({ type, pos });
    } catch (e: any) {
      setError(e.message);
      setFailure({ type, reason: e instanceof GeoError ? e.reason : e.reason ?? 'OUTRO', error: e.message, pos: e.pos });
    } finally {
      setBusy('');
    }
  }

  async function send(selfie: string) {
    if (!pending) return;
    const { type, pos } = pending;
    setPending(null);
    await run('Enviando…', async () => {
      try {
        const { token } = await api(`/sessions/${id}/token`, { body: {} });
        await api(`/sessions/${id}/events`, { body: { type, token, selfie, ...coords(pos), clientTs: new Date(pos.timestamp).toISOString() } });
        await load();
      } catch (e: any) {
        if (e instanceof ApiError && e.status === 422) setFailure({ type, reason: 'OUTRO', error: e.message, pos });
        throw e;
      }
    });
  }

  function openException(f: Failure) {
    setError('');
    setFailure(null);
    setMessage('');
    setExcepting(f);
    // Localização é opcional no pedido, mas ajuda o gestor: tenta pegar sem bloquear.
    if (!f.pos) getPosition().then((pos) => setExcepting((x) => x && { ...x, pos }), () => {});
  }

  async function sendException(selfie: string) {
    if (!excepting) return;
    const f = excepting;
    setExcepting(null);
    await run('Enviando solicitação…', async () => {
      const { token } = await api(`/sessions/${id}/token`, { body: {} });
      await api(`/sessions/${id}/exceptions`, { body: { type: f.type, token, reason: f.reason, errorMessage: f.error, message, selfie, ...coords(f.pos) } });
      await load();
    });
  }

  async function reportEnd(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    await run('Enviando…', async () => {
      await api(`/me/sessions/${id}/reported-end`, { body: { time: new Date(String(f.get('time'))).toISOString(), note: f.get('note') } });
      await load();
    });
  }

  if (!data) return error ? <Alert kind="danger">{error}</Alert> : <Loading />;

  const opensAt = new Date(s.starts_at).getTime() - 2 * 3600e3;
  const closesAt = new Date(s.starts_at).getTime() + 15 * 60e3;
  const endsAt = new Date(s.ends_at).getTime();
  const pendingExc = data.exceptions.find((x) => x.status === 'PENDENTE');
  const lastExc = data.exceptions.at(-1);
  const clock = (ms: number) => `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, '0')}`;

  const action = (type: EventType, text: string, primary = true) => (
    <button className={`big ${primary ? 'primary' : ''}`} disabled={!!busy} onClick={() => start(type)}>{text}</button>
  );

  return (
    <div className="page" style={{ maxWidth: 720 }}>
      <PageHeader back={{ to: '/minhas', label: 'Minhas diárias' }} title={s.title} description={<>{s.unit_name} · {s.unit_address}</>} />

      <section className="status-hero" aria-live="polite">
        <span className="muted">{fmtDateTime(s.starts_at)} até {fmtTime(s.ends_at)}{s.break_count > 0 && ` · pausas: ${s.breaks_used} de ${s.break_count} (${s.break_minutes} min)`}</span>
        <span className="state">{label(s.status)}</span>
        {onBreak && breakLeft != null && (
          <div className="timer" style={{ color: breakLeft <= 0 ? '#f5b74a' : '#fff' }}>{breakLeft > 0 ? clock(breakLeft) : 'Pausa encerrada!'}</div>
        )}
        {s.status === 'EM_ATIVIDADE' && (lastPing ?? s.last_ping_at) && (
          <span className="muted"><Icon name="pin" size={14} /> Localização verificada às {fmtTime(lastPing ?? s.last_ping_at)} · conferida a cada 10 min com esta tela aberta</span>
        )}
      </section>

      {error && <Alert kind="danger">{error}</Alert>}
      {busy && <div className="loading"><span className="spinner" />{busy}</div>}
      {failure && !busy && (
        <Alert kind="warning" action={<button className="sm" onClick={() => openException(failure)}>Solicitar exceção</button>}>
          Está na loja e mesmo assim não conseguiu registrar? Peça ao gestor para aprovar este registro como exceção.
        </Alert>
      )}
      {lastExc?.status === 'RECUSADA' && s.status !== 'PENDENTE_DE_EXCECAO' && (
        <Alert kind="danger">Sua última solicitação de exceção ({label(lastExc.type)}) foi recusada: {lastExc.decision_reason}</Alert>
      )}

      {pending ? (
        <div className="card stack">
          <h2>Selfie para registrar: {label(pending.type)}</h2>
          <Selfie onCapture={send} onCancel={() => setPending(null)} />
        </div>
      ) : excepting ? (
        <div className="card stack">
          <h2>Solicitar exceção: {label(excepting.type)}</h2>
          <p className="muted">Motivo: {label(excepting.reason)}. O registro fica com o horário de agora e só vale depois que o gestor aprovar; ele aparece como exceção, não como GPS validado.</p>
          <label>Mensagem para o gestor<textarea rows={2} maxLength={500} value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Ex.: estou no estoque, o GPS não pega aqui dentro" /></label>
          <Selfie onCapture={sendException} onCancel={() => setExcepting(null)} />
        </div>
      ) : (
        <div className="stack">
          {/* Mesma janela do servidor (2 h antes até 15 min depois), mostrada antes de pedir GPS e selfie à toa. */}
          {s.status === 'AGUARDANDO_CHECKIN' && (
            now < opensAt ? <button className="big" disabled>Check-in liberado às {fmtTime(new Date(opensAt).toISOString())}</button>
              : now > closesAt ? (
                now <= endsAt ? (
                  <div className="card stack">
                    <Alert kind="warning">Prazo de check-in encerrado às {fmtTime(new Date(closesAt).toISOString())}.</Alert>
                    <button className="big primary" disabled={!!busy} onClick={() => openException({ type: 'CHECK_IN', reason: 'FORA_DO_HORARIO', error: 'Check-in depois da tolerância de 15 minutos' })}>Pedir check-in com atraso</button>
                  </div>
                ) : <Alert kind="danger">O horário desta vaga terminou.</Alert>
              )
                : action('CHECK_IN', 'Fazer check-in')
          )}
          {s.status === 'EM_ATIVIDADE' && action('CHECK_OUT', 'Fazer checkout')}
          {s.status === 'EM_ATIVIDADE' && s.breaks_used < s.break_count && action('PAUSE_START', 'Iniciar pausa', false)}
          {onBreak && action('PAUSE_END', 'Retornar da pausa')}
          {ACTIVE.includes(s.status) && now > endsAt && (
            <Alert kind="warning">Checkout pendente: o horário da vaga terminou. Após 30 minutos sem checkout, a atividade fica pendente para o gestor encerrar.</Alert>
          )}
          {s.status === 'PENDENTE_DE_EXCECAO' && pendingExc && (
            <Alert kind="info">Solicitação de exceção ({label(pendingExc.type)}) enviada às {fmtTime(pendingExc.requested_at)}. Aguarde o gestor analisar.</Alert>
          )}
          {s.status === 'PENDENTE_DE_FECHAMENTO' && (
            <form className="card form" onSubmit={reportEnd}>
              <div><h2>Checkout pendente</h2><p className="muted">Informe o horário em que você saiu; o gestor vai encerrar a atividade.</p></div>
              {s.reported_end_at && <Alert kind="info">Você informou saída às {fmtDateTime(s.reported_end_at)}.</Alert>}
              <label>Horário de saída<input name="time" type="datetime-local" required defaultValue={toLocalInput(s.reported_end_at ?? s.ends_at)} /></label>
              <label>Observação <span className="hint">(opcional)</span><input name="note" maxLength={500} /></label>
              <button className="primary big" disabled={!!busy}>{s.reported_end_at ? 'Atualizar horário' : 'Enviar horário'}</button>
            </form>
          )}
          {s.status === 'AGUARDANDO_CHECKIN' && <p className="muted">Check-in liberado de 2 horas antes até 15 minutos depois do início, a até {s.radius_m} m da loja. Cada registro pede localização e uma selfie.</p>}
        </div>
      )}

      {data.worked && (
        <div className="stats">
          <Stat label="Tempo trabalhado" value={fmtMinutes(data.worked.workedMin)} tone="success" hint={`Origem: ${data.worked.sources.map(label).join(', ')}`} />
          <Stat label="Pausas" value={fmtMinutes(data.worked.breakMin)} tone="info" />
        </div>
      )}

      {data.events.length > 0 && (
        <div className="card tight">
          <div className="card-header"><h2>Registros</h2><span className="sub">Horário oficial do servidor</span></div>
          <table>
            <tbody>
              {data.events.map((e) => (
                <tr key={e.id}>
                  <td className="strong">{label(e.type)}</td>
                  <td className="tabular">{fmtTime(e.occurred_at)}</td>
                  <td className="num"><StatusBadge status={e.validation} />{e.distance_m != null && <span className="muted">{Math.round(e.distance_m)} m da loja</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
