import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Icon } from '../components/icons';
import { EstrelasMapa, type StarsData } from '../components/Estrelas';
import { Alert, EmptyState, Loading, PageHeader, Stat } from '../components/ui';
import { api, fmtDateTime, fmtMoney } from '../lib/api';

/** Profissional: a tela "como um joguinho", em tela cheia (só com "Estrelas" ligado em Configurações). */
export default function Estrelas() {
  const [data, setData] = useState<StarsData>();
  const [error, setError] = useState('');
  useEffect(() => { api<StarsData>('/me/estrelas').then(setData, (e) => setError(e.message)); }, []);
  return (
    <div className="game-full">
      <header className="game-full-bar">
        <Link to="/minhas" className="g-pill sm" aria-label="Voltar para Minhas diárias"><Icon name="chevronLeft" size={18} />Voltar</Link>
        <h1>Minhas estrelas</h1>
      </header>
      <div className="game-full-body">
        {error ? <Alert kind="info">{error}</Alert> : !data ? <Loading /> : <EstrelasMapa data={data} />}
      </div>
    </div>
  );
}

const STATE: Record<string, string> = { feita: 'Concluída', hoje: 'Hoje', proxima: 'Agendada', em_analise: 'Em análise' };
const monthName = (m: string) => {
  const t = new Date(`${m}-15T12:00:00Z`).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric', timeZone: 'America/Sao_Paulo' });
  return t[0].toUpperCase() + t.slice(1);
};
const starsText = (n: number | null) => (n == null ? '—' : n === 0 ? '0 (falta)' : '★'.repeat(n) + '☆'.repeat(3 - n));

/** Gestão: os mesmos dados em painel comum (tabela), sem a tela de jogo. */
export function GestaoEstrelas() {
  const { id } = useParams();
  const [data, setData] = useState<StarsData & { name: string }>();
  const [error, setError] = useState('');
  useEffect(() => { api<StarsData & { name: string }>(`/manage/workers/${id}/estrelas`).then(setData, (e) => setError(e.message)); }, [id]);
  if (error) return <div className="page"><Alert kind="danger">{error}</Alert></div>;
  if (!data) return <div className="page"><Loading /></div>;
  const months = data.months.filter((m) => m.diaries.length).reverse();
  return (
    <div className="page" style={{ maxWidth: 1100 }}>
      <PageHeader back={{ to: `/gestao/profissionais/${id}`, label: 'Ficha do profissional' }} title={`Estrelas de ${data.name}`} description="Desempenho por diária (prévia: regras e valores dos bônus ainda em definição; não gera pagamento)." />
      <div className="stats">
        <Stat label="Estrelas no total" value={data.total} tone="accent" />
        <Stat label="Nível" value={data.level} hint={`${data.perLevel - data.inLevel} estrelas para o próximo`} />
      </div>
      {months.length === 0 ? <div className="card"><EmptyState title="Nenhuma diária ainda" /></div> : months.map((m) => (
        <section key={m.month} className="card tight">
          <div className="card-header">
            <h2>{monthName(m.month)}</h2>
            <span className="sub">{m.stars} de {m.maxStars} estrelas · bônus: {m.bonuses.filter((b) => b.unlocked).map((b) => fmtMoney(b.value)).join(', ') || 'nenhum'}{m.perfect.unlocked ? ` · mês perfeito ${fmtMoney(m.perfect.value)}` : ''}</span>
          </div>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Data</th><th>Vaga</th><th>Loja</th><th>Situação</th><th>Estrelas</th></tr></thead>
              <tbody>
                {m.diaries.map((d) => (
                  <tr key={d.id}>
                    <td className="tabular">{fmtDateTime(d.startsAt)}</td>
                    <td>{d.title}</td>
                    <td>{d.unit}</td>
                    <td>{d.stars === 0 ? 'Não compareceu' : STATE[d.state]}</td>
                    <td className="tabular" aria-label={d.stars == null ? 'sem estrelas ainda' : `${d.stars} estrelas`}>{starsText(d.stars)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}
    </div>
  );
}
