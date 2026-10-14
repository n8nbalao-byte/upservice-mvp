import { useEffect, useRef, useState, type FormEvent } from 'react';
import { api } from '../lib/api';

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
      window.google.accounts.id.renderButton(googleButton.current, { theme: 'outline', size: 'large', text: 'continue_with', locale: 'pt-BR' });
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
    <div className="login card stack">
      <h1>UpService</h1>
      <p className="muted">Vagas, candidaturas e registro de presença nas lojas atendidas pela UpService.</p>
      {error && <p className="error">{error}</p>}
      {config?.googleClientId && <div ref={googleButton} />}
      {config && !config.googleClientId && !config.devLogin && <p className="notice">Login Google ainda não configurado.</p>}
      {config?.devLogin && (
        <form className="stack" onSubmit={devLogin}>
          <p className="notice">Modo desenvolvimento: entrar só com e-mail.</p>
          <label>E-mail<input name="email" type="email" required /></label>
          <label>Nome<input name="name" /></label>
          <button className="primary">Entrar</button>
        </form>
      )}
      <p className="muted"><a href="/privacidade.html">Política de Privacidade</a> · <a href="/termos.html">Termos de Uso</a></p>
    </div>
  );
}
