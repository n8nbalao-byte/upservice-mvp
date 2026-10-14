import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { api, isBlocked, type Me } from './lib/api';
import { beep } from './lib/device';
import { Shell } from './components/Shell';
import { DialogProvider, Loading } from './components/ui';
import AdminUnidades from './pages/AdminUnidades';
import AdminUsuarios from './pages/AdminUsuarios';
import Atividade from './pages/Atividade';
import Cadastro from './pages/Cadastro';
import Dashboard from './pages/Dashboard';
import GestaoAtividades from './pages/GestaoAtividades';
import GestaoCandidaturas from './pages/GestaoCandidaturas';
import GestaoDocumentos from './pages/GestaoDocumentos';
import GestaoOcorrencias from './pages/GestaoOcorrencias';
import GestaoProfissional from './pages/GestaoProfissional';
import GestaoVagas from './pages/GestaoVagas';
import Login from './pages/Login';
import Minhas from './pages/Minhas';
import Ocorrencias from './pages/Ocorrencias';
import Pendencias from './pages/Pendencias';
import Relatorios from './pages/Relatorios';
import Vagas from './pages/Vagas';

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
    return () => clearInterval(t);
  }, [enabled]);

  useEffect(() => {
    document.title = items.length ? `(${items.length}) UpService` : 'UpService';
  }, [items.length]);

  return { items, updatedAt, refresh };
}

export default function App() {
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  const reload = () => api<Me>('/me').then(setMe, () => setMe(null));
  useEffect(() => { reload(); }, []);

  const role = me?.user.role;
  const inbox = useInboxPolling(role === 'GESTOR' || role === 'ADMINISTRADOR');

  if (me === undefined) return <div className="login-wrap"><Loading /></div>;
  if (!me) return <DialogProvider><Login onLogin={reload} /></DialogProvider>;

  const blocked = role === 'PROFISSIONAL' && isBlocked(me.user.status);
  const logout = () => api('/auth/logout', { body: {} }).then(() => setMe(null));
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
                  <Route path="/cadastro" element={<Cadastro />} />
                  <Route path="/vagas" element={me.complete ? <Vagas /> : <Navigate to="/cadastro" />} />
                  <Route path="/minhas" element={<Minhas />} />
                  <Route path="/atividade/:id" element={<Atividade />} />
                  <Route path="/ocorrencias" element={<Ocorrencias />} />
                  <Route path="*" element={<Navigate to={me.complete ? '/vagas' : '/cadastro'} />} />
                </Routes>
              )
            ) : (
              <Routes>
                <Route path="/gestao/inicio" element={<Dashboard />} />
                <Route path="/gestao/pendencias" element={<Pendencias />} />
                <Route path="/gestao/vagas" element={<GestaoVagas />} />
                <Route path="/gestao/vagas/:id" element={<GestaoCandidaturas />} />
                <Route path="/gestao/atividades" element={<GestaoAtividades />} />
                <Route path="/gestao/profissionais/:id" element={<GestaoProfissional />} />
                <Route path="/gestao/documentos" element={<GestaoDocumentos />} />
                <Route path="/gestao/ocorrencias" element={<GestaoOcorrencias />} />
                <Route path="/gestao/relatorios" element={<Relatorios />} />
                {role === 'ADMINISTRADOR' && <Route path="/admin/unidades" element={<AdminUnidades />} />}
                {role === 'ADMINISTRADOR' && <Route path="/admin/usuarios" element={<AdminUsuarios />} />}
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
