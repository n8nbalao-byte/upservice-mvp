import { useEffect, useState } from 'react';
import { useMe } from '../App';
import { ChavePix } from '../components/ChavePix';
import { Icon } from '../components/icons';
import { Alert, EmptyState, Loading, PageHeader, useAction, useDialog } from '../components/ui';
import { api, fmtDate, fmtDateTime, fmtMoney } from '../lib/api';

type Item = { kind: 'DIARIA' | 'BONUS'; id: string; date: string; text: string; value: number };
type Pagamento = { id: string; amount: number; paidAt: string; receipt: boolean; receiptMime: string | null; note: string | null };
export type Abatimento = { id: string; date: string; text: string; reason: string; amount: number; finalAmount: number | null; status: 'ATIVA' | 'CANCELADA'; counts: boolean; cancelReason: string | null; review: { protocol: string; status: string; reason: string | null } | null };
export type Wallet = { aReceber: number; diarias: number; bonus: number; quebras: number; pago: number; itens: Item[]; pagamentos: Pagamento[]; abatimentos: Abatimento[] };
const PIX_NAME: Record<string, string> = { CPF: 'CPF', EMAIL: 'E-mail', TELEFONE: 'Celular', ALEATORIA: 'Chave aleatória' };

const REVIEW: Record<string, string> = { ABERTA: 'Revisão em análise', MANTIDA: 'Revisão: mantida', AJUSTADA: 'Revisão: valor ajustado', CANCELADA: 'Revisão: cancelada' };

/** Quebras de caixa: abatimento com o motivo (não é punição). Uma revisão por quebra; a decisão é final. */
function Abatimentos({ items, onChange }: { items: Abatimento[]; onChange: () => void }) {
  const { ask } = useDialog();
  const { busy, run } = useAction();
  async function review(a: Abatimento) {
    const message = await ask({
      title: 'Pedir revisão da quebra de caixa',
      message: `${a.text} · ${fmtMoney(a.finalAmount ?? a.amount)}. Explique o que aconteceu. Você pode pedir revisão uma vez; a decisão do gestor é final.`,
      label: 'O que aconteceu', minLength: 10, maxLength: 1000, multiline: true, confirmText: 'Enviar pedido',
    });
    if (message === null) return;
    if (await run(a.id, () => api('/me/contestations', { body: { cashBreakId: a.id, message } }), 'Pedido de revisão enviado.')) onChange();
  }
  return (
    <section className="card tight" aria-label="Abatimentos: quebra de caixa">
      <div className="card-header"><h2>Abatimentos — quebra de caixa</h2></div>
      <p className="muted" style={{ padding: '0 16px' }}>Em vagas de caixa, a diferença que faltou no caixa ao fim do expediente é abatida do seu A receber.</p>
      <ul className="wallet-items">
        {items.map((a) => (
          <li key={a.id} className={a.status === 'CANCELADA' ? 'is-canceled' : ''}>
            <span className="wallet-kind cash"><Icon name="wallet" size={16} /></span>
            <span className="wallet-what">
              <b>{a.status === 'CANCELADA' ? <s>{fmtMoney(a.finalAmount ?? a.amount)}</s> : `− ${fmtMoney(a.finalAmount ?? a.amount)}`}{a.finalAmount != null && a.status !== 'CANCELADA' && <small> (era {fmtMoney(a.amount)})</small>}</b>
              <small>{fmtDate(a.date)} · {a.text}</small>
              <small>Motivo: {a.reason}</small>
              {a.status === 'CANCELADA' && <small>Cancelada{a.cancelReason ? `: ${a.cancelReason}` : ''}</small>}
              {a.status === 'ATIVA' && !a.counts && <small>Entra no saldo quando a diária for confirmada.</small>}
              {a.review && <small>{REVIEW[a.review.status] ?? 'Revisão'} (protocolo {a.review.protocol}){a.review.reason ? ` · ${a.review.reason}` : ''}</small>}
            </span>
            {a.status === 'ATIVA' && !a.review && <button type="button" className="sm" disabled={busy === a.id} onClick={() => review(a)}>Pedir revisão</button>}
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Carteira do profissional: quanto tem a receber (e de onde vem), a chave Pix e os pagamentos com o comprovante. */
export default function Carteira() {
  const { me, reload } = useMe();
  const [data, setData] = useState<Wallet & { pixType: string | null; pixKey: string | null }>();
  const [error, setError] = useState('');
  const [changing, setChanging] = useState(false);
  const [extrato, setExtrato] = useState(false);
  const load = () => api<Wallet & { pixType: string | null; pixKey: string | null }>('/me/carteira').then(setData, (e) => setError(e.message));
  useEffect(() => { load(); }, []);
  if (error) return <div className="page"><Alert kind="danger">{error}</Alert></div>;
  if (!data) return <div className="page"><Loading /></div>;
  return (
    <div className="page carteira" style={{ maxWidth: 720 }}>
      <PageHeader title="Carteira" description="O que você tem a receber e os pagamentos feitos na sua chave Pix." />
      <section className="card wallet-total" aria-label="A receber">
        <span>A receber</span>
        <strong>{fmtMoney(data.aReceber)}</strong>
        <dl className="wallet-parts">
          <div><dt>Diárias concluídas</dt><dd>{fmtMoney(data.diarias)}</dd></div>
          <div><dt>Bônus ganhos</dt><dd>{fmtMoney(data.bonus)}</dd></div>
          {!!data.abatimentos.length && <div><dt>Quebra de caixa</dt><dd>− {fmtMoney(data.quebras)}</dd></div>}
          <div><dt>Já recebido</dt><dd>− {fmtMoney(data.pago)}</dd></div>
        </dl>
        <button type="button" className="ghost sm" aria-expanded={extrato} onClick={() => setExtrato(!extrato)}>{extrato ? 'Esconder o que compõe' : 'Ver o que compõe'}</button>
        {extrato && (
          <ul className="wallet-items">
            {data.itens.length === 0 ? <li className="muted">Nenhuma diária concluída ainda.</li> : data.itens.map((i) => (
              <li key={i.id}><span className={`wallet-kind ${i.kind === 'BONUS' ? 'bonus' : ''}`}><Icon name={i.kind === 'BONUS' ? 'gift' : 'briefcase'} size={16} /></span><span className="wallet-what"><b>{i.text}</b><small>{fmtDate(i.date)}</small></span><span className="tabular">{fmtMoney(i.value)}</span></li>
            ))}
          </ul>
        )}
      </section>

      <section className="card stack" aria-label="Chave Pix">
        <div className="card-header" style={{ marginBottom: 0 }}><h2>Chave Pix</h2></div>
        {data.pixKey && !changing ? (
          <div className="row wrap between">
            <p><span className="muted">{PIX_NAME[data.pixType ?? ''] ?? 'Chave'}:</span> <strong className="tabular">{data.pixKey}</strong></p>
            <button type="button" onClick={() => setChanging(true)}>Trocar chave</button>
          </div>
        ) : (
          <ChavePix initialType={data.pixType} cpf={me.profile?.cpf} onDone={async () => { setChanging(false); await Promise.all([load(), reload()]); }} />
        )}
      </section>

      {!!data.abatimentos.length && <Abatimentos items={data.abatimentos} onChange={load} />}

      <section className="card tight" aria-label="Recebidos">
        <div className="card-header"><h2>Recebidos</h2></div>
        {data.pagamentos.length === 0 ? <EmptyState icon="wallet" title="Nenhum pagamento ainda" text="Quando a UP Service pagar, o valor e o comprovante aparecem aqui (e chegam no seu WhatsApp)." /> : (
          <ul className="wallet-items">
            {data.pagamentos.map((p) => (
              <li key={p.id}>
                <span className="wallet-kind paid"><Icon name="check" size={16} /></span>
                <span className="wallet-what"><b>{fmtMoney(p.amount)}</b><small>Pago em {fmtDateTime(p.paidAt)}{p.note ? ` · ${p.note}` : ''}</small></span>
                {p.receipt ? <a className="btn sm" href={`/api/files/comprovante/${p.id}`} target="_blank" rel="noreferrer"><Icon name="file" size={16} />Ver comprovante</a> : <span className="muted">Sem comprovante</span>}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
