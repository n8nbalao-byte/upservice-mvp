import { useEffect, useState } from 'react';
import { Alert, Loading, PageHeader, StatusBadge, useAction } from '../components/ui';
import { api } from '../lib/api';
import { applyTheme, type Theme } from '../lib/theme';
import { WhatsappConfig } from '../components/WhatsappConfig';

const THEMES: { key: Theme; name: string; text: string }[] = [
  { key: 'padrao', name: 'Perfil 1 — Prata', text: 'Identidade atual do sistema: barra lateral prata, destaques e botões em grafite.' },
  { key: 'atacadao', name: 'Perfil 2 — Atacadão', text: 'Inspirado nas cores do Atacadão: barra verde, destaques em laranja e fonte Lato. Sem logotipo nem marca.' },
  { key: 'upservice', name: 'Perfil 3 — UP Service', text: 'As cores da UP Service, as mesmas do site: azul-marinho com destaques em dourado e fonte Poppins.' },
];

/** Prévia em miniatura: o atributo data-theme-brand aplica os tokens do perfil só dentro deste bloco. */
function Preview({ theme }: { theme: Theme }) {
  return (
    <div className="theme-preview" data-theme-brand={theme} aria-hidden="true">
      <div className="tp-nav"><span className="tp-item active">Dashboard</span><span className="tp-item">Vagas</span><span className="tp-item">Atividades</span></div>
      <div className="tp-main">
        <div className="tp-top" />
        <b>Vagas</b>
        <div className="tp-row"><button className="primary sm" tabIndex={-1}>Nova vaga</button><button className="sm" tabIndex={-1}>Importar</button></div>
        <div className="tp-row"><StatusBadge status="ABERTA" /><StatusBadge status="PENDENTE" /><span className="badge tone-accent plain">Destaque</span></div>
      </div>
    </div>
  );
}

/** Configurações globais (só o administrador principal; o servidor confere de novo). */
export default function AdminConfiguracoes() {
  const { busy, run } = useAction();
  const [theme, setTheme] = useState<Theme>();
  const [gamification, setGamification] = useState<boolean>();
  useEffect(() => { api<{ theme: Theme; gamification?: boolean }>('/config').then((c) => { setTheme(c.theme); setGamification(!!c.gamification); }); }, []);
  const toggleGamification = async () => {
    const next = !gamification;
    if (await run('gamification', () => api('/admin/settings/gamification', { method: 'PUT', body: { enabled: next } }), next ? 'Estrelas ligadas para os profissionais.' : 'Estrelas desligadas para os profissionais.')) setGamification(next);
  };

  async function choose(t: Theme) {
    if (await run(t, () => api('/admin/settings/theme', { method: 'PUT', body: { theme: t } }), 'Perfil de cores aplicado para todos os usuários.')) {
      setTheme(t);
      applyTheme(t);
    }
  }

  return (
    <div className="page" style={{ maxWidth: 1100 }}>
      <PageHeader title="Configurações" description="Ajustes globais do app. Só o administrador principal altera." />
      <section className="stack">
        <h2 className="section-title">Perfil de cores</h2>
        <Alert kind="info">A escolha vale para todos os usuários e telas (inclusive o login). Cada pessoa vê a mudança ao abrir ou recarregar o app.</Alert>
        {!theme ? <Loading /> : (
          <div className="grid-2">
            {THEMES.map((t) => (
              <article key={t.key} className={`card stack theme-card${theme === t.key ? ' current' : ''}`}>
                <Preview theme={t.key} />
                <div className="row between"><h2>{t.name}</h2>{theme === t.key && <StatusBadge status="ATIVA">Em uso</StatusBadge>}</div>
                <p className="muted">{t.text}</p>
                <div><button className={theme === t.key ? '' : 'primary'} disabled={theme === t.key || !!busy} onClick={() => choose(t.key)}>{theme === t.key ? 'Perfil em uso' : 'Usar este perfil'}</button></div>
              </article>
            ))}
          </div>
        )}
      </section>
      <section className="stack" style={{ marginTop: 32 }}>
        <h2 className="section-title">Estrelas do profissional (prévia)</h2>
        <div className="card stack">
          <div className="row between wrap">
            <p style={{ maxWidth: 640 }}>Tela "como um joguinho": cada diária vale até 3 estrelas, com nível e bônus do mês. <strong>Os valores dos bônus são de exemplo</strong> e as regras ainda serão definidas. Enquanto estiver desligada, só gestores e administradores veem (pela ficha do profissional, em "Ver estrelas").</p>
            {gamification !== undefined && <button className={gamification ? 'danger' : 'primary'} disabled={busy === 'gamification'} onClick={toggleGamification}>{gamification ? 'Desligar para os profissionais' : 'Ligar para os profissionais'}</button>}
          </div>
          {gamification && <StatusBadge status="ATIVA">Ligada: os profissionais veem "Estrelas" no menu</StatusBadge>}
        </div>
      </section>
      <section className="stack" style={{ marginTop: 32 }}>
        <h2 className="section-title">WhatsApp</h2>
        <WhatsappConfig />
      </section>
    </div>
  );
}
