import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { CHANGED, api, isBlocked, type Me } from './lib/api';
import { beep } from './lib/device';
import { Shell } from './components/Shell';
import { DialogProvider, Loading } from './components/ui';
import AdminUnidades from './pages/AdminUnidades';
import AdminConfiguracoes from './pages/AdminConfiguracoes';
import AdminUsuarios from './pages/AdminUsuarios';
import AdminPagamentos from './pages/AdminPagamentos';
import Ajustes from './pages/Ajustes';
import Atividade from './pages/Atividade';
import Cadastro from './pages/Cadastro';
import Calendario from './pages/Calendario';
import Dashboard from './pages/Dashboard';
import GestaoAtividades from './pages/GestaoAtividades';
import GestaoCandidaturas from './pages/GestaoCandidaturas';
import GestaoDocumentos from './pages/GestaoDocumentos';
import GestaoOcorrencias from './pages/GestaoOcorrencias';
import GestaoProfissional from './pages/GestaoProfissional';
import GestaoVagas from './pages/GestaoVagas';
import ImportarEscala from './pages/ImportarEscala';
import Login from './pages/Login';
import Minhas from './pages/Minhas';
import Ocorrencias from './pages/Ocorrencias';
import Pendencias from './pages/Pendencias';
import Perfil from './pages/Perfil';
import QrAprovar from './pages/QrAprovar';
import RedefinirSenha from './pages/RedefinirSenha';
import Relatorios from './pages/Relatorios';
import GestaoBonus from './pages/GestaoBonus';
import Vagas from './pages/Vagas';
import Avisos from './pages/Avisos';
import Estrelas, { GestaoEstrelas } from './pages/Estrelas';
import { ConfirmarWhatsapp } from './components/ConfirmarWhatsapp';
import { ChavePix } from './components/ChavePix';
import Carteira from './pages/Carteira';

const MeContext = createContext<{ me: Me; reload: () => Promise<void> }>(null!);
export const useMe = () => useContext(MeContext);

export type InboxItem = { key: string; kind: string; at: string; title: string; detail: string; link: string };
const InboxContext = createContext<{ items: InboxItem[]; updatedAt: string | null; refresh: () => void }>({ items: [], updatedAt: null, refresh: () => {} });
export const useInbox = () => useContext(InboxContext);

const INBOX_POLL_MS = 20000;

/** Central de pendências do gestor/admin: consulta periódica; avisa (som + notificação do navegador) quando surge item novo. */
function useInboxPolling(enabled: boolean) {
  const [items, setItems] = useState<InboxItem[]>([]);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const known = useRef<Set<string> | null>(null);

  const refresh = () => {
    api<{ items: InboxItem[]; serverNow: string }>('/manage/inbox').then(({ items: next, serverNow }) => {
      const fresh = known.current ? next.filter((i) => !known.current!.has(i.key)) : [];
      known.current = new Set(next.map((i) => i.key));
      setItems(next);
      setUpdatedAt(serverNow);
      if (fresh.length) {
        beep();
        if ('Notification' in window && Notification.permission === 'granted') {
          new Notification(`UpService: ${fresh.length} nova(s) pendência(s)`, { body: fresh.map((i) => i.title).slice(0, 3).join('\n'), tag: 'upservice-inbox' });
        }
      }
    }, () => {});
  };

  useEffect(() => {
    if (!enabled) return;
    refresh();
    const t = setInterval(refresh, INBOX_POLL_MS);
    window.addEventListener(CHANGED, refresh);
    return () => { clearInterval(t); window.removeEventListener(CHANGED, refresh); };
  }, [enabled]);

  useEffect(() => {
    document.title = items.length ? `(${items.length}) UpService` : 'UpService';
  }, [items.length]);

  return { items, updatedAt, refresh };
}

export default function App() {
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  const [whatsappRequired, setWhatsappRequired] = useState(false);
  const [whatsappLater, setWhatsappLater] = useState(false);
  const reload = () => api<Me>('/me').then(setMe, () => setMe(null));
  useEffect(() => {
    reload();
    api<{ phoneLogin?: boolean }>('/config').then((c) => setWhatsappRequired(!!c.phoneLogin), () => {});
  }, []);

  const role = me?.user.role;
  const inbox = useInboxPolling(role === 'GESTOR' || role === 'ADMINISTRADOR');

  // O link do e-mail funciona logado ou não.
  if (location.pathname === '/redefinir-senha') return <RedefinirSenha />;
  if (me === undefined) return <div className="login-wrap"><Loading /></div>;
  if (!me) return <DialogProvider><Login onLogin={reload} /></DialogProvider>;

  const blocked = role === 'PROFISSIONAL' && isBlocked(me.user.status);
  const logout = () => api('/auth/logout', { body: {} }).then(() => setMe(null));
  // WhatsApp confirmado é obrigatório para todos (menos o bloqueado, em modo restrito). Se o envio falhar, segue por enquanto.
  if (whatsappRequired && !me.user.whatsapp && !blocked && !whatsappLater) {
    return <DialogProvider><WhatsappObrigatorio me={me} onDone={reload} onLater={() => setWhatsappLater(true)} onLogout={logout} /></DialogProvider>;
  }
  // Chave Pix obrigatória para o profissional que já preencheu os dados (antes disso, o Cadastro vem primeiro).
  if (role === 'PROFISSIONAL' && !blocked && me.profile && !me.profile.pix_key) {
    return <DialogProvider><PixObrigatorio me={me} onDone={reload} onLogout={logout} /></DialogProvider>;
  }
  return (
    <MeContext.Provider value={{ me, reload }}>
      <InboxContext.Provider value={inbox}>
        <DialogProvider>
        <BrowserRouter>
          <Shell me={me} inboxCount={inbox.items.length} onLogout={logout}>
            {role === 'PROFISSIONAL' ? (
              blocked ? (
                <Routes>
                  <Route path="/ocorrencias" element={<Ocorrencias />} />
                  <Route path="*" element={<Navigate to="/ocorrencias" />} />
                </Routes>
              ) : (
                <Routes>
                  <Route path="/inicio" element={<Navigate to="/minhas" replace />} />
                  <Route path="/cadastro" element={<Cadastro />} />
                  <Route path="/vagas" element={me.complete ? <Vagas /> : <Navigate to="/cadastro" />} />
                  <Route path="/minhas" element={<Minhas />} />
                  <Route path="/avisos" element={<Avisos />} />
                  <Route path="/carteira" element={<Carteira />} />
                  <Route path="/estrelas" element={<Estrelas />} />
                  <Route path="/atividade/:id" element={<Atividade />} />
                  <Route path="/ocorrencias" element={<Ocorrencias />} />
                  <Route path="/perfil" element={<Perfil />} />
                  <Route path="/qr/:id" element={<QrAprovar />} />
                  <Route path="*" element={<Navigate to="/minhas" />} />
                </Routes>
              )
            ) : (
              <Routes>
                <Route path="/gestao/inicio" element={<Dashboard />} />
                <Route path="/gestao/pendencias" element={<Pendencias />} />
                <Route path="/gestao/vagas" element={<GestaoVagas />} />
                <Route path="/gestao/vagas/importar" element={<ImportarEscala />} />
                <Route path="/gestao/vagas/:id" element={<GestaoCandidaturas />} />
                <Route path="/gestao/atividades" element={<GestaoAtividades />} />
                <Route path="/gestao/calendario" element={<Calendario />} />
                <Route path="/gestao/profissionais/:id" element={<GestaoProfissional />} />
                <Route path="/gestao/profissionais/:id/estrelas" element={<GestaoEstrelas />} />
                <Route path="/gestao/documentos" element={<GestaoDocumentos />} />
                <Route path="/gestao/ocorrencias" element={<GestaoOcorrencias />} />
                <Route path="/gestao/relatorios" element={<Relatorios />} />
                {role === 'ADMINISTRADOR' && <Route path="/gestao/bonus" element={<GestaoBonus />} />}
                <Route path="/gestao/ajustes" element={<Ajustes />} />
                <Route path="/perfil" element={<Perfil />} />
                <Route path="/qr/:id" element={<QrAprovar />} />
                {role === 'ADMINISTRADOR' && <Route path="/admin/unidades" element={<AdminUnidades />} />}
                {role === 'ADMINISTRADOR' && <Route path="/admin/usuarios" element={<AdminUsuarios />} />}
                {role === 'ADMINISTRADOR' && <Route path="/admin/pagamentos" element={<AdminPagamentos />} />}
                {me.user.isOwner && <Route path="/admin/configuracoes" element={<AdminConfiguracoes />} />}
                <Route path="*" element={<Navigate to="/gestao/inicio" />} />
              </Routes>
            )}
          </Shell>
        </BrowserRouter>
        </DialogProvider>
      </InboxContext.Provider>
    </MeContext.Provider>
  );
}

/** Chave Pix obrigatória para o profissional (é para ela que a UP Service paga). Sem "depois". */
function PixObrigatorio({ me, onDone, onLogout }: { me: Me; onDone: () => void; onLogout: () => void }) {
  return (
    <div className="login-wrap">
      <main className="login card">
        <img className="logo" src="/logo.png" alt="UP Service Intermediações" />
        <div className="stack" style={{ textAlign: 'center', gap: 6 }}>
          <h1 style={{ fontSize: '1.3rem' }}>Cadastre sua chave Pix</h1>
          <p className="muted">Olá, {me.user.name.split(' ')[0]}. Os pagamentos das diárias e dos bônus são feitos por Pix, nesta chave. Confira com cuidado: ela precisa ser sua.</p>
        </div>
        <ChavePix cpf={me.profile?.cpf} onDone={onDone} submitText="Salvar e continuar" />
        <button type="button" className="ghost" onClick={onLogout}>Sair</button>
      </main>
    </div>
  );
}

function WhatsappObrigatorio({ me, onDone, onLater, onLogout }: { me: Me; onDone: () => void; onLater: () => void; onLogout: () => void }) {
  const [failed, setFailed] = useState(false);
  return (
    <div className="login-wrap">
      <main className="login card">
        <img className="logo" src="/logo.png" alt="UP Service Intermediações" />
        <div className="stack" style={{ textAlign: 'center', gap: 6 }}>
          <h1 style={{ fontSize: '1.3rem' }}>Confirme seu WhatsApp</h1>
          <p className="muted">Olá, {me.user.name.split(' ')[0]}. Para usar o app, confirme o seu número de WhatsApp: é por ele que avisamos sobre diárias e que você pode entrar com um código.</p>
        </div>
        <ConfirmarWhatsapp initial={me.profile?.phone ?? ''} onDone={onDone} onSent={() => setFailed(true)} />
        {failed && <button type="button" className="ghost" onClick={onLater}>Não recebi o código — continuar por enquanto</button>}
        <button type="button" className="ghost" onClick={onLogout}>Sair</button>
      </main>
    </div>
  );
}
