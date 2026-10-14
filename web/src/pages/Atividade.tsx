import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api, fmtDateTime, fmtMinutes, fmtTime, label } from '../lib/api';
import { Selfie, alertBreakOver, distanceMeters, getPosition } from '../lib/device';

type EventType = 'CHECK_IN' | 'PAUSE_START' | 'PAUSE_END' | 'CHECK_OUT';
type Data = { session: any; events: any[]; worked: { workedMin: number; breakMin: number } | null; serverNow: string };

export default function Atividade() {
  const { id } = useParams();
  const [data, setData] = useState<Data>();
  const [pending, setPending] = useState<{ type: EventType; pos: GeolocationPosition } | null>(null);
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

  useEffect(() => {
    if (!onBreak) alerted.current = false;
    else if (breakLeft != null && breakLeft <= 0 && !alerted.current) {
      alerted.current = true;
      alertBreakOver();
    }
  }, [onBreak, breakLeft]);

  async function start(type: EventType) {
    setError('');
    setBusy('Obtendo localização…');
    try {
      const pos = await getPosition();
      const here = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      const dist = distanceMeters(here, { lat: s.unit_lat, lng: s.unit_lng });
      if (pos.coords.accuracy > s.max_accuracy_m) throw new Error(`Precisão do GPS baixa (${Math.round(pos.coords.accuracy)} m). Vá para uma área aberta e tente de novo.`);
      if (dist > s.radius_m) throw new Error(`Você está a ${Math.round(dist)} m da loja. É preciso estar a até ${s.radius_m} m.`);
      if (type === 'PAUSE_START' && 'Notification' in window && Notification.permission === 'default') Notification.requestPermission();
      setPending({ type, pos });
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy('');
    }
  }

  async function send(selfie: string) {
    if (!pending) return;
    const { type, pos } = pending;
    setPending(null);
    setBusy('Enviando…');
    try {
      const { token } = await api(`/sessions/${id}/token`, { body: {} });
      await api(`/sessions/${id}/events`, {
        body: { type, token, selfie, lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy, clientTs: new Date(pos.timestamp).toISOString() },
      });
      await load();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy('');
    }
  }

  if (!data) return <p>{error || 'Carregando…'}</p>;

  const opensAt = new Date(s.starts_at).getTime() - 2 * 3600e3;
  const closesAt = new Date(s.starts_at).getTime() + 15 * 60e3;

  const action = (type: EventType, text: string, primary = true) => (
    <button className={`big ${primary ? 'primary' : ''}`} disabled={!!busy} onClick={() => start(type)}>{text}</button>
  );

  return (
    <div className="stack">
      <h1>{s.title}</h1>
      <div className="card">
        <div>{s.unit_name} · <span className="muted">{s.unit_address}</span></div>
        <div>{fmtDateTime(s.starts_at)} até {fmtTime(s.ends_at)}</div>
        <div className="row"><span className="badge">{label(s.status)}</span>{s.break_count > 0 && <span className="muted">Pausas: {s.breaks_used} de {s.break_count} ({s.break_minutes} min cada)</span>}</div>
      </div>

      {error && <p className="error">{error}</p>}
      {busy && <p className="notice">{busy}</p>}

      {pending ? (
        <div className="card stack">
          <p>Tire uma selfie para registrar: <b>{label(pending.type)}</b></p>
          <Selfie onCapture={send} onCancel={() => setPending(null)} />
        </div>
      ) : (
        <div className="stack">
          {/* Mesma janela do servidor (2 h antes até 15 min depois), mostrada antes de pedir GPS e selfie à toa. */}
          {s.status === 'AGUARDANDO_CHECKIN' && (
            now < opensAt ? <button className="big" disabled>Check-in liberado às {fmtTime(new Date(opensAt).toISOString())}</button>
              : now > closesAt ? <p className="error">Prazo de check-in encerrado às {fmtTime(new Date(closesAt).toISOString())}. Fale com o gestor da loja.</p>
                : action('CHECK_IN', 'Fazer check-in')
          )}
          {s.status === 'EM_ATIVIDADE' && s.breaks_used < s.break_count && action('PAUSE_START', 'Iniciar pausa', false)}
          {s.status === 'EM_ATIVIDADE' && action('CHECK_OUT', 'Fazer checkout')}
          {onBreak && (
            <>
              <div className={`card timer ${breakLeft! <= 0 ? 'warn' : ''}`}>
                {breakLeft! > 0 ? `${Math.floor(breakLeft! / 60000)}:${String(Math.floor((breakLeft! % 60000) / 1000)).padStart(2, '0')}` : 'Pausa encerrada!'}
              </div>
              {action('PAUSE_END', 'Retornar da pausa')}
            </>
          )}
          {s.status === 'AGUARDANDO_CHECKIN' && <p className="muted">Check-in liberado de 2 horas antes até 15 minutos depois do início, a até {s.radius_m} m da loja.</p>}
        </div>
      )}

      {data.worked && (
        <div className="card">Tempo trabalhado: <b>{fmtMinutes(data.worked.workedMin)}</b> · pausas: {fmtMinutes(data.worked.breakMin)}</div>
      )}

      {data.events.length > 0 && (
        <div className="card">
          <h2>Registros</h2>
          <table>
            <tbody>
              {data.events.map((e) => (
                <tr key={e.id}><td>{label(e.type)}</td><td>{fmtTime(e.occurred_at)}</td><td className="muted">{Math.round(e.distance_m)} m da loja</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
