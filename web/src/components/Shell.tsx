// Estrutura do app: barra lateral (desktop, recolhível), gaveta (celular), abas inferiores do profissional e barra superior com busca.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import { api, fmtDate, isBlocked, label, type Me } from '../lib/api';
import { Icon, type IconName } from './icons';

type Item = { to: string; text: string; icon: IconName; count?: number };
type Group = { items: Item[] };
type Results = { workers: { id: string; name: string; status: string }[]; jobs: { id: string; title: string; starts_at: string; unit_name: string }[]; units: { id: string; code: string; name: string }[] };

const store = {
  get: (k: string) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* sem armazenamento: só não lembra */ } },
};

/** Cadastro completo e os 4 documentos (CPF, RG, comprovante e selfie) aprovados: o Cadastro sai da barra e fica no menu do usuário. */
const cadastroAprovado = (me: Me) => me.complete && ['CPF', 'RG', 'COMPROVANTE', 'SELFIE'].every((t) => me.documents.some((d) => d.type === t && d.status === 'APROVADO'));

function groupsFor(me: Me, inboxCount: number, gamification = false): Group[] {
  const role = me.user.role;
  if (role === 'PROFISSIONAL') {
    if (isBlocked(me.user.status)) return [{ items: [{ to: '/ocorrencias', text: 'Ocorrências', icon: 'alert' }] }];
    return [{ items: [
      { to: '/minhas', text: 'Minhas diárias', icon: 'home' },
      ...(gamification ? [{ to: '/estrelas', text: 'Estrelas', icon: 'star' as const }] : []),
      { to: '/vagas', text: 'Vagas', icon: 'briefcase' },
      ...(cadastroAprovado(me) ? [] : [{ to: '/cadastro', text: 'Cadastro', icon: 'user' as const }]),
      { to: '/ocorrencias', text: 'Ocorrências', icon: 'alert' },
    ] }];
  }
  const groups: Group[] = [
    { items: [
      { to: '/gestao/inicio', text: 'Dashboard', icon: 'home' },
      { to: '/gestao/pendencias', text: 'Pendências', icon: 'inbox', count: inboxCount },
      { to: '/gestao/vagas', text: 'Vagas', icon: 'briefcase' },
      { to: '/gestao/atividades', text: 'Atividades', icon: 'activity' },
      { to: '/gestao/calendario', text: 'Calendário', icon: 'calendar' },
      { to: '/gestao/relatorios', text: 'Relatórios', icon: 'chart' },
    ] },
    { items: [
      { to: '/gestao/documentos', text: 'Documentos', icon: 'file' },
      { to: '/gestao/ocorrencias', text: 'Ocorrências', icon: 'alert' },
      ...(role === 'ADMINISTRADOR' ? [
        { to: '/admin/unidades', text: 'Unidades', icon: 'store' as const },
        { to: '/admin/usuarios', text: 'Usuários', icon: 'user' as const },
        ...(me.user.isOwner ? [{ to: '/admin/configuracoes', text: 'Configurações', icon: 'sliders' as const }] : []),
      ] : []),
    ] },
  ];
  return groups;
}

const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]).join('').toUpperCase();

/** Busca do topo (gestor/admin): profissionais, vagas e unidades no escopo do usuário. */
function Search() {
  const [term, setTerm] = useState('');
  const [results, setResults] = useState<Results | null>(null);
  const [open, setOpen] = useState(false);
  const { pathname } = useLocation();
  useEffect(() => { setOpen(false); setTerm(''); }, [pathname]);
  useEffect(() => {
    if (term.trim().length < 2) { setResults(null); return; }
    const t = setTimeout(() => api<Results>(`/manage/search?q=${encodeURIComponent(term.trim())}`).then(setResults, () => setResults(null)), 250);
    return () => clearTimeout(t);
  }, [term]);
  const empty = results && !results.workers.length && !results.jobs.length && !results.units.length;

  return (
    <div className="search" onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setOpen(false); }} onKeyDown={(e) => e.key === 'Escape' && setOpen(false)}>
      <Icon name="search" size={18} />
      <input type="search" value={term} onChange={(e) => { setTerm(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)} placeholder="Buscar profissionais, vagas, unidades..." aria-label="Buscar profissionais, vagas e unidades" />
      {open && results && (
        <div className="search-results">
          {empty && <div className="none">Nada encontrado para “{term.trim()}”.</div>}
          {!!results.workers.length && <div className="group-title">Profissionais</div>}
          {results.workers.map((w) => <Link key={w.id} to={`/gestao/profissionais/${w.id}`}><span>{w.name}</span><small>{label(w.status)}</small></Link>)}
          {!!results.jobs.length && <div className="group-title">Vagas</div>}
          {results.jobs.map((j) => <Link key={j.id} to={`/gestao/vagas/${j.id}`}><span>{j.title}</span><small>{j.unit_name} · {fmtDate(j.starts_at)}</small></Link>)}
          {!!results.units.length && <div className="group-title">Unidades</div>}
          {results.units.map((u) => <Link key={u.id} to={`/gestao/atividades?unit=${u.id}`}><span>{u.name}</span><small>{u.code}</small></Link>)}
        </div>
      )}
    </div>
  );
}

export function Shell({ me, inboxCount, onLogout, children }: { me: Me; inboxCount: number; onLogout: () => void; children: ReactNode }) {
  const [collapsed, setCollapsed] = useState(() => store.get('nav-collapsed') === '1');
  const [drawer, setDrawer] = useState(false);
  const userMenu = useRef<HTMLDetailsElement>(null);
  const { pathname } = useLocation();
  useEffect(() => { setDrawer(false); userMenu.current?.removeAttribute('open'); }, [pathname]);

  const [whatsapp, setWhatsapp] = useState<string | null>(null);
  const [gamification, setGamification] = useState(false);
  useEffect(() => { api<{ supportWhatsapp: string | null; gamification?: boolean }>('/config').then((c) => { setWhatsapp(c.supportWhatsapp); setGamification(!!c.gamification); }, () => {}); }, []);
  // WhatsApp do suporte (SUPPORT_WHATSAPP no servidor); enquanto não for definido, abre o e-mail.
  const help = whatsapp
    ? `https://wa.me/${whatsapp}?text=${encodeURIComponent('Olá! Preciso de ajuda com o app UP Service.')}`
    : 'mailto:contato@upserviceintermed.com';

  const worker = me.user.role === 'PROFISSIONAL';
  const selfie = me.documents.find((d) => d.type === 'SELFIE' && d.status !== 'REJEITADO');
  const groups = groupsFor(me, inboxCount, gamification);
  // Desktop: recolhe a barra (preferência lembrada). Celular/tablet: abre a gaveta.
  const menu = () => {
    if (window.matchMedia('(max-width: 1023px)').matches) return setDrawer(true);
    store.set('nav-collapsed', collapsed ? '0' : '1');
    setCollapsed(!collapsed);
  };

  return (
    <div className={`app${collapsed ? ' collapsed' : ''}${drawer ? ' drawer-open' : ''}${worker ? ' worker' : ''}`}>
      <aside className="sidebar" aria-label="Navegação principal">
        {groups.map((g, i) => (
          <nav key={i} className="nav-group" aria-label={i ? 'Cadastros' : 'Operação'}>
            {g.items.map((it) => (
              <NavLink key={it.to} to={it.to} className="nav-link" title={collapsed ? it.text : undefined}>
                <Icon name={it.icon} />
                <span className="nav-label">{it.text}</span>
                {!!it.count && <span className="nav-count">{it.count}</span>}
              </NavLink>
            ))}
          </nav>
        ))}
        <div className="sidebar-footer">
          <a className="help-card" href={help} target="_blank" rel="noopener noreferrer" title="Precisa de ajuda?">
            <Icon name="headset" />
            <strong>Precisa de ajuda?</strong>
            <small>Entre em contato com o suporte.</small>
          </a>
        </div>
      </aside>
      <div className="backdrop" onClick={() => setDrawer(false)} />

      <div className="main">
        <header className="topbar">
          <button className="icon-btn menu-btn" onClick={menu} aria-label="Menu" aria-expanded={drawer || !collapsed}><Icon name="menu" size={22} /></button>
          <span className="topbar-brand">UP Service</span>
          {!worker && <Search />}
          <div className="spacer" />
          {!worker && (
            <NavLink to="/gestao/pendencias" className="icon-btn" aria-label={`Pendências: ${inboxCount}`} title="Pendências">
              <Icon name="bell" size={22} />
              {inboxCount > 0 && <span className="dot">{inboxCount}</span>}
            </NavLink>
          )}
          <span className="divider" />
          <details className="user-menu" ref={userMenu}>
            <summary aria-label="Menu do usuário">
              {selfie ? <img className="avatar" src={`/api/files/doc/${selfie.id}`} alt="" /> : <span className="avatar" aria-hidden="true">{initials(me.user.name)}</span>}
              <span className="who"><strong>{me.user.name}</strong><small>{label(me.user.role)}</small></span>
              <span className="chev"><Icon name="chevronDown" size={18} /></span>
            </summary>
            <div className="menu">
              <div className="email">{me.user.email}</div>
              {!(worker && isBlocked(me.user.status)) && <Link className="menu-link" to="/perfil"><Icon name="user" size={18} />Meu perfil</Link>}
              {worker && !isBlocked(me.user.status) && <Link className="menu-link" to="/cadastro"><Icon name="file" size={18} />Cadastro e documentos</Link>}
              {!worker && <Link className="menu-link" to="/gestao/ajustes"><Icon name="bell" size={18} />Ajustes de notificação</Link>}
              <button className="ghost" onClick={onLogout}><Icon name="logout" size={18} />Sair</button>
            </div>
          </details>
        </header>
        <main className="content">{children}</main>
      </div>

      {worker && groups[0].items.length > 1 && (
        <nav className="bottom-nav" aria-label="Navegação">
          {groups[0].items.map((it) => (
            <NavLink key={it.to} to={it.to}><Icon name={it.icon} size={22} />{it.text.replace('Minhas diárias', 'Diárias')}</NavLink>
          ))}
        </nav>
      )}
    </div>
  );
}
