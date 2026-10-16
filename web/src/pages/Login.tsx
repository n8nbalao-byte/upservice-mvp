import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Alert } from '../components/ui';
import { api } from '../lib/api';
import { isMobile, isStandalone } from '../lib/install';

declare global {
  interface Window { google?: any }
}

export default function Login({ onLogin }: { onLogin: () => void }) {
  const [config, setConfig] = useState<{ googleClientId: string | null; devLogin: boolean }>();
  const [error, setError] = useState('');
  const googleButton = useRef<HTMLDivElement>(null);

  useEffect(() => { api('/config').then(setConfig, (e) => setError(e.message)); }, []);

  useEffect(() => {
    if (!config?.googleClientId) return;
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.onload = () => {
      window.google.accounts.id.initialize({
        client_id: config.googleClientId,
        callback: (r: { credential: string }) => api('/auth/google', { body: { credential: r.credential } }).then(onLogin, (e) => setError(e.message)),
      });
      window.google.accounts.id.renderButton(googleButton.current, { theme: 'outline', size: 'large', text: 'continue_with', locale: 'pt-BR', width: 300 });
    };
    document.head.appendChild(script);
    return () => script.remove();
  }, [config?.googleClientId]);

  async function devLogin(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    api('/auth/dev', { body: { email: f.get('email'), name: f.get('name') } }).then(onLogin, (err) => setError(err.message));
  }

  return (
    <div className="login-wrap">
      <main className="login card">
        <img className="logo" src="/logo.png" alt="UP Service Intermediações" />
        <div className="stack" style={{ textAlign: 'center', gap: 4 }}>
          <h1 style={{ fontSize: '1.3rem' }}>Bem-vindo(a)</h1>
          <p className="muted">Vagas, candidaturas e registro de presença nas lojas atendidas pela UP Service.</p>
        </div>
        {error && <Alert kind="danger">{error}</Alert>}
        {config?.googleClientId && <div ref={googleButton} style={{ display: 'flex', justifyContent: 'center', minHeight: 44 }} />}
        {config && !config.googleClientId && !config.devLogin && <Alert kind="warning">Login Google ainda não configurado.</Alert>}
        {config?.devLogin && (
          <form className="form" onSubmit={devLogin}>
            <Alert kind="info">Modo desenvolvimento: entrar só com e-mail.</Alert>
            <label>E-mail<input name="email" type="email" required autoComplete="email" /></label>
            <label>Nome<input name="name" autoComplete="name" /></label>
            <button className="primary big">Entrar</button>
          </form>
        )}
        {isMobile() && !isStandalone() && <a className="btn big" href="/instalar">Baixar o app no celular</a>}
        <p className="footer-links"><a href="/privacidade.html">Política de Privacidade</a><a href="/termos.html">Termos de Uso</a></p>
        <p className="company-line">UP Service Intermediações Ltda · CNPJ 24.930.043/0001-34</p>
      </main>
    </div>
  );
}
