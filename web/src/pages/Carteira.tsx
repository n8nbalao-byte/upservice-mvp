import { useEffect, useState } from 'react';
import { useMe } from '../App';
import { ChavePix } from '../components/ChavePix';
import { Icon } from '../components/icons';
import { Alert, EmptyState, Loading, PageHeader } from '../components/ui';
import { api, fmtDate, fmtDateTime, fmtMoney } from '../lib/api';

type Item = { kind: 'DIARIA' | 'BONUS'; id: string; date: string; text: string; value: number };
type Pagamento = { id: string; amount: number; paidAt: string; receipt: boolean; receiptMime: string | null; note: string | null };
export type Wallet = { aReceber: number; diarias: number; bonus: number; pago: number; itens: Item[]; pagamentos: Pagamento[] };
const PIX_NAME: Record<string, string> = { CPF: 'CPF', EMAIL: 'E-mail', TELEFONE: 'Celular', ALEATORIA: 'Chave aleatória' };

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
