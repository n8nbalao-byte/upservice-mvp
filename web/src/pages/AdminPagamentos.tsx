import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Icon } from '../components/icons';
import { PagamentoPix } from '../components/PagamentoPix';
import { Alert, EmptyState, Loading, PageHeader, Stat, StatusBadge } from '../components/ui';
import { CHANGED, api, fmtDate, fmtMoney } from '../lib/api';

type Pendente = {
  id: string; name: string; status: string; pixType: string | null; pixKey: string | null;
  aReceber: number; diarias: number; bonus: number; quebras: number; pago: number; diariasConcluidas: number; desde: string | null; ultimoPagamento: string | null;
};
type Lista = { count: number; total: number; items: Pendente[] };

/** Pagamentos (administrador): à esquerda, todos com pagamento pendente; à direita, o pagamento do selecionado
 *  (QR Code do Pix, comprovante e "Marquei como pago"), sem precisar abrir a ficha de cada um. */
export default function AdminPagamentos() {
  const [data, setData] = useState<Lista>();
  const [error, setError] = useState('');
  const [sel, setSel] = useState<string | null>(null);
  const [busca, setBusca] = useState('');
  const load = () => api<Lista>('/admin/pagamentos').then((d) => { setData(d); setError(''); }, (e) => setError(e.message));
  useEffect(() => { load(); }, []);
  const lista = useMemo(() => {
    const t = busca.trim().toLowerCase();
    return (data?.items ?? []).filter((x) => !t || x.name.toLowerCase().includes(t));
  }, [data, busca]);
  const atual = data?.items.find((x) => x.id === sel) ?? null;
  // Depois de pagar: atualiza a lista e o número no menu; quem quitou sai da lista.
  const pago = () => { load(); window.dispatchEvent(new Event(CHANGED)); };

  return (
    <div className="page pagamentos" style={{ maxWidth: 1200 }}>
      <PageHeader title="Pagamentos" description="Profissionais com valor a receber. Escolha um para pagar pelo Pix, anexar o comprovante e marcar como pago." />
      {error && <Alert kind="danger">{error}</Alert>}
      {!data ? <Loading /> : (
        <>
          <div className="stats">
            <Stat label="Pagamentos pendentes" value={data.count} tone={data.count ? 'warning' : 'success'} />
            <Stat label="Total a pagar" value={fmtMoney(data.total)} tone="accent" />
          </div>
          {data.count === 0 ? <div className="card"><EmptyState icon="wallet" title="Nenhum pagamento pendente" text="Quando alguém tiver valor a receber, aparece aqui." /></div> : (
            <div className={`pag-grid${atual ? ' com-sel' : ''}`}>
              <section className="card tight pag-lista" aria-label="Pagamentos pendentes">
                <div className="card-header"><h2>Pendentes</h2><span className="sub">{data.count}</span></div>
                <label className="pag-busca"><Icon name="search" size={16} /><input type="search" placeholder="Buscar profissional" value={busca} onChange={(e) => setBusca(e.target.value)} aria-label="Buscar profissional" /></label>
                <ul>
                  {lista.map((x) => (
                    <li key={x.id}>
                      <button type="button" className={`pag-item${sel === x.id ? ' on' : ''}`} onClick={() => setSel(x.id)} aria-current={sel === x.id}>
                        <span className="pag-nome"><b>{x.name}</b><small>{x.pixKey ? `Pix: ${x.pixKey}` : 'Sem chave Pix'}{x.quebras ? ` · quebra ${fmtMoney(x.quebras)}` : ''}</small></span>
                        <span className="pag-valor tabular">{fmtMoney(x.aReceber)}</span>
                      </button>
                    </li>
                  ))}
                  {lista.length === 0 && <li className="muted pag-vazio">Ninguém com esse nome.</li>}
                </ul>
              </section>
              <section className="pag-detalhe" aria-label="Pagamento selecionado">
                {!atual ? (
                  <div className="card"><EmptyState icon="wallet" title="Escolha um profissional" text="O pagamento abre aqui, sem sair desta tela." /></div>
                ) : (
                  <>
                    <div className="card pag-cabeca">
                      <button type="button" className="ghost sm pag-voltar" onClick={() => setSel(null)}><Icon name="chevronLeft" size={16} />Lista</button>
                      <div>
                        <h2>{atual.name}</h2>
                        <p className="muted">{atual.diariasConcluidas} diária(s) concluída(s){atual.desde ? ` desde ${fmtDate(atual.desde)}` : ''}{atual.ultimoPagamento ? ` · último pagamento em ${fmtDate(atual.ultimoPagamento)}` : ' · nunca recebeu'}</p>
                      </div>
                      {!atual.pixKey && <StatusBadge tone="warning">Sem chave Pix</StatusBadge>}
                      <Link className="btn sm" to={`/gestao/profissionais/${atual.id}`}>Abrir ficha</Link>
                    </div>
                    <PagamentoPix key={atual.id} workerId={atual.id} onPaid={pago} />
                  </>
                )}
              </section>
            </div>
          )}
        </>
      )}
    </div>
  );
}
