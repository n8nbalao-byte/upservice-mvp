import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMe } from '../App';
import { useFit, useMedia } from '../components/fit';
import { Icon } from '../components/icons';
import { Alert, EmptyState, Loading, StatusBadge, useAction, useDialog } from '../components/ui';
import { api, fmtMoney, fmtTime, todayBR } from '../lib/api';
import { hms, jornadaStatus, minutesLeft, type JornadaEvent, type JornadaSession } from '../lib/jornada';

type App = {
  id: string; status: string; title: string; starts_at: string; ends_at: string; unit_name: string; reserve_position: number;
  session_id: string | null; session_status: string | null; confirmation: string | null;
};

const TZ = 'America/Sao_Paulo';
/** Desistência pelo app até 2 h antes do início (mesma regra do servidor). */
const WITHDRAW_LIMIT_MS = 2 * 3600e3;
const OPEN = ['AGUARDANDO_CHECKIN', 'EM_ATIVIDADE', 'EM_PAUSA', 'PAUSA_EXCEDIDA', 'PENDENTE_DE_EXCECAO', 'PENDENTE_DE_FECHAMENTO'];
const REQUIRED_DOCS = ['SELFIE', 'CPF', 'RG', 'COMPROVANTE'];
/** Tela que ocupa exatamente o celular: a lista mostra só as linhas que cabem. */
const FIT = '(max-width: 1023px) and (min-height: 540px)';
const ROW = 61;

const dayOf = (iso: string) => new Date(iso).toLocaleDateString('sv-SE', { timeZone: TZ });
function when(iso: string) {
  const day = dayOf(iso);
  if (day === todayBR()) return 'Hoje';
  if (day === new Date(Date.now() + 86400e3).toLocaleDateString('sv-SE', { timeZone: TZ })) return 'Amanhã';
  const s = new Date(iso).toLocaleDateString('pt-BR', { timeZone: TZ, weekday: 'short', day: '2-digit', month: '2-digit' });
  return s.charAt(0).toUpperCase() + s.slice(1).replace('.', '');
}

function Bar({ label: text, pct, note, tone }: { label: string; pct: number; note: string; tone?: string }) {
  return (
    <div className={`jbar${tone ? ` tone-${tone}` : ''}`}>
      <div className="jbar-head"><span>{text}</span><b>{pct}%</b></div>
      <div className="jbar-track" role="progressbar" aria-label={text} aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}><span style={{ width: `${pct}%` }} /></div>
      <small>{note}</small>
    </div>
  );
}

/** Relógio em anel + barras da jornada de hoje. Relógio do servidor; recarrega a sessão a cada 30 s. */
function Jornada({ app }: { app: App }) {
  const [data, setData] = useState<{ session: JornadaSession; events: JornadaEvent[] }>();
  const offset = useRef(0);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const load = () => api<{ session: JornadaSession; events: JornadaEvent[]; serverNow: string }>(`/me/sessions/${app.session_id}`).then((d) => {
      offset.current = new Date(d.serverNow).getTime() - Date.now();
      setData(d);
    }, () => {});
    load();
    const poll = setInterval(load, 30000);
    const tick = setInterval(() => setNow(Date.now() + offset.current), 1000);
    return () => { clearInterval(poll); clearInterval(tick); };
  }, [app.session_id]);

  if (!data) return <section className="card jornada"><Loading /></section>;
  const j = jornadaStatus(data.session, data.events, now);
  const r = 52;
  const c = 2 * Math.PI * r;
  const late = (j.clock?.ms ?? 0) < 0;
  return (
    <section className={`card jornada phase-${j.phase}`}>
      <div className="jornada-title">
        <b>{app.title}</b>
        <span className="muted">{app.unit_name} · {fmtTime(app.starts_at)}–{fmtTime(app.ends_at)}</span>
      </div>
      <div className="jornada-body">
        <div className={`jclock${late ? ' late' : ''}`} role="timer" aria-label={j.clock ? `${j.clock.label}: ${hms(j.clock.ms)}` : 'Jornada encerrada'}>
          <svg viewBox="0 0 120 120" aria-hidden="true">
            <circle cx="60" cy="60" r={r} className="track" />
            <circle cx="60" cy="60" r={r} className="fill" strokeDasharray={`${(j.total / 100) * c} ${c}`} />
          </svg>
          <div className="jclock-center">
            <strong>{j.clock ? hms(j.clock.ms) : 'Encerrada'}</strong>
            <small>{j.clock?.label ?? 'Jornada finalizada'}</small>
          </div>
        </div>
        <div className="jbars">
          {j.phase === 'antes' ? (
            <p className="muted">O check-in abre 15 minutos antes do início. Na loja, toque em "Fazer check-in" e segure o botão.</p>
          ) : (
            <>
              <Bar label="Jornada" pct={j.total} note={j.clock && j.clock.ms > 0 ? `faltam ${minutesLeft(j.clock.ms)}` : 'concluída'} />
              {j.part && (
                <Bar
                  label={j.part.label}
                  pct={j.part.pct}
                  tone={j.phase === 'pausa' ? 'warning' : j.part.ready ? 'success' : undefined}
                  note={j.part.ready ? 'Você já pode fazer sua pausa' : j.part.msLeft >= 0 ? `faltam ${minutesLeft(j.part.msLeft)}` : 'tempo encerrado'}
                />
              )}
            </>
          )}
        </div>
      </div>
      {j.phase !== 'fim' && <Link className="btn primary jornada-cta" to={`/atividade/${app.session_id}`}>{j.phase === 'antes' ? 'Fazer check-in' : 'Abrir atividade'}<Icon name="chevronRight" size={18} /></Link>}
    </section>
  );
}

/** Tela principal do profissional: valor a receber, jornada de hoje (relógio e barras) e próximas diárias. */
export default function Minhas() {
  const { me } = useMe();
  const { confirm } = useDialog();
  const { busy, run } = useAction();
  const [valor, setValor] = useState<number>();
  const [apps, setApps] = useState<App[]>();
  const [history, setHistory] = useState(false);
  const [error, setError] = useState('');
  const fit = useMedia(FIT) && !history;
  const [listRef, rows] = useFit(ROW);

  const load = () => Promise.all([
    api<{ valor: number }>('/me/summary').then((s) => setValor(s.valor)),
    api<App[]>('/me/applications').then(setApps),
  ]).catch((e) => setError(e.message));
  useEffect(() => { load(); }, []);

  async function cancel(a: App) {
    const approved = a.status === 'APROVADA';
    if (!(await confirm({
      title: approved ? 'Desistir desta diária?' : 'Sair da reserva?',
      message: `${a.title} · ${a.unit_name}${approved ? '. A vaga passa para a próxima pessoa da reserva.' : ''}`,
      confirmText: approved ? 'Desistir da diária' : 'Sair da reserva', tone: 'danger',
    }))) return;
    if (await run(a.id, () => api(`/me/applications/${a.id}/cancel`, { body: {} }), approved ? 'Você desistiu da diária.' : 'Você saiu da reserva.')) load();
  }

  if (!apps) return error ? <Alert kind="danger">{error}</Alert> : <Loading />;

  // Jornada de hoje: a que está em andamento ou a primeira aprovada que começa hoje.
  const open = apps
    .filter((a) => a.status === 'APROVADA' && a.session_id && OPEN.includes(a.session_status ?? '') && !a.confirmation)
    .sort((a, b) => Number(a.session_status === 'AGUARDANDO_CHECKIN') - Number(b.session_status === 'AGUARDANDO_CHECKIN') || +new Date(a.starts_at) - +new Date(b.starts_at));
  const today = open.find((a) => a.session_status !== 'AGUARDANDO_CHECKIN' || dayOf(a.starts_at) === todayBR());
  const next = [...open.filter((a) => a !== today), ...apps.filter((a) => a.status === 'PENDENTE')]
    .sort((a, b) => +new Date(a.starts_at) - +new Date(b.starts_at));
  const past = apps.filter((a) => a !== today && !next.includes(a));
  const shown = fit && rows ? next.slice(0, rows) : next;
  const docsPending = !REQUIRED_DOCS.every((t) => me.documents.some((d) => d.type === t && d.status === 'APROVADO'));
  const day = new Date().toLocaleDateString('pt-BR', { timeZone: TZ, weekday: 'long', day: 'numeric', month: 'long' });

  const item = (a: App) => (
    <li key={a.id} className="next-item">
      <span className="next-day">{when(a.starts_at)}</span>
      <span className="next-what"><b>{fmtTime(a.starts_at)}–{fmtTime(a.ends_at)}</b><small>{a.unit_name}</small></span>
      {a.status === 'PENDENTE' ? (
        <>
          <StatusBadge tone="info">Reserva nº {a.reserve_position}</StatusBadge>
          <button className="sm ghost text-danger" disabled={busy === a.id} onClick={() => cancel(a)} aria-label={`Sair da reserva de ${a.title}`}>Sair</button>
        </>
      ) : new Date(a.starts_at).getTime() - Date.now() > WITHDRAW_LIMIT_MS ? (
        <button className="sm ghost text-danger" disabled={busy === a.id} onClick={() => cancel(a)} aria-label={`Desistir de ${a.title}`}>Desistir</button>
      ) : <StatusBadge status="APROVADA">Confirmada</StatusBadge>}
    </li>
  );

  return (
    <div className={`page diarias${fit ? ' fit' : ''}`}>
      <header className="diarias-head">
        <h1>Olá, {me.user.name.split(/\s+/)[0]}!</h1>
        <p className="muted">{day.charAt(0).toUpperCase() + day.slice(1)}</p>
      </header>
      {error && <Alert kind="danger">{error}</Alert>}
      {(!me.complete || docsPending) && (
        <Link to="/cadastro" className="diarias-warn"><Icon name="alert" size={18} />{!me.complete ? 'Complete seu cadastro para pegar vagas' : 'Documentos em análise pela UP Service'}<Icon name="chevronRight" size={16} /></Link>
      )}

      <section className="card receber" aria-label="A receber">
        <span>A receber</span>
        <strong>{valor == null ? '—' : fmtMoney(valor)}</strong>
      </section>

      {today && <Jornada key={today.id} app={today} />}

      <section className="card tight next">
        <div className="card-header"><h2>Próximas diárias</h2>{next.length > shown.length && <button className="link" onClick={() => setHistory(true)}>Ver todas ({next.length})</button>}</div>
        {next.length === 0 ? <p className="next-empty">Nenhuma diária marcada.</p> : <ul className="next-list" ref={listRef}>{shown.map(item)}</ul>}
        <div className="card-footer">
          <button className="link" onClick={() => setHistory(!history)}>{history ? 'Esconder histórico' : 'Ver histórico'}</button>
          <Link className="link" to="/vagas">Ver vagas</Link>
        </div>
      </section>

      {history && (
        <section className="card tight">
          <div className="card-header"><h2>Histórico</h2></div>
          {past.length === 0 ? <EmptyState title="Nada por aqui ainda" /> : (
            <ul className="next-list">
              {past.map((a) => (
                <li key={a.id} className="next-item">
                  <span className="next-day">{when(a.starts_at)}</span>
                  <span className="next-what"><b>{a.title}</b><small>{a.unit_name}</small></span>
                  <StatusBadge status={a.confirmation ?? a.session_status ?? a.status} />
                  {a.session_id && <Link className="btn sm ghost" to={`/atividade/${a.session_id}`}>Registros</Link>}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}
