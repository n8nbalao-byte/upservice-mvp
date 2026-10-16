import { type FormEvent } from 'react';
import { useMe } from '../App';
import { DadosPessoais } from '../components/DadosPessoais';
import { PageHeader, useAction } from '../components/ui';
import { api, label } from '../lib/api';

/**
 * Meu perfil (todos os papéis): dados da própria conta. E-mail (do Google) e CPF são somente leitura; não há rota que
 * os altere. Correção de e-mail ou CPF é um processo à parte, com a UP Service.
 */
export default function Perfil() {
  const { me, reload } = useMe();
  const { busy, run } = useAction();
  const worker = me.user.role === 'PROFISSIONAL';

  async function saveName(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const name = String(new FormData(e.currentTarget).get('name') ?? '');
    await run('name', async () => { await api('/me/name', { method: 'PUT', body: { name } }); await reload(); }, 'Nome atualizado.');
  }

  return (
    <div className="page" style={{ maxWidth: 860 }}>
      <PageHeader title="Meu perfil" description="Seus dados de cadastro. Para corrigir o e-mail ou o CPF, fale com a UP Service." />
      <section className="card form" aria-label="Conta">
        <h2>Conta</h2>
        <div className="cols">
          <label>E-mail<input value={me.user.email} readOnly aria-readonly /><span className="hint">Vem da sua conta Google; não pode ser alterado aqui</span></label>
          <label>Perfil de acesso<input value={label(me.user.role)} readOnly aria-readonly /></label>
        </div>
      </section>
      <section className="card form" aria-label="Senha">
        <h2>Senha</h2>
        <p className="muted">Para entrar também com e-mail e senha, crie ou troque a senha pelo link que enviamos para {me.user.email}. Ao salvar a senha nova, você sai de todos os aparelhos.</p>
        <div>
          <button type="button" disabled={busy === 'pw'} onClick={() => run('pw', () => api('/auth/password/forgot', { body: { email: me.user.email } }), 'Link enviado. Confira seu e-mail (e o spam).')}>
            {busy === 'pw' ? 'Enviando…' : 'Enviar link para criar ou trocar a senha'}
          </button>
        </div>
      </section>
      {worker ? (
        <DadosPessoais title="Dados pessoais" />
      ) : (
        <form className="card form" onSubmit={saveName}>
          <h2>Nome</h2>
          <label style={{ maxWidth: 420 }}>Nome completo<input name="name" defaultValue={me.user.name} required minLength={3} maxLength={200} autoComplete="name" /></label>
          <div><button className="primary" disabled={busy === 'name'}>{busy === 'name' ? 'Salvando…' : 'Salvar'}</button></div>
        </form>
      )}
    </div>
  );
}
