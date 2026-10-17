import { useEffect, useState } from 'react';
import { useMe } from '../App';
import { Icon } from '../components/icons';
import { Alert, EmptyState, Loading, PageHeader, StatusBadge, useAction, useDialog } from '../components/ui';
import { api, fmtMoney, fmtTime, label } from '../lib/api';
import { getPosition } from '../lib/device';

type Job = {
  id: string; title: string; description: string | null; starts_at: string; ends_at: string; daily_value: number;
  break_count: number; break_minutes: number; unit_name: string; unit_address: string; available: number; is_cashier?: number;
  distance_m: number | null; my_status: string | null;
};
const dayBR = (s: string) => new Date(s).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo', weekday: 'long', day: '2-digit', month: '2-digit' });
const dayKey = (t: number | string) => new Date(t).toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });
/** Hoje / Amanhã, no fuso de São Paulo. */
const whenBadge = (startsAt: string, now: number) => (dayKey(startsAt) === dayKey(now) ? 'Hoje' : dayKey(startsAt) === dayKey(now + 86400e3) ? 'Amanhã' : null);
/** Quanto falta para o check-in abrir (15 min antes do início). */
function checkinIn(startsAt: string, now: number) {
  const min = Math.ceil((new Date(startsAt).getTime() - 15 * 60e3 - now) / 60000);
  if (min <= 0) return 'Check-in aberto agora';
  if (min < 60) return `Check-in em ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `Check-in em ${h}h${min % 60 ? String(min % 60).padStart(2, '0') : ''}`;
  const d = Math.round(h / 24);
  return `Check-in em ${d} dia${d > 1 ? 's' : ''}`;
}
const km = (m: number) => (m < 1000 ? `${m} m` : `${(m / 1000).toFixed(1).replace('.', ',')} km`);

const REQUIRED_DOCS = ['SELFIE', 'CPF', 'RG', 'COMPROVANTE'];

export default function Vagas() {
  const { me } = useMe();
  const { toast } = useDialog();
  const { busy, run } = useAction();
  // Aprovação automática exige os documentos aprovados pela UpService (uma vez só).
  const docsApproved = REQUIRED_DOCS.every((t) => me.documents.some((d) => d.type === t && d.status === 'APROVADO'));
  const [jobs, setJobs] = useState<Job[]>();
  const [where, setWhere] = useState<{ lat: number; lng: number } | null>(null);
  const [geo, setGeo] = useState<'loading' | 'ok' | 'off'>('loading');
  const [error, setError] = useState('');
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 30000); return () => clearInterval(t); }, []);

  const load = (pos = where) => api<Job[]>(`/jobs${pos ? `?lat=${pos.lat}&lng=${pos.lng}` : ''}`).then(setJobs, (e) => setError(e.message));

  useEffect(() => {
    getPosition()
      .then((p) => {
        const pos = { lat: p.coords.latitude, lng: p.coords.longitude };
        setWhere(pos);
        setGeo('ok');
        load(pos);
      })
      .catch(() => { setGeo('off'); load(null); });
  }, []);

  async function apply(j: Job) {
    let r: { status: string; position?: number } | undefined;
    if (await run(j.id, async () => { r = await api(`/jobs/${j.id}/apply`, { body: {} }); })) {
      toast(r?.status === 'APROVADA' ? 'Vaga confirmada! No dia, faça o check-in pelo app.' : `Vaga cheia: você é o nº ${r?.position} da reserva. Se abrir uma posição, você é chamado automaticamente.`);
      load();
    }
  }

  return (
    <div className="page">
      <PageHeader title="Vagas disponíveis" description={geo === 'ok' ? 'Primeiro as lojas mais perto de você; entre elas, as que começam antes.' : 'As que começam antes aparecem primeiro.'} />
      {geo === 'off' && <Alert kind="info">Permita a localização no navegador para ver primeiro as lojas mais próximas. Ela só é usada para ordenar a lista.</Alert>}
      {error && <Alert kind="danger">{error}</Alert>}
      {!docsApproved && <Alert kind="warning">Seus documentos estão em análise pela UP Service. Assim que forem aprovados, é só escolher a vaga: a confirmação é na hora.</Alert>}
      {!jobs ? <Loading text={geo === 'loading' ? 'Buscando sua localização…' : 'Carregando vagas…'} /> : jobs.length === 0 ? (
        <div className="card"><EmptyState icon="briefcase" title="Nenhuma vaga aberta no momento" text="Novas vagas aparecem aqui assim que forem publicadas." /></div>
      ) : (
        <div className="grid-2">
          {jobs.map((j) => (
            <article key={j.id} className="card stack">
              <div className="row between">
                <h2>{j.title}{whenBadge(j.starts_at, now) && <span className={`when-badge${whenBadge(j.starts_at, now) === 'Hoje' ? ' today' : ''}`}>{whenBadge(j.starts_at, now)}</span>}</h2>
                {j.distance_m != null && <StatusBadge tone="info"><Icon name="pin" size={12} />{km(j.distance_m)}</StatusBadge>}
              </div>
              <div>
                <div className="strong">{j.unit_name}</div>
                <div className="muted">{j.unit_address}</div>
              </div>
              <div className="row between">
                <span><Icon name="clock" size={14} /> <span style={{ textTransform: 'capitalize' }}>{dayBR(j.starts_at)}</span> · {fmtTime(j.starts_at)}–{fmtTime(j.ends_at)}</span>
                <span className="money">{fmtMoney(j.daily_value)}</span>
              </div>
              <div className={`checkin-in${new Date(j.starts_at).getTime() - now < 3 * 3600e3 ? ' soon' : ''}`}><Icon name="clock" size={14} /> {checkinIn(j.starts_at, now)}</div>
              <div className="muted">
                {j.break_count ? `${j.break_count} pausa(s) de ${j.break_minutes} min` : 'Sem pausas'} · {j.available ? `${j.available} vaga(s) livre(s)` : 'Sem vagas livres'}
              </div>
              {!!j.is_cashier && <p className="cashier-note"><Icon name="wallet" size={14} /> Função de caixa: se faltar dinheiro no caixa ao fim do expediente, a diferença é abatida da sua diária. Você pode pedir revisão uma vez, pela Carteira.</p>}
              {j.description && <p className="muted">{j.description}</p>}
              {j.my_status ? (
                <StatusBadge status={j.my_status} tone={j.my_status === 'PENDENTE' ? 'info' : undefined}>{j.my_status === 'PENDENTE' ? 'Você está na reserva' : `Sua candidatura: ${label(j.my_status)}`}</StatusBadge>
              ) : (
                <button className={`big${j.available ? ' primary' : ''}`} disabled={!docsApproved || busy === j.id} onClick={() => apply(j)}>
                  {busy === j.id ? 'Enviando…' : j.available ? 'Quero esta vaga' : 'Entrar na reserva'}
                </button>
              )}
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
