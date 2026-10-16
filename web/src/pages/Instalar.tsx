import { useEffect, useState } from 'react';
import { canPrompt, isIos, isStandalone, onInstallChange, promptInstall } from '../lib/install';

/** Página pública /instalar (link "Baixar o app" do site): instala o app na tela inicial do celular. */
export default function Instalar() {
  const [, render] = useState(0);
  const [done, setDone] = useState(false);
  useEffect(() => onInstallChange(() => render((n) => n + 1)), []);

  const installed = done || isStandalone();
  const ios = isIos();
  const native = !installed && !ios && canPrompt();

  async function install() {
    if (await promptInstall()) setDone(true);
  }

  return (
    <div className="login-wrap">
      <main className="login card install">
        <img className="logo" src="/logo.png" alt="UP Service Intermediações" />
        <div className="stack" style={{ textAlign: 'center', gap: 6 }}>
          <h1 style={{ fontSize: '1.4rem' }}>Baixe o app UP Service</h1>
          <p className="muted">Vagas e diárias perto de você, candidatura em um minuto e registro de presença pelo celular.</p>
        </div>

        {installed ? (
          <div className="stack" style={{ textAlign: 'center' }}>
            <p><strong>Pronto! O app UP Service está na sua tela inicial.</strong></p>
            <a className="btn primary big" href="/">Abrir o app</a>
          </div>
        ) : native ? (
          <button className="primary big" onClick={install}>Instalar o app</button>
        ) : ios ? (
          <ol className="install-steps">
            <li>Abra esta página no <strong>Safari</strong>.</li>
            <li>Toque em <strong>Compartilhar</strong> <ShareIcon /> na barra do navegador.</li>
            <li>Escolha <strong>Adicionar à Tela de Início</strong> e toque em <strong>Adicionar</strong>.</li>
          </ol>
        ) : (
          <ol className="install-steps">
            <li>Abra esta página no <strong>Chrome</strong>.</li>
            <li>Toque no menu <strong>⋮</strong>, no canto de cima.</li>
            <li>Escolha <strong>Instalar app</strong> (ou <strong>Adicionar à tela inicial</strong>) e confirme.</li>
          </ol>
        )}

        {!installed && <p className="muted" style={{ textAlign: 'center', fontSize: '0.88rem' }}>O ícone fica na tela inicial, como qualquer aplicativo. Não ocupa espaço e não precisa de loja.</p>}
        {!installed && <a className="btn ghost" href="/">Continuar pelo navegador</a>}
      </main>
    </div>
  );
}

const ShareIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-label="ícone de compartilhar" style={{ verticalAlign: '-3px' }}>
    <path d="M12 3v12M7 8l5-5 5 5" />
    <path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7" />
  </svg>
);
