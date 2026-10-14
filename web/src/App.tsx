import { createContext, useContext, useEffect, useState } from 'react';
import { BrowserRouter, Navigate, NavLink, Route, Routes } from 'react-router-dom';
import { api, type Me } from './lib/api';
import AdminUnidades from './pages/AdminUnidades';
import AdminUsuarios from './pages/AdminUsuarios';
import Atividade from './pages/Atividade';
import Cadastro from './pages/Cadastro';
import GestaoAtividades from './pages/GestaoAtividades';
import GestaoCandidaturas from './pages/GestaoCandidaturas';
import GestaoProfissional from './pages/GestaoProfissional';
import GestaoVagas from './pages/GestaoVagas';
import Login from './pages/Login';
import Minhas from './pages/Minhas';
import Vagas from './pages/Vagas';

const MeContext = createContext<{ me: Me; reload: () => Promise<void> }>(null!);
export const useMe = () => useContext(MeContext);

export default function App() {
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  const reload = () => api<Me>('/me').then(setMe, () => setMe(null));
  useEffect(() => { reload(); }, []);

  if (me === undefined) return <p className="page">Carregando…</p>;
  if (!me) return <Login onLogin={reload} />;

  const role = me.user.role;
  const logout = () => api('/auth/logout', { body: {} }).then(() => setMe(null));
  return (
    <MeContext.Provider value={{ me, reload }}>
      <BrowserRouter>
        <header className="top">
          <strong>UpService</strong>
          <nav>
            {role === 'PROFISSIONAL' ? (
              <>
                <NavLink to="/vagas">Vagas</NavLink>
                <NavLink to="/minhas">Minhas diárias</NavLink>
                <NavLink to="/cadastro">Cadastro</NavLink>
              </>
            ) : (
              <>
                <NavLink to="/gestao/vagas">Vagas</NavLink>
                <NavLink to="/gestao/atividades">Atividades</NavLink>
                {role === 'ADMINISTRADOR' && <NavLink to="/admin/unidades">Unidades</NavLink>}
                {role === 'ADMINISTRADOR' && <NavLink to="/admin/usuarios">Usuários</NavLink>}
              </>
            )}
            <button className="link" onClick={logout}>Sair</button>
          </nav>
        </header>
        <main className="page">
          {role === 'PROFISSIONAL' ? (
            <Routes>
              <Route path="/cadastro" element={<Cadastro />} />
              <Route path="/vagas" element={me.complete ? <Vagas /> : <Navigate to="/cadastro" />} />
              <Route path="/minhas" element={<Minhas />} />
              <Route path="/atividade/:id" element={<Atividade />} />
              <Route path="*" element={<Navigate to={me.complete ? '/vagas' : '/cadastro'} />} />
            </Routes>
          ) : (
            <Routes>
              <Route path="/gestao/vagas" element={<GestaoVagas />} />
              <Route path="/gestao/vagas/:id" element={<GestaoCandidaturas />} />
              <Route path="/gestao/atividades" element={<GestaoAtividades />} />
              <Route path="/gestao/profissionais/:id" element={<GestaoProfissional />} />
              {role === 'ADMINISTRADOR' && <Route path="/admin/unidades" element={<AdminUnidades />} />}
              {role === 'ADMINISTRADOR' && <Route path="/admin/usuarios" element={<AdminUsuarios />} />}
              <Route path="*" element={<Navigate to="/gestao/vagas" />} />
            </Routes>
          )}
        </main>
      </BrowserRouter>
    </MeContext.Provider>
  );
}
