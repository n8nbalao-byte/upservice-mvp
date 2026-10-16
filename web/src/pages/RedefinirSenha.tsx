import { useState, type FormEvent } from 'react';
import { Alert } from '../components/ui';
import { api } from '../lib/api';

/** Link do e-mail "Esqueci minha senha": cria a senha nova. Funciona logado ou não; ao trocar, todas as sessões saem. */
export default function RedefinirSenha() {
  const token = new URLSearchParams(location.search).get('t') ?? '';
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    if (f.get('password') !== f.get('confirm')) return setError('As senhas não conferem.');
    setBusy(true);
    setError('');
    await api('/auth/password/reset', { body: { token, password: f.get('password') } }).then(() => setDone(true), (err) => setError(err.message));
    setBusy(false);
  }

  return (
    <div className="login-wrap">
      <main className="login card">
        <img className="logo" src="/logo.png" alt="UP Service Intermediações" />
        <h1 style={{ fontSize: '1.3rem', textAlign: 'center' }}>Criar nova senha</h1>
        {error && <Alert kind="danger">{error}</Alert>}
        {done ? (
          <>
            <Alert kind="success">Senha criada. Por segurança, você saiu de todos os aparelhos; entre de novo com a senha nova.</Alert>
            <a className="btn primary big" href="/">Ir para o login</a>
          </>
        ) : !token ? (
          <Alert kind="warning">Link incompleto. Abra o link do e-mail de novo ou peça outro em "Esqueci minha senha".</Alert>
        ) : (
          <form className="form" onSubmit={submit}>
            <input type="hidden" name="username" autoComplete="username" />
            <label>Nova senha<input name="password" type="password" required minLength={8} maxLength={128} autoComplete="new-password" /><span className="hint">Mínimo de 8 caracteres, com letras e números</span></label>
            <label>Repita a senha<input name="confirm" type="password" required minLength={8} maxLength={128} autoComplete="new-password" /></label>
            <button className="primary big" disabled={busy}>{busy ? 'Salvando…' : 'Salvar senha'}</button>
          </form>
        )}
      </main>
    </div>
  );
}
