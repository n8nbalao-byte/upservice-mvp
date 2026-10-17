import qrcode from 'qrcode-generator';
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { api, fmtDateTime, fmtMoney } from '../lib/api';
import type { Wallet } from '../pages/Carteira';
import { Icon } from './icons';
import { Alert, EmptyState, Loading, useAction } from './ui';

type Data = Wallet & { name: string; pixType: string | null; pixKey: string | null; pixChangedAt: string | null; payload: string | null };
const PIX_NAME: Record<string, string> = { CPF: 'CPF', EMAIL: 'E-mail', TELEFONE: 'Celular', ALEATORIA: 'Chave aleatória' };
const MAX = 5 * 1024 * 1024;
const readFile = (f: File) => new Promise<string>((ok, ko) => { const r = new FileReader(); r.onload = () => ok(String(r.result)); r.onerror = () => ko(new Error('Não foi possível ler o arquivo.')); r.readAsDataURL(f); });

/** Gestão: saldo do profissional, chave Pix e pagamento. Clicar na chave abre o QR Code do Pix com o valor em aberto;
 *  depois de pagar no app do banco, o gestor anexa o comprovante e marca como pago (o comprovante vai pelo WhatsApp). */
export function PagamentoPix({ workerId, onPaid }: { workerId: string; onPaid?: () => void }) {
  const { busy, run } = useAction();
  const [data, setData] = useState<Data>();
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const dlg = useRef<HTMLDialogElement>(null);
  const load = () => api<Data>(`/manage/workers/${workerId}/pagamento`).then(setData, (e) => setError(e.message));
  useEffect(() => { load(); }, [workerId]);
  const svg = useMemo(() => {
    if (!data?.payload) return '';
    const g = qrcode(0, 'M');
    g.addData(data.payload);
    g.make();
    return g.createSvgTag({ cellSize: 5, margin: 2, scalable: true });
  }, [data?.payload]);

  async function pay(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const file = f.get('receipt') as File | null;
    const amount = Number(String(f.get('amount') ?? '').replace(',', '.'));
    const ok = await run('pay', async () => {
      if (!file?.size) throw new Error('Anexe o comprovante do banco.');
      if (file.size > MAX) throw new Error('Comprovante maior que 5 MB.');
      await api(`/manage/workers/${workerId}/pagamentos`, { body: { amount, receipt: await readFile(file), note: f.get('note') } });
    }, 'Pagamento registrado. O comprovante foi enviado ao profissional.');
    if (ok) { dlg.current?.close(); load(); onPaid?.(); }
  }

  if (error) return <div className="card"><Alert kind="danger">{error}</Alert></div>;
  if (!data) return <div className="card"><Loading /></div>;
  // Troca de chave nos últimos 7 dias: alerta no pagamento.
  const recentChange = !!data.pixChangedAt && Date.now() - new Date(data.pixChangedAt).getTime() < 7 * 86400e3;
  return (
    <section className="card stack" aria-label="Pagamento">
      <div className="card-header" style={{ marginBottom: 0 }}><h2>Pagamento</h2><span className="sub">A receber: <strong>{fmtMoney(data.aReceber)}</strong></span></div>
      <dl className="wallet-parts">
        <div><dt>Diárias concluídas</dt><dd>{fmtMoney(data.diarias)}</dd></div>
        <div><dt>Bônus ganhos</dt><dd>{fmtMoney(data.bonus)}</dd></div>
        {!!data.abatimentos?.length && <div><dt>Quebra de caixa</dt><dd>− {fmtMoney(data.quebras)}</dd></div>}
        <div><dt>Já pago</dt><dd>− {fmtMoney(data.pago)}</dd></div>
      </dl>
      {data.pixKey ? (
        <div className="row wrap between">
          <span><span className="muted">Chave Pix ({PIX_NAME[data.pixType ?? ''] ?? 'chave'}):</span> <strong className="tabular">{data.pixKey}</strong></span>
          <button type="button" className="primary" disabled={data.aReceber <= 0} onClick={() => { setCopied(false); dlg.current?.showModal(); }}><Icon name="wallet" size={18} />Pagar com Pix</button>
        </div>
      ) : <Alert kind="warning">O profissional ainda não cadastrou a chave Pix. O app pede a chave no próximo acesso dele.</Alert>}

      <h3 className="section-title" style={{ margin: '8px 0 0' }}>Pagamentos feitos</h3>
      {data.pagamentos.length === 0 ? <EmptyState icon="wallet" title="Nenhum pagamento registrado" /> : (
        <ul className="wallet-items">
          {data.pagamentos.map((p) => (
            <li key={p.id}>
              <span className="wallet-kind paid"><Icon name="check" size={16} /></span>
              <span className="wallet-what"><b>{fmtMoney(p.amount)}</b><small>{fmtDateTime(p.paidAt)}{p.note ? ` · ${p.note}` : ''}</small></span>
              {p.receipt && <a className="btn sm" href={`/api/files/comprovante/${p.id}`} target="_blank" rel="noreferrer"><Icon name="file" size={16} />Comprovante</a>}
            </li>
          ))}
        </ul>
      )}

      <dialog ref={dlg} className="dialog pix-dialog" aria-label={`Pagar ${data.name} com Pix`}>
        <form className="stack" onSubmit={pay}>
          <h2>Pagar {data.name.split(' ')[0]} com Pix</h2>
          {recentChange && <Alert kind="warning">A chave Pix foi trocada em {fmtDateTime(data.pixChangedAt!)}. Confirme com o profissional (por telefone ou pessoalmente) antes de pagar.</Alert>}
          {data.payload ? (
            <>
              <p className="muted">1. No app do banco, escolha <b>Pix → Ler QR Code</b> (ou "Pix copia e cola") e confira o nome e o valor.</p>
              <div className="pix-qr" role="img" aria-label={`QR Code do Pix de ${fmtMoney(data.aReceber)}`} dangerouslySetInnerHTML={{ __html: svg }} />
              <div className="pix-copy">
                <input value={data.payload} readOnly aria-label="Pix copia e cola" onFocus={(e) => e.currentTarget.select()} />
                <button type="button" className="sm" onClick={() => navigator.clipboard?.writeText(data.payload!).then(() => setCopied(true))}>{copied ? 'Copiado' : 'Copiar'}</button>
              </div>
            </>
          ) : <Alert kind="info">Nada em aberto para pagar.</Alert>}
          <p className="muted">2. Depois de pagar, anexe o comprovante do banco. Ele vai pelo WhatsApp para o profissional e fica na Carteira dele.</p>
          <label>Valor pago (R$)<input name="amount" inputMode="decimal" defaultValue={data.aReceber.toFixed(2).replace('.', ',')} required /></label>
          <label>Comprovante (foto ou PDF)<input name="receipt" type="file" accept="image/jpeg,image/png,application/pdf" required /></label>
          <label>Observação <span className="hint">(opcional)</span><input name="note" maxLength={300} placeholder="Ex.: semana de 12 a 18/10" /></label>
          <div className="dialog-actions">
            <button type="button" onClick={() => dlg.current?.close()}>Cancelar</button>
            <button type="submit" className="primary" disabled={busy === 'pay'}>{busy === 'pay' ? 'Registrando…' : 'Marquei como pago'}</button>
          </div>
        </form>
      </dialog>
    </section>
  );
}
