import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import qrcode from 'qrcode-generator';
import { useMedia } from '../components/fit';
import { Alert } from '../components/ui';
import { api } from '../lib/api';
import { isMobile, isStandalone } from '../lib/install';

declare global {
  interface Window { google?: any }
}

type Config = { googleClientId: string | null; devLogin: boolean; phoneLogin?: boolean };
type Method = 'email' | 'phone' | 'qr';

// Fotos do carrossel: qualquer imagem colocada em web/src/assets/login entra sozinha no próximo build.
const IMAGES = Object.values(import.meta.glob('../assets/login/*.{jpg,jpeg,png,webp,avif}', { eager: true, query: '?url', import: 'default' })) as string[];

// Depoimentos criados para a tela (ilustrativos, a pedido da UP Service); trocar por depoimentos reais quando houver.
const QUOTES = [
  { text: 'Vejo as diárias perto de casa e me candidato em um minuto, direto pelo celular.', name: 'Juliana R.', role: 'Repositora' },
  { text: 'O check-in pelo celular acabou com a fila do ponto. Chego, seguro o botão e pronto.', name: 'Marcos A.', role: 'Operador de loja' },
  { text: 'Sei na hora quanto tenho a receber de cada diária. Sem surpresa no fim do mês.', name: 'Patrícia S.', role: 'Promotora' },
  { text: 'Monto a escala do mês inteiro de uma vez e acompanho a presença em tempo real.', name: 'Renato L.', role: 'Gestor de loja' },
];
const SLIDE_MS = 6500;

function Showcase() {
  const [i, setI] = useState(0);
  const [paused, setPaused] = useState(false);
  const still = useMedia('(prefers-reduced-motion: reduce)');
  const n = Math.max(QUOTES.length, IMAGES.length);
  useEffect(() => {
    if (still || paused) return;
    const t = setInterval(() => setI((v) => (v + 1) % n), SLIDE_MS);
    return () => clearInterval(t);
  }, [still, paused, n]);
  const q = QUOTES[i % QUOTES.length];
  return (
    <aside className="auth-visual" aria-label="Depoimentos" onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)} onFocus={() => setPaused(true)} onBlur={() => setPaused(false)}>
      {IMAGES.map((src, k) => <img key={src} src={src} alt="" className={k === i % IMAGES.length ? 'on' : ''} />)}
      <div className="auth-visual-shade" />
      <div className="auth-visual-body">
        <p className="auth-kicker">UP Service Intermediações</p>
        <h2>Diárias, escala e presença em um só lugar.</h2>
        <figure key={i} className="auth-quote" aria-live={still || paused ? 'polite' : 'off'}>
          <blockquote>“{q.text}”</blockquote>
          <figcaption><strong>{q.name}</strong> · {q.role}</figcaption>
        </figure>
        <div className="auth-dots" role="group" aria-label="Escolher depoimento">
          {Array.from({ length: n }, (_, k) => (
            <button key={k} type="button" aria-label={`Depoimento ${k + 1} de ${n}`} aria-current={k === i} onClick={() => setI(k)} />
          ))}
        </div>
        <p className="auth-note">Depoimentos ilustrativos.</p>
      </div>
      <svg className="auth-curve" viewBox="0 0 80 800" preserveAspectRatio="none" aria-hidden="true">
        <path d="M80 0 H34 C70 160 6 300 30 430 C52 560 8 680 40 800 H80 Z" />
      </svg>
    </aside>
  );
}

function EmailForm({ onLogin, onForgot, onError }: { onLogin: () => void; onForgot: (email: string) => void; onError: (m: string) => void }) {
  const [busy, setBusy] = useState(false);
  const [show, setShow] = useState(false);
  const email = useRef<HTMLInputElement>(null);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    onError('');
    await api('/auth/password', { body: { email: f.get('email'), password: f.get('password') } }).then(onLogin, (err) => onError(err.message));
    setBusy(false);
  }
  return (
    <form className="form" onSubmit={submit}>
      <label>E-mail<input ref={email} name="email" type="email" required autoComplete="username" inputMode="email" /></label>
      <label>
        Senha
        <span className="auth-pass">
          <input name="password" type={show ? 'text' : 'password'} required autoComplete="current-password" />
          <button type="button" className="ghost" onClick={() => setShow(!show)} aria-pressed={show}>{show ? 'Ocultar' : 'Mostrar'}</button>
        </span>
      </label>
      <button className="primary big" disabled={busy}>{busy ? 'Entrando…' : 'Entrar'}</button>
      <p className="auth-small">
        <button type="button" className="link" onClick={() => onForgot(email.current?.value ?? '')}>Esqueci minha senha</button>
        {' · '}Primeiro acesso com senha? Use o mesmo link para criar a sua.
      </p>
    </form>
  );
}

function ForgotForm({ initial, onBack }: { initial: string; onBack: () => void }) {
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState('');
  const [error, setError] = useState('');
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError('');
    await api<{ message: string }>('/auth/password/forgot', { body: { email: new FormData(e.currentTarget).get('email') } })
      .then((r) => setDone(r.message), (err) => setError(err.message));
    setBusy(false);
  }
  return (
    <div className="stack">
      <div className="stack" style={{ gap: 4 }}>
        <h2>Criar ou recuperar a senha</h2>
        <p className="muted">Informe o e-mail cadastrado. Enviamos um link que vale por 30 minutos.</p>
      </div>
      {error && <Alert kind="danger">{error}</Alert>}
      {done ? <Alert kind="success">{done}</Alert> : (
        <form className="form" onSubmit={submit}>
          <label>E-mail<input name="email" type="email" required autoComplete="username" defaultValue={initial} autoFocus /></label>
          <button className="primary big" disabled={busy}>{busy ? 'Enviando…' : 'Enviar link'}</button>
        </form>
      )}
      <button type="button" className="ghost" onClick={onBack}>Voltar para o login</button>
    </div>
  );
}

function PhoneForm({ onLogin, onError }: { onLogin: () => void; onError: (m: string) => void }) {
  const [phone, setPhone] = useState('');
  const [sent, setSent] = useState('');
  const [busy, setBusy] = useState(false);
  async function send(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    onError('');
    await api<{ message: string }>('/auth/phone/start', { body: { phone } }).then((r) => setSent(r.message), (err) => onError(err.message));
    setBusy(false);
  }
  async function verify(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    onError('');
    await api('/auth/phone/verify', { body: { phone, code: new FormData(e.currentTarget).get('code') } }).then(onLogin, (err) => onError(err.message));
    setBusy(false);
  }
  if (!sent) {
    return (
      <form className="form" onSubmit={send}>
        <label>Celular com DDD<input value={phone} onChange={(e) => setPhone(e.target.value)} type="tel" inputMode="tel" autoComplete="tel-national" placeholder="(11) 99999-0000" required /></label>
        <button className="primary big" disabled={busy}>{busy ? 'Enviando…' : 'Receber código no WhatsApp'}</button>
        <p className="auth-small">Vale para o WhatsApp que você confirmou na sua conta (em Meu perfil).</p>
      </form>
    );
  }
  return (
    <form className="form" onSubmit={verify}>
      <Alert kind="info">{sent}</Alert>
      <label>Código de 6 dígitos<input name="code" inputMode="numeric" autoComplete="one-time-code" pattern="\d{6}" maxLength={6} required autoFocus /></label>
      <button className="primary big" disabled={busy}>{busy ? 'Conferindo…' : 'Entrar'}</button>
      <button type="button" className="ghost" onClick={() => setSent('')}>Trocar o número ou reenviar</button>
    </form>
  );
}

type QrStart = { id: string; code: string; expiresAt: string };
const QR_TEXT: Record<string, string> = {
  AGUARDANDO: 'Aguardando a confirmação no celular…',
  EXPIRADO: 'O QR Code expirou.',
  ENCERRADO: 'Este QR Code já foi usado ou recusado.',
  ERRO: 'Não foi possível gerar o QR Code.',
};

function QrLogin({ onLogin }: { onLogin: () => void }) {
  const [qr, setQr] = useState<QrStart | null>(null);
  const [status, setStatus] = useState('AGUARDANDO');
  const [left, setLeft] = useState(0);
  const start = () => {
    setQr(null);
    setStatus('AGUARDANDO');
    api<QrStart>('/auth/qr/start', { body: {} }).then(setQr, () => setStatus('ERRO'));
  };
  useEffect(start, []);
  useEffect(() => {
    if (!qr || status !== 'AGUARDANDO') return;
    const poll = setInterval(() => {
      api<{ status: string }>(`/auth/qr/${qr.id}/status`).then((r) => {
        setStatus(r.status);
        if (r.status === 'CONFIRMADO') onLogin();
      }, () => setStatus('ERRO'));
    }, 2000);
    const tick = setInterval(() => {
      const s = Math.max(0, Math.round((new Date(qr.expiresAt).getTime() - Date.now()) / 1000));
      setLeft(s);
      if (!s) setStatus('EXPIRADO');
    }, 1000);
    return () => { clearInterval(poll); clearInterval(tick); };
  }, [qr, status]);
  // O QR leva só o endereço da página de autorização com o id público; nenhum token ou credencial.
  const svg = useMemo(() => {
    if (!qr || !/^[0-9a-f-]{36}$/.test(qr.id)) return '';
    const g = qrcode(0, 'M');
    g.addData(`${location.origin}/qr/${qr.id}`);
    g.make();
    return g.createSvgTag({ cellSize: 6, margin: 2, scalable: true });
  }, [qr]);
  const live = status === 'AGUARDANDO' && qr;
  return (
    <div className="auth-qr">
      <ol className="auth-steps">
        <li>No celular, abra a câmera e aponte para o código.</li>
        <li>Entre no app pelo celular, se ainda não estiver.</li>
        <li>Digite o número abaixo e toque em <strong>Autorizar</strong>.</li>
      </ol>
      <div className={`auth-qr-box${live ? '' : ' off'}`} role="img" aria-label="QR Code para entrar pelo celular" dangerouslySetInnerHTML={{ __html: svg }} />
      {live ? (
        <>
          <p className="auth-qr-code" aria-label={`Número de confirmação ${qr.code}`}>{qr.code}</p>
          <p className="auth-small" role="status">{QR_TEXT.AGUARDANDO} {left > 0 && `Expira em ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}.`}</p>
        </>
      ) : (
        <div className="stack" role="status">
          {status === 'CONFIRMADO' ? <Alert kind="success">Acesso autorizado. Entrando…</Alert> : <p className="muted">{qr || status !== 'AGUARDANDO' ? QR_TEXT[status] : 'Gerando…'}</p>}
          {status !== 'CONFIRMADO' && (qr || status === 'ERRO') && <button type="button" className="primary" onClick={start}>Gerar outro QR Code</button>}
        </div>
      )}
    </div>
  );
}

export default function Login({ onLogin }: { onLogin: () => void }) {
  const [config, setConfig] = useState<Config>();
  const [error, setError] = useState('');
  const [method, setMethod] = useState<Method>('email');
  const [forgot, setForgot] = useState<string | null>(null);
  const googleButton = useRef<HTMLDivElement>(null);
  // QR Code só no computador: no próprio celular não há como escanear a tela.
  const desktop = useMedia('(min-width: 900px) and (hover: hover)');
  const fromQr = location.pathname.startsWith('/qr/');

  useEffect(() => { api<Config>('/config').then(setConfig, (e) => setError(e.message)); }, []);

  useEffect(() => {
    if (!config?.googleClientId || forgot !== null) return;
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.onload = () => {
      window.google.accounts.id.initialize({
        client_id: config.googleClientId,
        callback: (r: { credential: string }) => api('/auth/google', { body: { credential: r.credential } }).then(onLogin, (e) => setError(e.message)),
      });
      window.google.accounts.id.renderButton(googleButton.current, { theme: 'outline', size: 'large', text: 'continue_with', locale: 'pt-BR', width: 320 });
    };
    document.head.appendChild(script);
    return () => script.remove();
  }, [config?.googleClientId, forgot]);

  const methods: [Method, string][] = [['email', 'E-mail'], ...(config?.phoneLogin ? [['phone', 'Telefone'] as [Method, string]] : []), ...(desktop && !fromQr ? [['qr', 'QR Code'] as [Method, string]] : [])];
  const current = methods.some(([m]) => m === method) ? method : 'email';

  async function devLogin(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    api('/auth/dev', { body: { email: f.get('email'), name: f.get('name') } }).then(onLogin, (err) => setError(err.message));
  }

  return (
    <div className="auth">
      <Showcase />
      <main className="auth-panel">
        <div className="auth-box">
          <img className="auth-logo" src="/logo.png" alt="UP Service Intermediações" />
          {forgot !== null ? <ForgotForm initial={forgot} onBack={() => setForgot(null)} /> : (
            <>
              <div className="stack" style={{ gap: 4 }}>
                <h1>Entrar</h1>
                <p className="muted">Vagas, candidaturas e registro de presença nas lojas atendidas pela UP Service.</p>
              </div>
              {fromQr && <Alert kind="info">Entre para autorizar o acesso no computador.</Alert>}
              {error && <Alert kind="danger">{error}</Alert>}
              {methods.length > 1 && (
                <div className="auth-tabs" role="tablist" aria-label="Forma de entrar">
                  {methods.map(([m, text]) => (
                    <button key={m} type="button" role="tab" id={`tab-${m}`} aria-selected={current === m} aria-controls="auth-method" onClick={() => { setMethod(m); setError(''); }}>{text}</button>
                  ))}
                </div>
              )}
              <div id="auth-method" role="tabpanel" aria-labelledby={`tab-${current}`}>
                {current === 'email' && <EmailForm onLogin={onLogin} onForgot={setForgot} onError={setError} />}
                {current === 'phone' && <PhoneForm onLogin={onLogin} onError={setError} />}
                {current === 'qr' && <QrLogin onLogin={onLogin} />}
              </div>
              {config?.googleClientId && (
                <>
                  <div className="auth-or"><span>ou</span></div>
                  <div ref={googleButton} className="auth-google" />
                </>
              )}
              {config?.devLogin && (
                <form className="form auth-dev" onSubmit={devLogin}>
                  <Alert kind="info">Modo desenvolvimento: entrar só com e-mail.</Alert>
                  <label>E-mail<input name="email" type="email" required autoComplete="off" /></label>
                  <label>Nome<input name="name" autoComplete="off" /></label>
                  <button className="primary">Entrar (desenvolvimento)</button>
                </form>
              )}
            </>
          )}
          {isMobile() && !isStandalone() && <a className="btn big" href="/instalar">Baixar o app no celular</a>}
          <p className="footer-links"><a href="/privacidade.html">Política de Privacidade</a><a href="/termos.html">Termos de Uso</a><a href="/politicas.html">Políticas</a></p>
          <p className="company-line">UP Service Intermediações Ltda · CNPJ 24.930.043/0001-34</p>
        </div>
      </main>
    </div>
  );
}
