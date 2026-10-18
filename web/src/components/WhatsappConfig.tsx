import { useEffect, useState, type FormEvent } from 'react';
import { api } from '../lib/api';
import { PostadorConfig } from './PostadorConfig';
import { Alert, Loading, StatusBadge, useAction } from './ui';

type Status = { configured: boolean; source?: 'env' | 'db'; url?: string; instance?: string; hasKey?: boolean; state?: string; message?: string; number?: string | null };
const STATE: Record<string, [string, 'success' | 'warning' | 'danger' | 'neutral']> = {
  CONECTADO: ['Conectado', 'success'],
  CONECTANDO: ['Conectando…', 'warning'],
  DESCONECTADO: ['Desconectado', 'danger'],
  SEM_INSTANCIA: ['Instância não criada', 'warning'],
  ERRO: ['Sem comunicação', 'danger'],
  DESCONHECIDO: ['Desconhecido', 'neutral'],
};
export const fmtPhone = (d: string) => d.replace(/^(d{2})(d{4,5})(d{4})$/, '($1) $2-$3');

/** Configurações → WhatsApp: Evolution API, conexão por QR Code ou por código de pareamento, teste. */
export function WhatsappConfig() {
  const { busy, run } = useAction();
  const [st, setSt] = useState<Status>();
  const [pair, setPair] = useState<{ qr?: string | null; pairingCode?: string | null } | null>(null);
  const [codePhone, setCodePhone] = useState('');
  const [bot, setBot] = useState<boolean>();
  const load = () => api<Status>('/admin/whatsapp').then(setSt, () => setSt({ configured: false }));
  useEffect(() => { load(); api<{ enabled: boolean }>('/admin/whatsapp/bot').then((b) => setBot(b.enabled), () => {}); }, []);
  const toggleBot = (enabled: boolean) => run('bot', async () => { setBot((await api<{ enabled: boolean }>('/admin/whatsapp/bot', { method: 'PUT', body: { enabled } })).enabled); }, enabled ? 'Atendimento pelo WhatsApp ligado.' : 'Atendimento pelo WhatsApp desligado.');
  // Enquanto o QR/código está na tela, confere a conexão a cada 4 s.
  useEffect(() => {
    if (!pair) return;
    const t = setInterval(() => api<Status>('/admin/whatsapp').then((s) => { setSt(s); if (s.state === 'CONECTADO') setPair(null); }, () => {}), 4000);
    return () => clearInterval(t);
  }, [pair]);

  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget; // o React zera currentTarget depois do await
    const f = new FormData(form);
    if (await run('save', () => api('/admin/whatsapp', { method: 'PUT', body: { url: f.get('url'), instance: f.get('instance'), key: f.get('key') } }), 'Configuração salva.')) {
      (form.elements.namedItem('key') as HTMLInputElement).value = '';
      load();
    }
  }
  const connect = (method: 'qr' | 'code', phone?: string) => run(method, async () => {
    const r = await api<{ qr?: string | null; pairingCode?: string | null; state?: string }>('/admin/whatsapp/connect', { body: { method, phone } });
    if (r.state === 'CONECTADO') load(); else setPair(r);
  });

  if (!st) return <Loading />;
  const [label, tone] = STATE[st.state ?? ''] ?? ['Não configurado', 'neutral'];
  const fromEnv = st.source === 'env';

  return (
    <div className="stack">
      <div className="card stack">
        <div className="row between">
          <h2>WhatsApp da UP Service{st.number ? ` · ${fmtPhone(st.number)}` : ''}</h2>
          <StatusBadge tone={tone}>{st.configured ? label : 'Não configurado'}</StatusBadge>
        </div>
        <p className="muted">Usado para enviar o código de acesso por WhatsApp e avisos. A conexão é feita pela Evolution API, lendo o QR Code ou digitando um código no celular do número que vai ser usado. Para trocar de número: Desconectar e conectar o novo.</p>
        {st.message && <Alert kind="warning">{st.message}</Alert>}
        {st.url?.startsWith('http://') && <Alert kind="warning">A Evolution está num endereço sem HTTPS: a chave e o texto das mensagens (inclusive códigos de acesso) trafegam sem criptografia. Prefira um endereço https://.</Alert>}

        {st.configured && st.state === 'SEM_INSTANCIA' && (
          <div><button className="primary" disabled={!!busy} onClick={() => run('create', async () => { await api('/admin/whatsapp/create', { body: {} }); await load(); }, 'Instância criada.')}>Criar a instância "{st.instance}"</button></div>
        )}

        {st.configured && ['DESCONECTADO', 'CONECTANDO'].includes(st.state ?? '') && (
          <div className="stack">
            <div className="row wrap">
              <button className="primary" disabled={!!busy} onClick={() => connect('qr')}>{busy === 'qr' ? 'Gerando…' : 'Conectar com QR Code'}</button>
            </div>
            <form className="row wrap" onSubmit={(e) => { e.preventDefault(); connect('code', codePhone); }}>
              <label style={{ flex: '1 1 220px' }}>Ou conectar com código: celular do número<input type="tel" inputMode="tel" placeholder="(11) 99999-0000" value={codePhone} onChange={(e) => setCodePhone(e.target.value)} required /></label>
              <button disabled={!!busy}>{busy === 'code' ? 'Gerando…' : 'Gerar código'}</button>
            </form>
            {pair?.qr && (
              <div className="stack" style={{ alignItems: 'flex-start' }}>
                <img src={pair.qr} alt="QR Code para conectar o WhatsApp" width={260} height={260} style={{ border: '1px solid var(--line)', borderRadius: 12 }} />
                <p className="muted">No celular do número oficial: WhatsApp → <strong>Dispositivos conectados</strong> → <strong>Conectar dispositivo</strong> e aponte para o código. Ele vence em cerca de 40 segundos; gere outro se precisar.</p>
              </div>
            )}
            {pair?.pairingCode && (
              <div className="stack">
                <p className="wa-code" aria-label={`Código ${pair.pairingCode}`}>{pair.pairingCode}</p>
                <p className="muted">No celular do número oficial: WhatsApp → <strong>Dispositivos conectados</strong> → <strong>Conectar dispositivo</strong> → <strong>Conectar com número de telefone</strong> e digite o código.</p>
              </div>
            )}
          </div>
        )}

        {st.state === 'CONECTADO' && (
          <form className="row wrap" onSubmit={(e) => { e.preventDefault(); const phone = new FormData(e.currentTarget).get('phone') as string; run('test', () => api('/admin/whatsapp/test', { body: { phone } }), 'Mensagem de teste enviada.'); }}>
            <label style={{ flex: '1 1 220px' }}>Enviar teste para<input name="phone" type="tel" inputMode="tel" placeholder="(11) 99999-0000" required /></label>
            <button disabled={!!busy}>{busy === 'test' ? 'Enviando…' : 'Enviar teste'}</button>
            <button type="button" className="danger" disabled={!!busy} onClick={() => run('logout', async () => { await api('/admin/whatsapp/logout', { body: {} }); await load(); }, 'WhatsApp desconectado.')}>Desconectar</button>
          </form>
        )}
      </div>

      {st.state === 'CONECTADO' && bot !== undefined && (
        <div className="card stack">
          <div className="row between">
            <h2>Atendimento automático (bot)</h2>
            <StatusBadge tone={bot ? 'success' : 'neutral'}>{bot ? 'Ligado' : 'Desligado'}</StatusBadge>
          </div>
          <p className="muted">O profissional manda qualquer mensagem para o número oficial e o bot responde com enquetes: procurar vagas e se candidatar, ver e desistir das diárias, Carteira e comprovantes, quebra de caixa (pedir revisão), ocorrências (contestar) e avisos. Também lembra a véspera da diária (Vou / Não vou), avisa quando o check-in abre, quando a pausa está acabando e quando o checkout foi esquecido. Só atende quem confirmou o WhatsApp no app. "Falar com uma pessoa" deixa o bot quieto naquela conversa por 4 horas.</p>
          <div><button className={bot ? 'danger' : 'primary'} disabled={busy === 'bot'} onClick={() => toggleBot(!bot)}>{busy === 'bot' ? 'Salvando…' : bot ? 'Desligar o atendimento' : 'Ligar o atendimento'}</button></div>
        </div>
      )}

      {st.state === 'CONECTADO' && <PostadorConfig />}

      <form className="card form" onSubmit={save}>
        <h2>Evolution API</h2>
        {fromEnv ? (
          <Alert kind="info">A configuração vem das variáveis do servidor (EVOLUTION_*) e é alterada no painel da hospedagem.</Alert>
        ) : (
          <>
            <div className="cols">
              <label>Endereço<input name="url" type="url" required defaultValue={st.url ?? ''} placeholder="https://..." /></label>
              <label>Instância<input name="instance" defaultValue={st.instance ?? 'upservice'} pattern="[A-Za-z0-9_\-]{1,40}" required /></label>
            </div>
            <label>Chave (apikey)<input name="key" type="password" autoComplete="off" placeholder={st.hasKey ? 'Chave salva. Deixe em branco para manter.' : ''} required={!st.hasKey} /><span className="hint">Fica só no servidor e não aparece de novo.</span></label>
            <div><button className="primary" disabled={busy === 'save'}>{busy === 'save' ? 'Salvando…' : 'Salvar'}</button></div>
          </>
        )}
      </form>
    </div>
  );
}
