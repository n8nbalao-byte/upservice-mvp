import { useEffect, useState } from 'react';
import { api, fmtDate, fmtMoney } from '../lib/api';
import { Icon } from './icons';
import { StatusBadge, reasonOpts, useAction, useDialog } from './ui';

type Quebra = {
  id: string; amount: string; final_amount: string | null; reason: string; status: 'ATIVA' | 'CANCELADA'; cancel_reason: string | null;
  title: string; starts_at: string; unit_name: string;
  review_id: string | null; review_protocol: string | null; review_status: string | null; review_message: string | null; review_reason: string | null;
};

/** Gestão: quebras de caixa do profissional (das lojas do gestor). Decide o pedido de revisão (manter, ajustar para
 *  menos ou cancelar) e cancela lançamento errado. Só aparece se houver alguma quebra. */
export function QuebrasCaixa({ workerId, onChange }: { workerId: string; onChange: () => void }) {
  const { ask } = useDialog();
  const { busy, run } = useAction();
  const [items, setItems] = useState<Quebra[]>([]);
  const load = () => api<Quebra[]>(`/manage/workers/${workerId}/quebras`).then(setItems, () => setItems([]));
  useEffect(() => { load(); }, [workerId]);
  const done = () => { load(); onChange(); };
  if (!items.length) return null;

  async function decide(qb: Quebra, decision: 'MANTIDA' | 'AJUSTADA' | 'CANCELADA') {
    const current = Number(qb.final_amount ?? qb.amount);
    let newAmount: string | null = null;
    if (decision === 'AJUSTADA') {
      newAmount = await ask({ title: 'Ajustar o valor da quebra de caixa', message: `Valor atual: ${fmtMoney(current)}. Informe o novo valor (menor).`, label: 'Novo valor (R$)', confirmText: 'Continuar' });
      if (newAmount === null) return;
    }
    const title = { MANTIDA: 'Manter a quebra de caixa?', AJUSTADA: `Ajustar para R$ ${newAmount}?`, CANCELADA: 'Cancelar a quebra de caixa?' }[decision];
    const reason = await ask(reasonOpts(title, { message: `Pedido ${qb.review_protocol}: "${qb.review_message}". A decisão é final e o profissional é avisado.`, confirmText: 'Registrar decisão' }));
    if (reason === null) return;
    if (await run(qb.id, () => api(`/manage/contestations/${qb.review_id}/decide`, { body: { decision, reason, newAmount } }), 'Decisão registrada.')) done();
  }
  async function cancel(qb: Quebra) {
    const reason = await ask(reasonOpts('Cancelar o lançamento da quebra de caixa?', { message: 'O valor volta para o A receber do profissional, que é avisado.', confirmText: 'Cancelar lançamento', tone: 'danger' }));
    if (reason === null) return;
    if (await run(qb.id, () => api(`/manage/quebras/${qb.id}/cancel`, { body: { reason } }), 'Quebra de caixa cancelada.')) done();
  }

  return (
    <section className="card tight" aria-label="Quebras de caixa">
      <div className="card-header"><h2>Quebras de caixa</h2><span className="sub">Abatidas do A receber; não são ocorrências</span></div>
      <ul className="wallet-items">
        {items.map((qb) => (
          <li key={qb.id} className={qb.status === 'CANCELADA' ? 'is-canceled' : ''}>
            <span className="wallet-kind cash"><Icon name="wallet" size={16} /></span>
            <span className="wallet-what">
              <b>{fmtMoney(Number(qb.final_amount ?? qb.amount))}{qb.final_amount != null && <small> (lançada {fmtMoney(Number(qb.amount))})</small>}</b>
              <small>{fmtDate(qb.starts_at)} · {qb.title} · {qb.unit_name}</small>
              <small>Motivo: {qb.reason}</small>
              {qb.review_id && <small>Pedido de revisão {qb.review_protocol}: "{qb.review_message}"{qb.review_reason ? ` · decisão: ${qb.review_reason}` : ''}</small>}
              {qb.status === 'CANCELADA' && <small>Cancelada: {qb.cancel_reason}</small>}
            </span>
            <span className="row wrap">
              {qb.status === 'CANCELADA' ? <StatusBadge status="CANCELADA" /> : qb.review_status === 'ABERTA' ? (
                <>
                  <button className="sm" disabled={busy === qb.id} onClick={() => decide(qb, 'MANTIDA')}>Manter</button>
                  <button className="sm" disabled={busy === qb.id} onClick={() => decide(qb, 'AJUSTADA')}>Ajustar valor</button>
                  <button className="sm danger" disabled={busy === qb.id} onClick={() => decide(qb, 'CANCELADA')}>Cancelar quebra</button>
                </>
              ) : (
                <>
                  {qb.review_status && <StatusBadge tone="info">Revisão: {qb.review_status.toLowerCase()}</StatusBadge>}
                  <button className="sm ghost" disabled={busy === qb.id} onClick={() => cancel(qb)}>Cancelar lançamento</button>
                </>
              )}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
