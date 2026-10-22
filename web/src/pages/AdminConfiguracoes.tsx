import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { PageHeader, StatusBadge, useAction } from '../components/ui';
import { api } from '../lib/api';
import { WhatsappConfig } from '../components/WhatsappConfig';
import { LoginFotosConfig } from '../components/LoginFotosConfig';

/** Configurações globais (só o administrador principal; o servidor confere de novo). */
export default function AdminConfiguracoes() {
  const { busy, run } = useAction();
  const [gamification, setGamification] = useState<boolean>();
  useEffect(() => { api<{ gamification?: boolean }>('/config').then((c) => setGamification(!!c.gamification)); }, []);
  const toggleGamification = async () => {
    const next = !gamification;
    if (await run('gamification', () => api('/admin/settings/gamification', { method: 'PUT', body: { enabled: next } }), next ? 'Estrelas ligadas para os profissionais.' : 'Estrelas desligadas para os profissionais.')) setGamification(next);
  };

  return (
    <div className="page" style={{ maxWidth: 1100 }}>
      <PageHeader title="Configurações" description="Ajustes globais do app. Só o administrador principal altera." />
      <section className="stack">
        <h2 className="section-title">Estrelas do profissional</h2>
        <div className="card stack">
          <div className="row between wrap">
            <p style={{ maxWidth: 640 }}>Tela "como um joguinho": cada mês é um nível e cada dia vale até 3 estrelas. <strong>O bônus vale dinheiro</strong>: o valor do mês é definido em <Link className="link" to="/gestao/bonus">Bônus do mês</Link>, e quem fizer 3 estrelas num dia de bônus ganha o valor no A receber. Enquanto estiver desligada, só gestores e administradores veem (pela ficha do profissional, em "Ver estrelas").</p>
            {gamification !== undefined && <button className={gamification ? 'danger' : 'primary'} disabled={busy === 'gamification'} onClick={toggleGamification}>{gamification ? 'Desligar para os profissionais' : 'Ligar para os profissionais'}</button>}
          </div>
          {gamification && <StatusBadge status="ATIVA">Ligada: os profissionais veem "Estrelas" no menu</StatusBadge>}
        </div>
      </section>
      <section className="stack" style={{ marginTop: 32 }}>
        <h2 className="section-title">Fotos da tela de login</h2>
        <LoginFotosConfig />
      </section>
      <section className="stack" style={{ marginTop: 32 }}>
        <h2 className="section-title">WhatsApp</h2>
        <WhatsappConfig />
      </section>
    </div>
  );
}
