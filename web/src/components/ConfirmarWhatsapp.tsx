import { useState, type FormEvent } from 'react';
import { api, ApiError } from '../lib/api';
import { Alert } from './ui';

/** Confirmar o WhatsApp da conta: número → código de 6 dígitos enviado pelo WhatsApp oficial da UP Service. */
export function ConfirmarWhatsapp({ initial = '', onDone, onSendFailed }: { initial?: string; onDone: () => void; onSendFailed?: () => void }) {
  const [phone, setPhone] = useState(initial);
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function send(e?: FormEvent<HTMLFormElement>) {
    e?.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api('/me/whatsapp/start', { body: { phone } });
      setSent(true);
    } catch (err) {
      setError((err as Error).message);
      if (err instanceof ApiError && (err.status === 502 || err.status === 503)) onSendFailed?.();
    }
    setBusy(false);
  }
  async function verify(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const code = String(new FormData(e.currentTarget).get('code') ?? '');
    setBusy(true);
    setError('');
    await api('/me/whatsapp/verify', { body: { code } }).then(onDone, (err) => setError(err.message));
    setBusy(false);
  }

  return (
    <div className="stack">
      {error && <Alert kind="danger">{error}</Alert>}
      {!sent ? (
        <form className="form" onSubmit={send}>
          <label>Celular com WhatsApp (com DDD)<input value={phone} onChange={(e) => setPhone(e.target.value)} type="tel" inputMode="tel" autoComplete="tel-national" placeholder="(11) 99999-0000" required /></label>
          <button className="primary big" disabled={busy}>{busy ? 'Enviando…' : 'Receber código no WhatsApp'}</button>
        </form>
      ) : (
        <form className="form" onSubmit={verify}>
          <Alert kind="info">Enviamos um código pelo WhatsApp da UP Service, (11) 92674-6277, para o número {phone}.</Alert>
          <label>Código de 6 dígitos<input name="code" inputMode="numeric" autoComplete="one-time-code" pattern="\d{6}" maxLength={6} required autoFocus /></label>
          <button className="primary big" disabled={busy}>{busy ? 'Conferindo…' : 'Confirmar'}</button>
          <div className="row wrap">
            <button type="button" className="ghost" disabled={busy} onClick={() => send()}>Reenviar código</button>
            <button type="button" className="ghost" disabled={busy} onClick={() => setSent(false)}>Trocar o número</button>
          </div>
        </form>
      )}
    </div>
  );
}
