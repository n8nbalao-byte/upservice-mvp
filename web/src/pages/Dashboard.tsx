import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useInbox, useMe } from '../App';
import { useFit, useMedia } from '../components/fit';
import { Icon, type IconName } from '../components/icons';
import { Alert, EmptyState, Loading, StatusBadge, type Tone } from '../components/ui';
import { api, fmtDate, fmtMoney, fmtTime, label } from '../lib/api';
import { GROUPS } from './Pendencias';

type Dash = {
  serverNow: string;
  workers: number;
  openJobs: { jobs: number; positions: number; filled: number };
  pendingDocuments: { documents: number; people: number };
  cadastros: { usuarios: number | null; profissionais: number; habilitados: number; docPendentes: number; emAnalise: number };
  today: Record<string, number>;
  latestJobs: { id: string; title: string; unit_name: string; starts_at: string; ends_at: string; daily_value: string; positions: number; status: string; applications: number; approved: number }[];
};

const REFRESH_MS = 60000;
const RECENT = 4;
const JOBS = 6;
/** Tela larga e alta o bastante: o painel ocupa exatamente a altura da janela, sem rolagem. */
const FIT = '(min-width: 1100px) and (min-height: 600px)';
const RECENT_ROW = 57;
const JOB_ROW = 43;
const JOB_HEAD = 35;
const PRIORITY = ['Alta', 'Média', 'Baixa'];
/** Situação das diárias de hoje, na ordem do dia; a cor de cada fatia é a mesma da legenda. */
const DAY: { label: string; statuses: string[]; color: string }[] = [
  { label: 'Aguardando', statuses: ['AGUARDANDO_CHECKIN'], color: '#9aa9b2' },
  { label: 'Em atividade', statuses: ['EM_ATIVIDADE'], color: '#2563a8' },
  { label: 'Em pausa', statuses: ['EM_PAUSA', 'PAUSA_EXCEDIDA'], color: '#e0a106' },
  { label: 'Exceção', statuses: ['PENDENTE_DE_EXCECAO'], color: '#e5484d' },
  { label: 'Sem checkout', statuses: ['PENDENTE_DE_FECHAMENTO'], color: '#6d4fc4' },
  { label: 'Finalizadas', statuses: ['FINALIZADA'], color: '#12a07a' },
];

const today = (now: Date) => {
  const s = now.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'America/Sao_Paulo' });
  return s.charAt(0).toUpperCase() + s.slice(1);
};

function Kpi({ to, icon, tone, title, value, sub, hot }: { to: string; icon: IconName; tone: string; title: string; value: number; sub: string; hot?: boolean }) {
  return (
    <Link to={to} className={`kpi tone-${tone}${hot ? ' hot' : ''}`}>
      <span className="ic"><Icon name={icon} size={24} /></span>
      <span>
        <span className="t">{title}</span>
        <span className="v">{value.toLocaleString('pt-BR')}</span>
        <span className="s">{sub}</span>
      </span>
    </Link>
  );
}

function Donut({ parts, center, caption }: { parts: { value: number; color: string }[]; center: string; caption: string }) {
  const r = 70;
  const c = 2 * Math.PI * r;
  const total = parts.reduce((t, p) => t + p.value, 0);
  let offset = 0;
  return (
    <div className="donut">
      <svg viewBox="0 0 180 180" width="180" height="180" aria-hidden="true">
        <circle cx="90" cy="90" r={r} fill="none" stroke="#e6ecef" strokeWidth="18" />
        {total > 0 && parts.filter((p) => p.value).map((p, i) => {
          const len = (p.value / total) * c;
          const el = <circle key={i} cx="90" cy="90" r={r} fill="none" stroke={p.color} strokeWidth="18" strokeDasharray={`${len} ${c - len}`} strokeDashoffset={-offset} />;
          offset += len;
          return el;
        })}
      </svg>
      <div className="center"><strong>{center}</strong><small>{caption}</small></div>
    </div>
  );
}

/** Painel inicial do gestor/admin: resumo do dia com dados reais, no escopo de unidades do usuário. */
export default function Dashboard() {
  const { me } = useMe();
  const { items, refresh: refreshInbox } = useInbox();
  const [data, setData] = useState<Dash>();
  const [error, setError] = useState('');
  const fit = useMedia(FIT);
  const [recentRef, recentFit] = useFit(RECENT_ROW);
  const [jobsRef, jobsFit] = useFit(JOB_ROW, JOB_HEAD);
  const load = () => api<Dash>('/manage/dashboard').then((d) => { setData(d); setError(''); }, (e) => setError(e.message));
  useEffect(() => {
    load();
    const t = setInterval(load, REFRESH_MS);
    return () => clearInterval(t);
  }, []);

  if (!data) return error ? <Alert kind="danger">{error}</Alert> : <Loading />;

  const rank = (kind: string) => GROUPS.findIndex((g) => g.kinds.some((k) => k.kind === kind));
  const iconOf = (kind: string) => GROUPS.flatMap((g) => g.kinds).find((k) => k.kind === kind)?.icon ?? 'info';
  const recent = [...items].sort((a, b) => rank(a.kind) - rank(b.kind) || +new Date(b.at) - +new Date(a.at)).slice(0, fit ? recentFit || RECENT : RECENT);
  const urgent = items.filter((i) => rank(i.kind) === 0).length;
  const count = (statuses: string[]) => statuses.reduce((t, s) => t + (data.today[s] ?? 0), 0);
  const parts = DAY.map((d) => ({ ...d, value: count(d.statuses) }));
  const dayTotal = parts.reduce((t, p) => t + p.value, 0);
  const done = count(['FINALIZADA']);
  const working = count(['EM_ATIVIDADE', 'EM_PAUSA', 'PAUSA_EXCEDIDA']);
  const c = data.cadastros;
  const jobs = data.latestJobs.slice(0, fit ? jobsFit || JOBS : JOBS);
  const quick: { to: string; icon: IconName; text: string; short: string }[] = [
    { to: '/gestao/vagas', icon: 'briefcase', text: 'Publicar vaga', short: 'Vagas' },
    { to: '/gestao/atividades', icon: 'calendar', text: 'Acompanhar atividades', short: 'Atividades' },
    { to: '/gestao/documentos', icon: 'file', text: 'Revisar documentos', short: 'Documentos' },
    { to: '/gestao/relatorios', icon: 'chart', text: 'Gerar relatório', short: 'Relatório' },
    ...(me.user.role === 'ADMINISTRADOR' ? [{ to: '/admin/unidades', icon: 'store' as const, text: 'Cadastrar unidade', short: 'Unidades' }] : []),
  ];

  return (
    <div className="page dashboard">
      <header className="dash-head">
        <div>
          <h1>Olá, {me.user.name.split(/\s+/)[0]}!</h1>
          <p className="desc">Confira o resumo das operações de hoje.</p>
        </div>
        <div className="dash-when">
          <div className="lines">
            <span><Icon name="calendar" size={18} />{today(new Date(data.serverNow))}</span>
            <span className="muted"><i className="live" />Última atualização: {fmtTime(data.serverNow)}</span>
          </div>
          <button className="icon-btn" onClick={() => { load(); refreshInbox(); }} aria-label="Atualizar" title="Atualizar"><Icon name="refresh" /></button>
        </div>
      </header>
      {error && <Alert kind="danger">{error}</Alert>}

      <div className="kpis">
        {/* Cadastro: quantos estão habilitados para trabalhar (4 documentos aprovados, termos e conta ativa) e quantos não. */}
        <Kpi to={c.usuarios == null ? '/gestao/atividades' : '/admin/usuarios'} icon="users" tone="accent" title={c.usuarios == null ? 'Profissionais cadastrados' : 'Usuários cadastrados'} value={c.usuarios ?? c.profissionais} sub={c.usuarios == null ? `${working} em atividade agora` : `${c.profissionais.toLocaleString('pt-BR')} profissionais`} />
        <Kpi to={c.usuarios == null ? '/gestao/atividades' : '/admin/usuarios'} icon="check" tone="success" title="Habilitados para trabalhar" value={c.habilitados} sub={`de ${c.profissionais.toLocaleString('pt-BR')} profissionais${c.profissionais ? ` (${Math.round((c.habilitados / c.profissionais) * 100)}%)` : ''}`} />
        <Kpi to="/gestao/cadastros" icon="alert" tone="danger" title="Com documento pendente" value={c.docPendentes} sub={c.emAnalise ? `${c.emAnalise} em análise · ver a lista` : 'Ver a lista'} hot={c.docPendentes > 0} />
        <Kpi to="/gestao/vagas" icon="briefcase" tone="info" title="Vagas abertas" value={data.openJobs.jobs} sub={`${data.openJobs.filled} de ${data.openJobs.positions} posições preenchidas`} />
        <Kpi to="/gestao/pendencias" icon="alert" tone="warning" title="Pendências" value={items.length} sub={urgent ? `${urgent} ${urgent === 1 ? 'pede' : 'pedem'} atenção agora` : 'Nada urgente no momento'} hot={items.length > 0} />
        <Kpi to="/gestao/documentos" icon="file" tone="purple" title="Documentos em análise" value={data.pendingDocuments.documents} sub={`de ${data.pendingDocuments.people} profissional(is)`} />
      </div>

      <div className="dash-grid">
        <section className="card dash-card">
          <div className="card-header">
            <h2><Icon name="home" />Pendências recentes {items.length > 0 && <span className="count-pill">{items.length}</span>}</h2>
            <Link className="see-all" to="/gestao/pendencias">Ver todas</Link>
          </div>
          {recent.length === 0 ? <EmptyState title="Tudo em dia" text="Nenhuma pendência no momento." /> : (
            <div className="recent" ref={recentRef}>
              {recent.map((i) => {
                const tone: Tone = GROUPS[rank(i.kind)]?.tone ?? 'info';
  return (
                  <Link key={i.key} to={i.link}>
                    <span className={`ic tone-${tone}`}><Icon name={iconOf(i.kind)} /></span>
                    <span className="what"><strong>{i.title}</strong><small>{i.detail.split(' · ').map(label).join(' · ')}</small></span>
                    <span className="when">{fmtDate(i.at)} · {fmtTime(i.at)}</span>
                    <StatusBadge tone={tone}>{PRIORITY[rank(i.kind)] ?? 'Baixa'}</StatusBadge>
                  </Link>
                );
              })}
            </div>
          )}
        </section>

        <section className="card dash-card">
          <div className="card-header">
            <h2>Atividades do dia {data.today.exceptions > 0 && <Link to="/gestao/pendencias" className="badge tone-danger plain">{data.today.exceptions} exceção(ões) a decidir</Link>}</h2>
            <Link className="see-all" to="/gestao/atividades">Ver todas</Link>
          </div>
          {dayTotal === 0 ? <EmptyState icon="calendar" title="Nenhuma diária hoje" text="As diárias aprovadas para hoje aparecem aqui." /> : (
            <div className="fill"><div className="donut-wrap">
              <Donut parts={parts} center={`${Math.round((done / dayTotal) * 100)}%`} caption="Concluídas" />
              <div className="legend">
                {parts.map((p) => <div key={p.label}><i style={{ background: p.color }} /><span>{p.label}</span><b>{p.value}</b></div>)}
              </div>
            </div></div>
          )}
        </section>
      </div>

      <div className="dash-grid bottom">
        <section className="card tight dash-card">
          <div className="card-header">
            <h2><Icon name="briefcase" />Últimas vagas</h2>
            <Link className="see-all" to="/gestao/vagas">Ver todas</Link>
          </div>
          {data.latestJobs.length === 0 ? <EmptyState icon="briefcase" title="Nenhuma vaga ainda" /> : (
            <div className="table-wrap" ref={jobsRef}>
              <table className="responsive">
                <thead><tr><th>Cargo</th><th className="opt2">Unidade</th><th>Data e horário</th><th className="num">Valor (R$)</th><th className="num opt">Candidaturas</th><th>Status</th><th>Ações</th></tr></thead>
                <tbody>
                  {jobs.map((j) => (
                    <tr key={j.id}>
                      <td data-label="Cargo" className="strong">{j.title}</td>
                      <td data-label="Unidade" className="nowrap opt2">{j.unit_name}</td>
                      <td data-label="Data e horário" className="nowrap">{fmtDate(j.starts_at).slice(0, 5)} · {fmtTime(j.starts_at)} - {fmtTime(j.ends_at)}</td>
                      <td data-label="Valor (R$)" className="num">{fmtMoney(Number(j.daily_value)).replace('R$', '').trim()}</td>
                      <td data-label="Candidaturas" className="num opt">{j.applications}</td>
                      <td data-label="Status"><StatusBadge status={j.status} /></td>
                      <td data-label="Ações"><Link className="icon-btn" to={`/gestao/vagas/${j.id}`} aria-label={`Ver candidaturas de ${j.title}`} title="Ver candidaturas"><Icon name="eye" size={18} /></Link></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="card dash-card">
          <div className="card-header"><h2>Acesso rápido</h2></div>
          <div className="fill">
            <nav className="quick" aria-label="Acesso rápido">
              {quick.map((q) => <Link key={q.to} to={q.to} title={q.text}><Icon name={q.icon} /><span className="long">{q.text}</span><span className="short">{q.short}</span><span className="go"><Icon name="chevronRight" size={18} /></span></Link>)}
            </nav>
          </div>
        </section>
      </div>
    </div>
  );
}
