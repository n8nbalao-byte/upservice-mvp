// Estrutura do app: barra lateral (desktop, recolhível), gaveta (celular), abas inferiores do profissional e barra superior.
import { useEffect, useState, type ReactNode } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { isBlocked, label, type Me } from '../lib/api';
import { Icon, type IconName } from './icons';

type Item = { to: string; text: string; icon: IconName; count?: number };
type Group = { title?: string; items: Item[] };

const store = {
  get: (k: string) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* sem armazenamento: só não lembra */ } },
};

function groupsFor(me: Me, inboxCount: number): Group[] {
  const role = me.user.role;
  if (role === 'PROFISSIONAL') {
    if (isBlocked(me.user.status)) return [{ items: [{ to: '/ocorrencias', text: 'Ocorrências', icon: 'alert' }] }];
    return [{ items: [
      { to: '/vagas', text: 'Vagas', icon: 'briefcase' },
      { to: '/minhas', text: 'Minhas diárias', icon: 'wallet' },
      { to: '/cadastro', text: 'Cadastro', icon: 'user' },
      { to: '/ocorrencias', text: 'Ocorrências', icon: 'alert' },
    ] }];
  }
  const groups: Group[] = [
    { title: 'Operação', items: [
      { to: '/gestao/pendencias', text: 'Pendências', icon: 'inbox', count: inboxCount },
      { to: '/gestao/atividades', text: 'Atividades', icon: 'activity' },
      { to: '/gestao/vagas', text: 'Vagas', icon: 'briefcase' },
    ] },
    { title: 'Pessoas', items: [
      { to: '/gestao/documentos', text: 'Documentos', icon: 'file' },
      { to: '/gestao/ocorrencias', text: 'Ocorrências', icon: 'alert' },
    ] },
    { title: 'Análise', items: [{ to: '/gestao/relatorios', text: 'Relatórios', icon: 'chart' }] },
  ];
  if (role === 'ADMINISTRADOR') groups.push({ title: 'Administração', items: [
    { to: '/admin/unidades', text: 'Unidades', icon: 'store' },
    { to: '/admin/usuarios', text: 'Usuários', icon: 'users' },
  ] });
  return groups;
}

const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]).join('').toUpperCase();

export function Shell({ me, inboxCount, onLogout, children }: { me: Me; inboxCount: number; onLogout: () => void; children: ReactNode }) {
  const [collapsed, setCollapsed] = useState(() => store.get('nav-collapsed') === '1');
  const [drawer, setDrawer] = useState(false);
  const { pathname } = useLocation();
  useEffect(() => setDrawer(false), [pathname]);

  const worker = me.user.role === 'PROFISSIONAL';
  const groups = groupsFor(me, inboxCount);
  const toggle = () => { store.set('nav-collapsed', collapsed ? '0' : '1'); setCollapsed(!collapsed); };

  return (
    <div className={`app${collapsed ? ' collapsed' : ''}${drawer ? ' drawer-open' : ''}${worker ? ' worker' : ''}`}>
      <aside className="sidebar" aria-label="Navegação principal">
        <div className="brand">
          <img className="full" src="/logo.png" alt="UP Service Intermediações" />
          <img className="mark" src="/logo-mark.png" alt="UP Service" />
        </div>
        {groups.map((g, i) => (
          <nav key={i} className="nav-group" aria-label={g.title}>
            {g.title && <div className="nav-group-title">{g.title}</div>}
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
          <button className="collapse-btn" onClick={toggle} aria-label={collapsed ? 'Expandir menu' : 'Recolher menu'}>
            <Icon name={collapsed ? 'chevronRight' : 'chevronLeft'} size={18} />
            {!collapsed && 'Recolher'}
          </button>
        </div>
      </aside>
      <div className="backdrop" onClick={() => setDrawer(false)} />

      <div className="main">
        <header className="topbar">
          <button className="icon-btn menu-btn" onClick={() => setDrawer(true)} aria-label="Abrir menu"><Icon name="menu" /></button>
          <img className="topbar-logo" src="/logo-mark.png" alt="UP Service" />
          <div className="spacer" />
          {!worker && (
            <NavLink to="/gestao/pendencias" className="icon-btn" aria-label={`Pendências: ${inboxCount}`} title="Pendências">
              <Icon name="bell" />
              {inboxCount > 0 && <span className="dot">{inboxCount}</span>}
            </NavLink>
          )}
          <div className="user-chip">
            <span className="avatar" aria-hidden="true">{initials(me.user.name)}</span>
            <span className="who"><strong>{me.user.name}</strong><small>{label(me.user.role)}</small></span>
          </div>
          <button className="icon-btn" onClick={onLogout} aria-label="Sair" title="Sair"><Icon name="logout" /></button>
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
