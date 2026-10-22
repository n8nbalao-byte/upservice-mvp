import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Icon } from '../components/icons';
import { Alert, EmptyState, Loading, PageHeader, StatusBadge, type Tone } from '../components/ui';
import { api, fmtDate } from '../lib/api';

type Situacao = 'EM_ANALISE' | 'REPROVADO' | 'FALTA';
type Doc = 'APROVADO' | 'PENDENTE' | 'REJEITADO' | 'FALTA';
type Item = { id: string; name: string; email: string; status: string; createdAt: string; perfil: boolean; docs: Record<string, Doc>; situacao: Situacao };

const SITUACAO: Record<Situacao, [string, Tone, string]> = {
  EM_ANALISE: ['Em análise', 'info', 'Enviou e espera aprovação'],
  REPROVADO: ['Reprovado', 'danger', 'Tem documento reprovado'],
  FALTA: ['Falta enviar', 'warning', 'Ainda não enviou'],
};
const DOC_NOME: Record<string, string> = { CPF: 'CPF', RG: 'RG', COMPROVANTE: 'Comprovante', SELFIE: 'Selfie' };
const DOC_ESTADO: Record<Doc, [string, Tone]> = { APROVADO: ['✓', 'success'], PENDENTE: ['em análise', 'info'], REJEITADO: ['reprovado', 'danger'], FALTA: ['falta', 'neutral'] };
const ABAS: (Situacao | '')[] = ['', 'EM_ANALISE', 'REPROVADO', 'FALTA'];

/** Profissionais que ainda não estão com os 4 documentos aprovados (não podem pegar vagas): quem enviou e espera
 *  análise vem primeiro, depois quem teve documento reprovado e quem não enviou. Cada documento com a sua situação. */
export default function CadastrosPendentes() {
  const [items, setItems] = useState<Item[]>();
  const [error, setError] = useState('');
  const [aba, setAba] = useState<Situacao | ''>('');
  const [busca, setBusca] = useState('');
  useEffect(() => { api<{ items: Item[] }>('/manage/cadastros-pendentes').then((r) => setItems(r.items), (e) => setError(e.message)); }, []);
  const shown = useMemo(() => {
    const t = busca.trim().toLowerCase();
    return (items ?? []).filter((i) => (!aba || i.situacao === aba) && (!t || `${i.name} ${i.email}`.toLowerCase().includes(t)));
  }, [items, aba, busca]);
  const conta = (s: Situacao | '') => (items ?? []).filter((i) => !s || i.situacao === s).length;

  return (
    <div className="page" style={{ maxWidth: 1200 }}>
      <PageHeader
        title="Cadastros pendentes"
        description="Profissionais que ainda não podem pegar vagas porque falta algum documento aprovado (CPF, RG, comprovante de residência e selfie)."
        back={{ to: '/gestao/inicio', label: 'Dashboard' }}
      />
      {error && <Alert kind="danger">{error}</Alert>}
      <div className="filters">
        <label style={{ maxWidth: 420 }}>Buscar<input placeholder="Nome ou e-mail" value={busca} onChange={(e) => setBusca(e.target.value)} /></label>
      </div>
      <div className="card tight">
        <div className="tabs" role="tablist">
          {ABAS.map((s) => (
            <button key={s || 'todos'} role="tab" aria-selected={aba === s} className={`tab${aba === s ? ' active' : ''}`} onClick={() => setAba(s)}>
              {s ? SITUACAO[s][0] : 'Todos'}<span className="count">{conta(s)}</span>
            </button>
          ))}
        </div>
        {!items ? <Loading /> : shown.length === 0 ? (
          <EmptyState icon="check" title={items.length ? 'Ninguém nesta situação' : 'Todos os cadastros estão completos'} text={items.length ? '' : 'Todos os profissionais têm os 4 documentos aprovados.'} />
        ) : (
          <div className="table-wrap">
            <table className="responsive">
              <thead><tr><th>Profissional</th><th>Situação</th><th>Documentos</th><th>Cadastro</th><th>Ações</th></tr></thead>
              <tbody>
                {shown.map((i) => {
                  const [nome, tom, dica] = SITUACAO[i.situacao];
                  return (
                    <tr key={i.id}>
                      <td data-label="Profissional"><b>{i.name}</b><div className="muted">{i.email}</div></td>
                      <td data-label="Situação"><StatusBadge tone={tom}>{nome}</StatusBadge><div className="muted">{dica}{i.perfil ? '' : ' · sem dados pessoais'}</div></td>
                      <td data-label="Documentos">
                        <div className="doc-chips">
                          {Object.entries(i.docs).map(([t, st]) => <span key={t} className={`badge plain tone-${DOC_ESTADO[st][1]}`}>{DOC_NOME[t] ?? t}: {DOC_ESTADO[st][0]}</span>)}
                        </div>
                      </td>
                      <td data-label="Cadastro" className="nowrap">{fmtDate(i.createdAt)}</td>
                      <td data-label="Ações" className="nowrap">
                        {i.situacao === 'EM_ANALISE' && <Link className="btn sm primary" to="/gestao/documentos">Analisar</Link>}{' '}
                        <Link className="btn sm" to={`/gestao/profissionais/${i.id}`}><Icon name="user" size={16} />Ficha</Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {items && items.length > 0 && <div className="card-footer"><span className="muted">Mostrando {shown.length} de {items.length}</span></div>}
      </div>
    </div>
  );
}
