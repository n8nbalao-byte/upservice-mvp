import { useEffect, useState } from 'react';
import { api, fmtDateTime } from '../lib/api';
import { Icon } from './icons';
import { Alert, Loading, StatusBadge, useAction, useDialog } from './ui';

type Unidade = { id: string; code: string; name: string; group: string | null; groupName: string | null; pendentes: number; ultimaPostagem: string | null };
type Grupo = { id: string; subject: string; size: number | null; announce: boolean };

/** Configurações → WhatsApp → Postador de vagas: liga/desliga, escolhe o grupo de cada loja (com sugestão pelo nome)
 *  e posta na hora as vagas abertas de uma loja. As vagas novas vão sozinhas, num resumo por grupo. */
export function PostadorConfig() {
  const { busy, run } = useAction();
  const { toast } = useDialog();
  const [data, setData] = useState<{ enabled: boolean; numero: string | null; units: Unidade[] }>();
  const [grupos, setGrupos] = useState<Grupo[] | null>(null);
  const [sugestoes, setSugestoes] = useState<Record<string, string>>({});
  const load = () => api<{ enabled: boolean; numero: string | null; units: Unidade[] }>('/admin/postador').then(setData, () => {});
  useEffect(() => { load(); }, []);
  if (!data) return <div className="card"><Loading /></div>;

  const carregar = () => run('grupos', async () => {
    const r = await api<{ groups: Grupo[]; sugestoes: Record<string, string> }>('/admin/postador/grupos');
    setGrupos(r.groups);
    setSugestoes(r.sugestoes);
  });
  const nome = (id: string) => grupos?.find((g) => g.id === id)?.subject ?? '';
  const ligar = (u: Unidade, group: string | null) => api(`/admin/postador/unidades/${u.id}`, { method: 'PUT', body: { group, groupName: group ? nome(group) : null } });
  const semGrupoComSugestao = data.units.filter((u) => !u.group && sugestoes[u.id]);
  const aplicar = () => run('aplicar', async () => {
    for (const u of semGrupoComSugestao) await ligar(u, sugestoes[u.id]);
    await load();
  }, `${semGrupoComSugestao.length} loja(s) ligada(s) ao grupo sugerido.`);
  const postar = (u: Unidade) => run(`p-${u.id}`, async () => {
    const r = await api<{ postadas: number }>(`/admin/postador/unidades/${u.id}/postar`, { body: {} });
    toast(r.postadas ? `${r.postadas} vaga(s) postada(s) no grupo ${u.groupName ?? ''}.` : 'Nenhuma vaga aberta com posição livre nesta loja.');
    await load();
  });
  const comGrupo = data.units.filter((u) => u.group).length;

  return (
    <div className="card tight">
      <div className="card-header">
        <h2>Postador de vagas nos grupos</h2>
        <StatusBadge tone={data.enabled ? 'success' : 'neutral'}>{data.enabled ? 'Ligado' : 'Desligado'}</StatusBadge>
      </div>
      <div className="stack" style={{ padding: '16px 20px' }}>
        <p className="muted">
          Cada loja tem o seu grupo de WhatsApp. Quando abrem vagas numa loja, o sistema espera 3 minutos e manda <b>um resumo</b> no grupo dela: dia, horário, função, valor e quantas vagas, com o link do app e do WhatsApp da UP Service.
          O número conectado{data.numero ? `, ${data.numero.replace(/^(\d{2})(\d{4,5})(\d{4})$/, '($1) $2-$3')},` : ''} precisa estar em cada grupo. Ao trocar de número, coloque o novo nos mesmos grupos: a ligação de cada loja continua valendo.
        </p>
        {!data.enabled && comGrupo === 0 && <Alert kind="info">Primeiro ligue cada loja ao grupo dela (botão abaixo). Depois, ligue a postagem automática.</Alert>}
        <div className="row wrap">
          <button className={data.enabled ? 'danger' : 'primary'} disabled={busy === 'liga'} onClick={() => run('liga', async () => { await api('/admin/postador', { method: 'PUT', body: { enabled: !data.enabled } }); await load(); }, data.enabled ? 'Postagem automática desligada.' : 'Postagem automática ligada. As vagas que já estavam abertas não são despejadas nos grupos; use "Postar agora" se quiser.')}>
            {data.enabled ? 'Desligar a postagem automática' : 'Ligar a postagem automática'}
          </button>
          <button disabled={busy === 'grupos'} onClick={carregar}>{busy === 'grupos' ? 'Carregando os grupos (uns 20 s)…' : grupos ? 'Recarregar os grupos' : 'Carregar os grupos do WhatsApp'}</button>
          {semGrupoComSugestao.length > 0 && <button className="primary" disabled={busy === 'aplicar'} onClick={aplicar}>Ligar {semGrupoComSugestao.length} loja(s) ao grupo sugerido</button>}
        </div>
        <p className="muted">{comGrupo} de {data.units.length} lojas com grupo.{grupos ? ` ${grupos.length} grupos no WhatsApp.` : ''}</p>
      </div>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Loja</th><th>Grupo do WhatsApp</th><th>Última postagem</th><th /></tr></thead>
          <tbody>
            {data.units.map((u) => {
              const sug = !u.group && sugestoes[u.id];
              return (
                <tr key={u.id}>
                  <td><b>{u.code}</b> · {u.name}</td>
                  <td>
                    {grupos ? (
                      <select aria-label={`Grupo de ${u.name}`} value={u.group ?? ''} disabled={busy === u.id} onChange={(e) => run(u.id, async () => { await ligar(u, e.target.value || null); await load(); }, 'Grupo salvo.')}>
                        <option value="">— sem grupo —</option>
                        {u.group && !grupos.some((g) => g.id === u.group) && <option value={u.group}>{u.groupName ?? u.group} (o número não está nele)</option>}
                        {grupos.map((g) => <option key={g.id} value={g.id}>{g.subject}{g.announce ? ' · só admins postam' : ''}</option>)}
                      </select>
                    ) : u.groupName ?? <span className="muted">sem grupo</span>}
                    {sug && <div className="muted">Sugestão: {nome(sug)}</div>}
                  </td>
                  <td className="muted">{u.ultimaPostagem ? fmtDateTime(u.ultimaPostagem) : '—'}{u.pendentes ? ` · ${u.pendentes} vaga(s) na fila` : ''}</td>
                  <td>{u.group && <button className="sm" disabled={busy === `p-${u.id}`} onClick={() => postar(u)}><Icon name="arrowUpRight" size={16} />{busy === `p-${u.id}` ? 'Postando…' : 'Postar agora'}</button>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
