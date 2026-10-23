import { useEffect, useState } from 'react';
import { Link, NavLink, Navigate, useParams } from 'react-router-dom';
import { PageHeader, StatusBadge, useAction } from '../components/ui';
import { api } from '../lib/api';
import { WhatsappConfig } from '../components/WhatsappConfig';
import { LoginFotosConfig } from '../components/LoginFotosConfig';

// Cada aba tem o seu endereço (/admin/configuracoes/<aba>): dá para mandar o link direto.
const ABAS = [
  { aba: '', text: 'Geral', description: 'Ajustes gerais do app.' },
  { aba: 'imagens', text: 'Imagens', description: 'Fotos que aparecem na tela de login.' },
  { aba: 'whatsapp', text: 'WhatsApp', description: 'Situação do número, modelos de mensagem, avisos e atendimento automático.' },
  { aba: 'whatsapp-api', text: 'API do WhatsApp', description: 'Conta da Meta (IDs, token e chave secreta) e webhook.' },
];

/** Configurações globais (só o administrador principal; o servidor confere de novo). */
export default function AdminConfiguracoes() {
  const { aba = '' } = useParams();
  const atual = ABAS.find((a) => a.aba === aba);
  if (!atual) return <Navigate to="/admin/configuracoes" replace />;

  return (
    <div className="page" style={{ maxWidth: 1100 }}>
      <PageHeader title="Configurações" description={`${atual.description} Só o administrador principal altera.`} />
      <div className="tabs" role="tablist" style={{ marginBottom: 20 }}>
        {ABAS.map((a) => (
          <NavLink key={a.aba} end to={`/admin/configuracoes${a.aba ? `/${a.aba}` : ''}`} role="tab" aria-selected={a.aba === aba} className={`tab${a.aba === aba ? ' active' : ''}`}>{a.text}</NavLink>
        ))}
      </div>
      {aba === '' && <Geral />}
      {aba === 'imagens' && <LoginFotosConfig />}
      {aba === 'whatsapp' && <WhatsappConfig parte="uso" />}
      {aba === 'whatsapp-api' && <WhatsappConfig parte="api" />}
    </div>
  );
}

function Geral() {
  const { busy, run } = useAction();
  const [gamification, setGamification] = useState<boolean>();
  useEffect(() => { api<{ gamification?: boolean }>('/config').then((c) => setGamification(!!c.gamification)); }, []);
  const toggleGamification = async () => {
    const next = !gamification;
    if (await run('gamification', () => api('/admin/settings/gamification', { method: 'PUT', body: { enabled: next } }), next ? 'Estrelas ligadas para os profissionais.' : 'Estrelas desligadas para os profissionais.')) setGamification(next);
  };

  return (
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
  );
}
