import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Icon } from '../components/icons';
import { Alert, EmptyState, Loading, PageHeader, StatusBadge, useAction, useDialog, type Tone } from '../components/ui';
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
  const { busy, run } = useAction();
  const { confirm, toast } = useDialog();
  const [envio, setEnvio] = useState<{ feitos: number; total: number }>();
  // Lembrete (aviso no app + e-mail) para quem tem algo a fazer; quem só espera a análise não recebe.
  // Para todos: pede a lista e manda de 5 em 5, para a barra mostrar quanto já foi (cada e-mail demora).
  const lembrar = async (userId?: string) => {
    if (!userId && !(await confirm({ title: 'Enviar lembrete a todos?', message: 'Recebem (no app e por e-mail) só os que têm algo a fazer: enviar ou reenviar documento, preencher os dados ou aceitar os termos. Quem recebeu lembrete hoje fica de fora.', confirmText: 'Enviar lembretes' }))) return;
    const url = '/manage/cadastros-pendentes/lembrete';
    type R = { enviados: number; emails: number };
    await run(userId ?? 'todos', async () => {
      const soma: R = { enviados: 0, emails: 0 };
      const somar = (r: R) => { soma.enviados += r.enviados; soma.emails += r.emails; };
      if (userId) somar(await api<R>(url, { body: { userId } }));
      else {
        const { ids } = await api<{ ids: string[] }>(url, { body: { listar: true } });
        try {
          for (let i = 0; i < ids.length; i += 5) {
            if (!i) setEnvio({ feitos: 0, total: ids.length });
            somar(await api<R>(url, { body: { userIds: ids.slice(i, i + 5) } }));
            setEnvio({ feitos: Math.min(i + 5, ids.length), total: ids.length });
          }
        } finally { setEnvio(undefined); }
      }
      const { enviados, emails } = soma;
      if (!enviados) toast('Ninguém para lembrar agora.');
      else if (emails === enviados) toast(`${enviados} lembrete(s) enviado(s) no app e por e-mail.`);
      else toast(`${enviados} lembrete(s) no app. E-mail: ${emails} enviado(s), ${enviados - emails} falharam (confira a senha do e-mail no painel da hospedagem).`, 'error');
    });
  };
  const pct = envio ? Math.round((envio.feitos / envio.total) * 100) : 0;
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
        actions={envio ? (
          <div className="progress envio" role="progressbar" aria-label="Envio dos lembretes" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
            <div className="bar"><span style={{ width: `${pct}%` }} /></div>
            <small>Enviando lembretes: {envio.feitos} de {envio.total} ({pct}%)</small>
          </div>
        ) : <button type="button" className="primary" disabled={busy === 'todos'} onClick={() => lembrar()}>{busy === 'todos' ? 'Preparando…' : 'Enviar lembrete a todos'}</button>}
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
                        {i.situacao !== 'EM_ANALISE' && <button type="button" className="sm" disabled={busy === i.id} onClick={() => lembrar(i.id)}>Lembrar</button>}{' '}
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
