import { useEffect, useState, type FormEvent } from 'react';
import { api } from '../lib/api';
import { Alert, Loading, StatusBadge, useAction, type Tone } from './ui';

type Modelo = { nome: string; label: string; status: string | null; motivo: string | null };
type Aviso = { key: string; label: string; on: boolean };
type Status = {
  configured: boolean; source?: 'env' | 'db'; phoneId: string; wabaId: string; hasToken: boolean; hasSecret: boolean;
  webhookUrl: string; verifyToken: string | null; avisos: Aviso[];
  state?: string; message?: string; number?: string | null; name?: string | null; quality?: string | null; tier?: string | null; modelos?: Modelo[];
};
const STATE: Record<string, [string, Tone]> = {
  CONECTADO: ['No ar', 'success'],
  PENDENTE: ['Aguardando a Meta', 'warning'],
  DESCONECTADO: ['Fora do ar', 'danger'],
  ERRO: ['Sem comunicação', 'danger'],
};
const MODELO: Record<string, [string, Tone]> = {
  APPROVED: ['Aprovado', 'success'],
  PENDING: ['Em análise', 'warning'],
  REJECTED: ['Rejeitado', 'danger'],
  PAUSED: ['Pausado', 'warning'],
  DISABLED: ['Desativado', 'danger'],
};
const QUALIDADE: Record<string, string> = { GREEN: 'alta', YELLOW: 'média', RED: 'baixa' };
const SALVO = '****************************'; // segredo salvo: nunca volta para a tela
const fmtPhone = (d: string) => d.replace(/^(\d{2})(\d{4,5})(\d{4})$/, '($1) $2-$3');
const fmtTier = (t: string) => (t === 'TIER_UNLIMITED' ? 'sem limite' : `${t.replace('TIER_', '').replace('K', ' mil')} pessoas por dia`);

/** Configurações → WhatsApp: API oficial da Meta, modelos de mensagem, avisos, atendimento e teste. */
export function WhatsappConfig() {
  const { busy, run } = useAction();
  const [st, setSt] = useState<Status>();
  const [bot, setBot] = useState<boolean>();
  const load = () => api<Status>('/admin/whatsapp').then(setSt, () => {});
  useEffect(() => { load(); api<{ enabled: boolean }>('/admin/whatsapp/bot').then((b) => setBot(b.enabled), () => {}); }, []);
  const toggleBot = (enabled: boolean) => run('bot', async () => { setBot((await api<{ enabled: boolean }>('/admin/whatsapp/bot', { method: 'PUT', body: { enabled } })).enabled); }, enabled ? 'Atendimento pelo WhatsApp ligado.' : 'Atendimento pelo WhatsApp desligado.');
  const toggleAviso = (a: Aviso) => run(`aviso:${a.key}`, async () => { await api('/admin/whatsapp/avisos', { method: 'PUT', body: { [a.key]: !a.on } }); await load(); });
  const enviarModelos = () => run('modelos', async () => {
    const r = await api<{ criados: number; erros: string[] }>('/admin/whatsapp/modelos', { body: {} });
    await load();
    if (r.erros.length) throw new Error(`${r.criados} enviado(s). Com erro: ${r.erros.join(' · ')}`);
  }, 'Modelos enviados. A Meta aprova em minutos ou em até 24 h.');

  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget; // o React zera currentTarget depois do await
    const f = new FormData(form);
    if (await run('save', () => api('/admin/whatsapp', { method: 'PUT', body: { phoneId: f.get('phoneId'), wabaId: f.get('wabaId'), token: f.get('token'), appSecret: f.get('appSecret') } }), 'Configuração salva.')) {
      for (const n of ['token', 'appSecret']) (form.elements.namedItem(n) as HTMLInputElement).value = '';
      load();
    }
  }

  if (!st) return <Loading />;
  const [label, tone] = STATE[st.state ?? ''] ?? ['Não configurado', 'neutral'];
  const faltam = st.modelos?.filter((m) => !m.status).length ?? 0;

  return (
    <div className="stack">
      <div className="card stack">
        <div className="row between">
          <h2>WhatsApp da UP Service{st.number ? ` · ${fmtPhone(st.number)}` : ''}</h2>
          <StatusBadge tone={tone}>{label}</StatusBadge>
        </div>
        <p className="muted">API oficial do WhatsApp (Meta). Envia o código de acesso, os avisos e atende os profissionais. Mensagem que a UP Service manda primeiro só sai com o modelo aprovado pela Meta, e cada envio é cobrado pela Meta.</p>
        {st.message && <Alert kind="warning">{st.message}</Alert>}
        {st.state === 'CONECTADO' && (
          <p className="muted">{st.name ? `Nome: ${st.name} · ` : ''}{st.quality ? `Qualidade: ${QUALIDADE[st.quality] ?? st.quality} · ` : ''}{st.tier ? `Limite: ${fmtTier(st.tier)}` : ''}</p>
        )}
        {st.state === 'CONECTADO' && (
          <form className="row wrap" onSubmit={(e) => { e.preventDefault(); const phone = new FormData(e.currentTarget).get('phone') as string; run('test', () => api('/admin/whatsapp/test', { body: { phone } }), 'Mensagem de teste enviada (código 123456).'); }}>
            <label style={{ flex: '1 1 220px' }}>Enviar teste para<input name="phone" type="tel" inputMode="tel" placeholder="(11) 99999-0000" required /></label>
            <button disabled={!!busy}>{busy === 'test' ? 'Enviando…' : 'Enviar teste'}</button>
          </form>
        )}
      </div>

      {st.configured && st.modelos && (
        <div className="card stack">
          <div className="row between">
            <h2>Modelos de mensagem</h2>
            <button type="button" className="ghost" disabled={!!busy} onClick={() => run('atualizar', load)}>Atualizar</button>
          </div>
          <p className="muted">Textos que a Meta aprova antes do uso. O app só envia o que estiver aprovado; o login por WhatsApp só aparece com o código de acesso aprovado.</p>
          <ul className="stack" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {st.modelos.map((m) => {
              const [l, t] = MODELO[m.status ?? ''] ?? (m.status ? [m.status, 'neutral' as Tone] : ['Não enviado', 'neutral' as Tone]);
              return (
                <li key={m.nome} className="row between wrap">
                  <span>{m.label}{m.motivo ? <span className="hint"> · motivo: {m.motivo}</span> : null}</span>
                  <StatusBadge tone={t}>{l}</StatusBadge>
                </li>
              );
            })}
          </ul>
          {faltam > 0 && <div><button className="primary" disabled={!!busy} onClick={enviarModelos}>{busy === 'modelos' ? 'Enviando…' : `Enviar ${faltam} modelo(s) para aprovação`}</button></div>}
        </div>
      )}

      {st.configured && (
        <div className="card stack">
          <h2>Avisos pelo WhatsApp</h2>
          <p className="muted">Cada aviso enviado é cobrado pela Meta (cerca de R$ 0,04). Desligado, o aviso continua no app e no e-mail.</p>
          {st.avisos.map((a) => (
            <label key={a.key} className="check"><input type="checkbox" checked={a.on} disabled={busy === `aviso:${a.key}`} onChange={() => toggleAviso(a)} /> {a.label}</label>
          ))}
        </div>
      )}

      {st.configured && bot !== undefined && (
        <div className="card stack">
          <div className="row between">
            <h2>Atendimento automático (bot)</h2>
            <StatusBadge tone={bot ? 'success' : 'neutral'}>{bot ? 'Ligado' : 'Desligado'}</StatusBadge>
          </div>
          <p className="muted">O profissional manda qualquer mensagem para o número oficial e o bot responde com botões e listas: procurar vagas e se candidatar, ver e desistir das diárias, Carteira e comprovantes, quebra de caixa (pedir revisão), ocorrências (contestar) e avisos. Os botões dos avisos ("Vou", "Não vou", "Ver quebras") continuam a conversa por aqui. Só atende quem confirmou o WhatsApp no app. "Falar com uma pessoa" deixa o bot quieto naquela conversa por 4 horas.</p>
          <div><button className={bot ? 'danger' : 'primary'} disabled={busy === 'bot'} onClick={() => toggleBot(!bot)}>{busy === 'bot' ? 'Salvando…' : bot ? 'Desligar o atendimento' : 'Ligar o atendimento'}</button></div>
        </div>
      )}

      {st.verifyToken && (
        <div className="card stack">
          <h2>Webhook (painel da Meta)</h2>
          <p className="muted">No app da Meta → WhatsApp → Configuração → Webhook, cole estes dois valores e assine o campo <strong>messages</strong>. Sem isso, o app envia, mas não recebe respostas.</p>
          <label>URL de retorno<input readOnly value={st.webhookUrl} onFocus={(e) => e.currentTarget.select()} /></label>
          <label>Token de verificação<input readOnly value={st.verifyToken} onFocus={(e) => e.currentTarget.select()} /></label>
        </div>
      )}

      <form className="card form" onSubmit={save}>
        <h2>Conta da Meta</h2>
        {st.source === 'env' ? (
          <Alert kind="info">A configuração vem das variáveis do servidor (WHATSAPP_*) e é alterada no painel da hospedagem.</Alert>
        ) : (
          <>
            <div className="cols">
              <label>Phone Number ID<input name="phoneId" inputMode="numeric" required defaultValue={st.phoneId} pattern="\d{5,25}" /></label>
              <label>WhatsApp Business Account ID<input name="wabaId" inputMode="numeric" required defaultValue={st.wabaId} pattern="\d{5,25}" /></label>
            </div>
            <label>Token de acesso (usuário do sistema)<input name="token" type="password" autoComplete="off" placeholder={st.hasToken ? SALVO : ''} required={!st.hasToken} /></label>
            <label>Chave secreta do app<input name="appSecret" type="password" autoComplete="off" placeholder={st.hasSecret ? SALVO : ''} required={!st.hasSecret} /><span className="hint">O token e a chave ficam só no servidor e não aparecem de novo. Em branco, continua valendo o que já está salvo.</span></label>
            <div><button className="primary" disabled={busy === 'save'}>{busy === 'save' ? 'Salvando…' : 'Salvar'}</button></div>
          </>
        )}
      </form>
    </div>
  );
}
