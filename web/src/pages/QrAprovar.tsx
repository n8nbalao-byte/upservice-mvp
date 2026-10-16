import { useEffect, useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Alert, Loading, PageHeader } from '../components/ui';
import { api, fmtTime } from '../lib/api';

type Info = { status: string; createdAt: string; expiresAt: string; device: string | null; ip: string | null; sameNetwork: boolean };

/** "Chrome no Windows" a partir do user agent; só para a pessoa reconhecer o computador. */
function deviceName(ua: string | null) {
  if (!ua) return 'navegador desconhecido';
  const browser = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'navegador';
  const os = /Windows/.test(ua) ? 'Windows' : /Mac OS X/.test(ua) ? 'Mac' : /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Linux/.test(ua) ? 'Linux' : '';
  return os ? `${browser} no ${os}` : browser;
}

/** Celular já logado autoriza o login no computador que mostrou o QR Code, conferindo o número exibido lá. */
export default function QrAprovar() {
  const { id } = useParams();
  const [info, setInfo] = useState<Info | null>(null);
  const [error, setError] = useState('');
  const [done, setDone] = useState<'ok' | 'deny' | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => { api<Info>(`/auth/qr/${id}`).then(setInfo, (e) => setError(e.message)); }, [id]);

  async function answer(body: { code?: string; deny?: boolean; otherNetwork?: boolean }) {
    setBusy(true);
    setError('');
    await api(`/auth/qr/${id}/approve`, { body }).then(() => setDone(body.deny ? 'deny' : 'ok'), (e) => setError(e.message));
    setBusy(false);
  }
  const approve = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    answer({ code: String(f.get('code') ?? ''), otherNetwork: f.get('otherNetwork') === 'on' });
  };

  return (
    <div className="page" style={{ maxWidth: 520 }}>
      <PageHeader title="Entrar no computador" description="Autorize só se foi você que abriu o QR Code agora." />
      {error && <Alert kind="danger">{error}</Alert>}
      {!info && !error && <Loading />}
      {done === 'ok' && <Alert kind="success">Pronto. O computador vai entrar na sua conta em instantes.</Alert>}
      {done === 'deny' && <Alert kind="info">Pedido recusado. Ninguém entrou na sua conta.</Alert>}
      {info && !done && (info.status !== 'AGUARDANDO' ? (
        <Alert kind="warning">Este QR Code expirou ou já foi usado. Gere outro no computador.</Alert>
      ) : (
        <form className="card form" onSubmit={approve}>
          <p>Pedido de acesso pelo <strong>{deviceName(info.device)}</strong>, às {fmtTime(info.createdAt)}. Vale até {fmtTime(info.expiresAt)}.</p>
          <p className="muted">Endereço (IP) do computador: <strong>{info.ip ?? 'desconhecido'}</strong></p>
          {!info.sameNetwork && (
            <>
              <Alert kind="danger">Este pedido veio de <strong>outra rede</strong>, não da mesma do seu celular. Se você não está na frente desse computador agora, <strong>recuse</strong>: alguém pode estar tentando entrar na sua conta.</Alert>
              <label className="check"><input type="checkbox" name="otherNetwork" required /> Estou na frente deste computador agora e fui eu que abri o QR Code.</label>
            </>
          )}
          <label>
            Número que aparece no computador
            <input name="code" inputMode="numeric" pattern="\d{2}" maxLength={2} required autoFocus autoComplete="off" style={{ fontSize: '1.6rem', letterSpacing: '0.3em', maxWidth: 140 }} />
          </label>
          <button className="primary big" disabled={busy}>{busy ? 'Autorizando…' : 'Autorizar'}</button>
          <button type="button" className="danger" disabled={busy} onClick={() => answer({ deny: true })}>Não fui eu, recusar</button>
        </form>
      ))}
      <p><Link to="/">Voltar ao início</Link></p>
    </div>
  );
}
