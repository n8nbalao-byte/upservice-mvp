import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Alert, EmptyState, Loading, PageHeader, Stat, StatusBadge, useAction, useDialog } from '../components/ui';
import { api, fmtDateTime, fmtMoney, label } from '../lib/api';

/** Desistência pelo app até 2 h antes do início (mesma regra do servidor). */
const WITHDRAW_LIMIT_MS = 2 * 3600e3;
const ACTIVE = ['AGUARDANDO_CHECKIN', 'EM_ATIVIDADE', 'EM_PAUSA', 'PAUSA_EXCEDIDA', 'PENDENTE_DE_EXCECAO', 'PENDENTE_DE_FECHAMENTO'];

export default function Minhas() {
  const { confirm } = useDialog();
  const { busy, run } = useAction();
  const [summary, setSummary] = useState<Record<string, number>>();
  const [apps, setApps] = useState<any[]>();
  const [error, setError] = useState('');

  const load = () => Promise.all([api('/me/summary').then(setSummary), api('/me/applications').then(setApps)]).catch((e) => setError(e.message));
  useEffect(() => { load(); }, []);

  async function cancel(a: any) {
    const approved = a.status === 'APROVADA';
    if (!(await confirm({
      title: approved ? 'Desistir desta diária?' : 'Sair da reserva?',
      message: `${a.title} · ${a.unit_name}${approved ? '. A vaga passa para a próxima pessoa da reserva.' : ''}`,
      confirmText: approved ? 'Desistir da diária' : 'Sair da reserva', tone: 'danger',
    }))) return;
    if (await run(a.id, () => api(`/me/applications/${a.id}/cancel`, { body: {} }), approved ? 'Você desistiu da diária.' : 'Você saiu da reserva.')) load();
  }

  const upcoming = (apps ?? []).filter((a) => a.status === 'APROVADA' && ACTIVE.includes(a.session_status) && !a.confirmation);
  const others = (apps ?? []).filter((a) => !upcoming.includes(a));

  const card = (a: any) => {
    const st = a.confirmation ?? a.session_status ?? a.status;
    return (
      <article key={a.id} className="card stack">
        <div className="row between"><h2>{a.title}</h2>{a.status === 'PENDENTE' ? <StatusBadge tone="info">Na reserva · nº {a.reserve_position}</StatusBadge> : <StatusBadge status={st} />}</div>
        <div className="muted">{a.unit_name} · {fmtDateTime(a.starts_at)}</div>
        <div className="row between">
          <span className="money">{fmtMoney(a.daily_value)}</span>
          <div className="row">
            {a.status === 'APROVADA' && a.session_id && <Link className={`btn${upcoming.includes(a) ? ' primary' : ''}`} to={`/atividade/${a.session_id}`}>{upcoming.includes(a) ? 'Abrir atividade' : 'Ver registros'}</Link>}
            {a.status === 'PENDENTE' && <button className="sm ghost text-danger" disabled={busy === a.id} onClick={() => cancel(a)}>Sair da reserva</button>}
            {a.status === 'APROVADA' && a.session_status === 'AGUARDANDO_CHECKIN' && new Date(a.starts_at).getTime() - Date.now() > WITHDRAW_LIMIT_MS && (
              <button className="sm ghost text-danger" disabled={busy === a.id} onClick={() => cancel(a)}>Desistir</button>
            )}
          </div>
        </div>
        {a.cancel_reason && <Alert kind="warning">Motivo do cancelamento: {a.cancel_reason}</Alert>}
      </article>
    );
  };

  return (
    <div className="page">
      <PageHeader title="Minhas diárias" description="Suas candidaturas, atividades e o valor das diárias concluídas." />
      {error && <Alert kind="danger">{error}</Alert>}
      {summary && (
        <div className="stats">
          <Stat label="Aprovadas" value={summary.aprovadas} tone="accent" />
          <Stat label="Comparecidas" value={summary.comparecidas} tone="info" />
          <Stat label="Concluídas" value={summary.concluidas} tone="success" />
          <Stat label="A receber" value={fmtMoney(summary.valor)} tone="accent" hint="Diárias concluídas e confirmadas" />
        </div>
      )}
      {!apps ? <Loading /> : apps.length === 0 ? (
        <div className="card"><EmptyState icon="briefcase" title="Você ainda não se candidatou" text="Veja as vagas disponíveis e candidate-se." action={<Link className="btn primary" to="/vagas">Ver vagas</Link>} /></div>
      ) : (
        <>
          {upcoming.length > 0 && <section className="stack"><h2 className="section-title">Próximas e em andamento</h2><div className="grid-2">{upcoming.map(card)}</div></section>}
          {others.length > 0 && <section className="stack"><h2 className="section-title">Histórico e candidaturas</h2><div className="grid-2">{others.map(card)}</div></section>}
        </>
      )}
      <p className="muted">{label('CONCLUIDA')} = diária confirmada pelo gestor da loja. O app não faz pagamentos.</p>
    </div>
  );
}
