import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { monthName } from '../components/Estrelas';
import { Alert, EmptyState, Loading, PageHeader, StatusBadge, useAction } from '../components/ui';
import { api, fmtMoney } from '../lib/api';

type BonusDay = { day: string; kind: 'BONUS' | 'SORTEIO'; value: number | null; label: string | null };
type Data = {
  month: string; total: number | null; started: boolean; today: string; days: BonusDay[];
  winners: { userId: string; name: string; day: string; value: number }[];
  sorteio: { day: string; label: string | null; need: number; people: { userId: string; name: string; threeStarDays: number; dayDone: boolean; qualifies: boolean }[] } | null;
};
const dm = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;

/** Bônus do mês (gestor e administrador): define o valor total; o sistema sorteia os dias e divide o valor (crescente).
 *  Um calendário só para todos os profissionais. Depois que o primeiro dia de bônus chega, o valor não muda mais. */
export default function GestaoBonus() {
  const [month, setMonth] = useState(() => new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' }).slice(0, 7));
  const [data, setData] = useState<Data>();
  const [error, setError] = useState('');
  const { busy, run } = useAction();
  const load = () => api<Data>(`/manage/bonus?month=${month}`).then((d) => { setData(d); setError(''); }, (e) => setError(e.message));
  useEffect(() => { setData(undefined); load(); }, [month]);

  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const total = Number(String(new FormData(e.currentTarget).get('total')).replace(',', '.'));
    if (await run('save', () => api(`/manage/bonus/${month}`, { method: 'PUT', body: { total } }), total ? 'Bônus definido e dias sorteados.' : 'Bônus do mês retirado.')) load();
  }

  const bonus = data?.days.filter((d) => d.kind === 'BONUS') ?? [];
  return (
    <div className="page" style={{ maxWidth: 900 }}>
      <PageHeader title="Bônus do mês" description="Defina quanto o mês vai distribuir. O sistema sorteia os dias e divide o valor: os primeiros bônus menores, os últimos maiores. Ganha quem fizer 3 estrelas no dia; o valor entra no A receber do profissional." />
      <div className="card stack">
        <div className="row wrap" style={{ gap: 16, alignItems: 'end' }}>
          <label>Mês<input type="month" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} /></label>
          {data && (
            <form className="row wrap" style={{ gap: 12, alignItems: 'end' }} onSubmit={save} key={`${month}-${data.total}`}>
              <label>Valor total do mês (R$)<input name="total" inputMode="decimal" defaultValue={data.total ?? ''} placeholder="Ex.: 100" required disabled={data.started} /></label>
              <button className="primary" disabled={data.started || busy === 'save'}>{data.total ? 'Salvar e sortear de novo' : 'Definir e sortear os dias'}</button>
            </form>
          )}
        </div>
        {data?.started && <Alert kind="info">O bônus de {monthName(month)} já começou (ou o mês terminou): o valor não muda mais.</Alert>}
        <p className="muted">Os profissionais veem só o presente no dia; o valor aparece quando o dia chega. O calendário vale para todos.</p>
      </div>

      {error ? <Alert kind="danger">{error}</Alert> : !data ? <Loading /> : (
        <>
          <section className="card tight">
            <div className="card-header"><h2>Dias sorteados · {monthName(month)}</h2>{data.total != null && <span className="sub">Total {fmtMoney(data.total)}</span>}</div>
            {data.days.length === 0 ? <EmptyState title="Sem bônus neste mês" text="Defina o valor total para sortear os dias." icon="gift" /> : (
              <div className="table-wrap">
                <table>
                  <thead><tr><th>Dia</th><th>Tipo</th><th>Valor</th><th>Situação</th></tr></thead>
                  <tbody>
                    {data.days.map((d) => (
                      <tr key={d.day}>
                        <td className="tabular">{dm(d.day)}</td>
                        <td>{d.kind === 'SORTEIO' ? (d.label ?? 'Sorteio') : 'Bônus'}</td>
                        <td className="tabular">{d.value != null ? fmtMoney(d.value) : '—'}</td>
                        <td>{d.day <= data.today ? <StatusBadge status="ATIVA">Revelado</StatusBadge> : <StatusBadge tone="info">Surpresa</StatusBadge>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {bonus.length > 0 && <p className="muted" style={{ padding: '0 16px 12px' }}>{bonus.length} dia(s) de bônus, somando {fmtMoney(bonus.reduce((t, d) => t + (d.value ?? 0), 0))}.</p>}
          </section>

          <section className="card tight">
            <div className="card-header"><h2>Quem ganhou</h2></div>
            {data.winners.length === 0 ? <EmptyState title="Ninguém ganhou ainda" text="Aparece aqui quem fez 3 estrelas num dia de bônus que já chegou." /> : (
              <div className="table-wrap">
                <table>
                  <thead><tr><th>Profissional</th><th>Dia</th><th>Bônus</th></tr></thead>
                  <tbody>{data.winners.map((w) => <tr key={w.userId + w.day}><td><Link className="link" to={`/gestao/profissionais/${w.userId}`}>{w.name}</Link></td><td className="tabular">{dm(w.day)}</td><td className="tabular">{fmtMoney(w.value)}</td></tr>)}</tbody>
                </table>
              </div>
            )}
          </section>

          {data.sorteio && (
            <section className="card tight">
              <div className="card-header"><h2>{data.sorteio.label ?? 'Sorteio'} · {dm(data.sorteio.day)}</h2><span className="sub">Concorre quem tiver {data.sorteio.need} dias com 3 estrelas no ano e 3 estrelas no dia do sorteio</span></div>
              {data.sorteio.people.length === 0 ? <EmptyState title="Ninguém com 3 estrelas ainda" /> : (
                <div className="table-wrap">
                  <table>
                    <thead><tr><th>Profissional</th><th>Dias com 3 estrelas</th><th>Dia do sorteio</th><th>Situação</th></tr></thead>
                    <tbody>
                      {data.sorteio.people.map((p) => (
                        <tr key={p.userId}>
                          <td><Link className="link" to={`/gestao/profissionais/${p.userId}`}>{p.name}</Link></td>
                          <td className="tabular">{p.threeStarDays} de {data.sorteio!.need}</td>
                          <td>{p.dayDone ? '3 estrelas' : '—'}</td>
                          <td>{p.qualifies ? <StatusBadge status="ATIVA">Qualificado</StatusBadge> : <StatusBadge tone="info">Ainda não</StatusBadge>}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          )}
        </>
      )}
    </div>
  );
}
