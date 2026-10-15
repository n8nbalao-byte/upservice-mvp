import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMe } from '../App';
import { Icon, type IconName } from '../components/icons';
import { Alert, Loading } from '../components/ui';
import { api, fmtMoney, fmtTime, label, todayBR } from '../lib/api';

type App = { id: string; status: string; title: string; starts_at: string; ends_at: string; daily_value: string; unit_name: string; session_id: string | null; session_status: string | null; confirmation: string | null };
type Data = { summary: Record<string, number>; apps: App[]; jobs: { my_status: string | null; available: number }[]; strikes: number; strikesToBlock: number };

const TZ = 'America/Sao_Paulo';
const ACTIVE = ['AGUARDANDO_CHECKIN', 'EM_ATIVIDADE', 'EM_PAUSA', 'PAUSA_EXCEDIDA', 'PENDENTE_DE_EXCECAO', 'PENDENTE_DE_FECHAMENTO'];
const DOCS = ['SELFIE', 'CPF', 'RG', 'COMPROVANTE'];

const dayOf = (iso: string) => new Date(iso).toLocaleDateString('sv-SE', { timeZone: TZ });
function when(iso: string) {
  const day = dayOf(iso);
  const tomorrow = new Date(Date.now() + 86400e3).toLocaleDateString('sv-SE', { timeZone: TZ });
  if (day === todayBR()) return 'Hoje';
  if (day === tomorrow) return 'Amanhã';
  const s = new Date(iso).toLocaleDateString('pt-BR', { timeZone: TZ, weekday: 'short', day: '2-digit', month: '2-digit' });
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function Tile({ to, icon, tone, value, title, hint }: { to: string; icon: IconName; tone: string; value: string | number; title: string; hint: string }) {
  return (
    <Link to={to} className={`tile tone-${tone}`}>
      <span className="ic"><Icon name={icon} size={20} /></span>
      <span className="v">{value}</span>
      <span className="t">{title}</span>
      <span className="h">{hint}</span>
    </Link>
  );
}

/** Início do profissional: tudo numa tela de celular, sem rolagem; cada cartão abre a tela completa. */
export default function Inicio() {
  const { me } = useMe();
  const [data, setData] = useState<Data>();
  const [error, setError] = useState('');
  useEffect(() => {
    Promise.all([api('/me/summary'), api<App[]>('/me/applications'), api('/jobs'), api('/me/occurrences')])
      .then(([summary, apps, jobs, occ]) => setData({ summary, apps, jobs, strikes: occ.strikes, strikesToBlock: occ.strikesToBlock }), (e) => setError(e.message));
  }, []);

  if (!data) return error ? <Alert kind="danger">{error}</Alert> : <Loading />;

  // Em andamento primeiro; depois a próxima diária aprovada que ainda não terminou.
  const upcoming = data.apps
    .filter((a) => a.status === 'APROVADA' && a.session_id && ACTIVE.includes(a.session_status ?? '') && !a.confirmation)
    .sort((a, b) => Number(a.session_status === 'AGUARDANDO_CHECKIN') - Number(b.session_status === 'AGUARDANDO_CHECKIN') || +new Date(a.starts_at) - +new Date(b.starts_at));
  const next = upcoming[0];
  const running = next && next.session_status !== 'AGUARDANDO_CHECKIN';
  const openJobs = data.jobs.filter((j) => !j.my_status && j.available > 0).length;
  const pending = data.apps.filter((a) => a.status === 'PENDENTE').length;
  const step = !me.profile ? 1 : !DOCS.every((t) => me.documents.some((d) => d.type === t && d.status !== 'REJEITADO')) ? 2 : 3;
  const docsWaiting = me.documents.filter((d) => d.status === 'PENDENTE').length;
  const strikeTone = data.strikes >= data.strikesToBlock - 1 ? 'danger' : data.strikes ? 'warning' : 'accent';
  const today = new Date().toLocaleDateString('pt-BR', { timeZone: TZ, weekday: 'long', day: 'numeric', month: 'long' });

  return (
    <div className="page worker-home">
      <header>
        <h1>Olá, {me.user.name.split(/\s+/)[0]}!</h1>
        <p className="muted">{today.charAt(0).toUpperCase() + today.slice(1)}</p>
      </header>

      {next ? (
        <Link to={`/atividade/${next.session_id}`} className={`hero${running ? ' running' : ''}`}>
          <span className="eyebrow">{running ? label(next.session_status) : 'Próxima diária'}</span>
          <strong>{next.title}</strong>
          <span>{next.unit_name}</span>
          <span className="when"><Icon name="clock" size={16} />{when(next.starts_at)} · {fmtTime(next.starts_at)} às {fmtTime(next.ends_at)}</span>
          <span className="cta">{running ? 'Abrir atividade' : dayOf(next.starts_at) === todayBR() ? 'Fazer check-in' : 'Ver detalhes'}<Icon name="chevronRight" size={18} /></span>
        </Link>
      ) : (
        <Link to="/vagas" className="hero idle">
          <span className="eyebrow">Nenhuma diária marcada</span>
          <strong>{openJobs ? `${openJobs} vaga(s) esperando por você` : 'Fique de olho nas novas vagas'}</strong>
          <span className="cta">Ver vagas<Icon name="chevronRight" size={18} /></span>
        </Link>
      )}

      <div className="tiles">
        <Tile to="/vagas" icon="briefcase" tone="info" value={openJobs} title="Vagas abertas" hint="Para se candidatar" />
        <Tile to="/minhas" icon="clock" tone="warning" value={pending} title="Na reserva" hint="Chamado automático se abrir vaga" />
        <Tile to="/minhas" icon="wallet" tone="accent" value={fmtMoney(data.summary.valor)} title="A receber" hint={`${data.summary.concluidas} diária(s) concluída(s)`} />
        <Tile to="/ocorrencias" icon="alert" tone={strikeTone} value={`${data.strikes} de ${data.strikesToBlock}`} title="Faltas" hint="Desde o último bloqueio" />
      </div>

      <Link to="/cadastro" className={`profile-row${me.complete ? '' : ' todo'}`}>
        <Icon name={me.complete ? 'check' : 'user'} />
        <span>
          <b>{me.complete ? 'Cadastro completo' : `Complete seu cadastro · etapa ${step} de 3`}</b>
          <small>{me.complete ? (docsWaiting ? `${docsWaiting} documento(s) em análise` : 'Dados e documentos em dia') : 'Necessário para se candidatar às vagas'}</small>
        </span>
        <Icon name="chevronRight" size={18} />
      </Link>
    </div>
  );
}
