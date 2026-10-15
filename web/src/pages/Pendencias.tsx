import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useInbox, type InboxItem } from '../App';
import { Icon, type IconName } from '../components/icons';
import { Alert, EmptyState, PageHeader, Stat, StatusBadge, type Tone } from '../components/ui';
import { fmtDateTime, fmtTime, label } from '../lib/api';

/** Itens visíveis por tipo antes de "Mostrar todos" (os mais antigos primeiro). */
const PREVIEW = 5;

/** Prioridade de leitura: o que exige ação imediata primeiro, a rotina por último. */
export const GROUPS: { title: string; description: string; tone: Tone; kinds: { kind: string; icon: IconName }[] }[] = [
  { title: 'Atenção agora', description: 'Afetam a jornada em andamento.', tone: 'danger', kinds: [
    { kind: 'SAIDA_DO_RAIO', icon: 'pin' }, { kind: 'EXCECAO', icon: 'alert' }, { kind: 'CHECKOUT_PENDENTE', icon: 'clock' },
  ] },
  { title: 'Decisões', description: 'Contestações e ocorrências aguardando análise.', tone: 'warning', kinds: [
    { kind: 'CONTESTACAO', icon: 'info' }, { kind: 'OCORRENCIA', icon: 'alert' },
  ] },
  { title: 'Rotina', description: 'Documentos de cadastro para revisar (candidaturas são aprovadas automaticamente).', tone: 'info', kinds: [
    { kind: 'CANDIDATURA', icon: 'briefcase' }, { kind: 'DOCUMENTO', icon: 'file' },
  ] },
];

/** Tudo o que espera decisão do gestor/admin. Atualiza sozinha (App consulta a cada 20 s) e avisa quando surge algo novo. */
export default function Pendencias() {
  const { items, updatedAt, refresh } = useInbox();
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [permission, setPermission] = useState(() => ('Notification' in window ? Notification.permission : 'denied'));
  const enable = () => Notification.requestPermission().then(setPermission);
  const byKind = (kind: string) => items.filter((i) => i.kind === kind);
  const groupCount = (g: (typeof GROUPS)[number]) => g.kinds.reduce((t, k) => t + byKind(k.kind).length, 0);

  return (
    <div className="page">
      <PageHeader
        title="Pendências"
        description="Tudo o que espera uma decisão sua, do mais urgente para a rotina."
        actions={<>
          <span className="muted"><Icon name="clock" size={14} /> {updatedAt ? `Atualizado às ${fmtTime(updatedAt)} · a cada 20 s` : 'Carregando…'}</span>
          <button className="sm" onClick={refresh}><Icon name="refresh" size={16} />Atualizar</button>
        </>}
      />

      {permission === 'default' && (
        <Alert kind="info" action={<button className="primary sm" onClick={enable}>Ativar notificações</button>}>
          Ative as notificações do navegador para ser avisado de novas pendências mesmo com o app em outra aba.
        </Alert>
      )}
      {permission === 'denied' && 'Notification' in window && (
        <Alert kind="warning">As notificações estão bloqueadas neste navegador. Os avisos aparecem só aqui e no sino, com som.</Alert>
      )}

      <div className="stats">
        {GROUPS.map((g) => <Stat key={g.title} label={g.title} value={groupCount(g)} tone={groupCount(g) ? g.tone : 'neutral'} hint={g.description} />)}
      </div>

      {items.length === 0 ? (
        <div className="card"><EmptyState title="Tudo em dia" text="Nenhuma pendência no momento. Quando surgir algo, você recebe um aviso aqui." /></div>
      ) : GROUPS.map((g) => {
        if (!groupCount(g)) return null;
        return (
          <section key={g.title} className="stack">
            <h2 className="section-title">{g.title}</h2>
            {g.kinds.map(({ kind, icon }) => {
              const list: InboxItem[] = byKind(kind);
              if (!list.length) return null;
              return (
                <div key={kind} className="card tight">
                  <div className="card-header">
                    <h3 className="row"><Icon name={icon} size={18} />{label(kind)}</h3>
                    <StatusBadge tone={g.tone}>{list.length}</StatusBadge>
                  </div>
                  {(expanded[kind] ? list : list.slice(0, PREVIEW)).map((i) => (
                    <Link key={i.key} to={i.link} className="pending-item">
                      <span><b>{i.title}</b><span className="muted" style={{ display: 'block' }}>{i.detail.split(' · ').map(label).join(' · ')}</span></span>
                      <span className="row nowrap"><span className="muted">{fmtDateTime(i.at)}</span><span className="go"><Icon name="chevronRight" size={18} /></span></span>
                    </Link>
                  ))}
                  {list.length > PREVIEW && (
                    <div className="card-footer">
                      <button className="sm ghost" onClick={() => setExpanded({ ...expanded, [kind]: !expanded[kind] })}>
                        {expanded[kind] ? 'Mostrar menos' : `Mostrar todos (${list.length})`}
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </section>
        );
      })}
    </div>
  );
}
