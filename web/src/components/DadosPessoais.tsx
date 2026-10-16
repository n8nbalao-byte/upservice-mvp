// Dados pessoais do profissional (Cadastro e Meu perfil). CPF só é informado uma vez; depois fica somente leitura
// (o servidor também recusa a troca). O e-mail não está aqui: vem do Google e não é editável.
import type { FormEvent, ReactNode } from 'react';
import { useMe } from '../App';
import { api } from '../lib/api';
import { useAction } from './ui';

export function DadosPessoais({ title, onSaved }: { title: ReactNode; onSaved?: () => void }) {
  const { me, reload } = useMe();
  const { busy, run } = useAction();
  const p = me.profile ?? {};

  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const body = Object.fromEntries(new FormData(e.currentTarget));
    if (await run('profile', async () => { await api('/me/profile', { method: 'PUT', body }); await reload(); }, 'Dados salvos.')) onSaved?.();
  }

  return (
    <form className="card form" onSubmit={save}>
      <h2>{title}</h2>
      <div className="cols">
        <label>Nome completo<input name="name" defaultValue={me.user.name} required minLength={3} autoComplete="name" /></label>
        <label>CPF<input name="cpf" defaultValue={p.cpf} inputMode="numeric" required readOnly={!!p.cpf} aria-readonly={!!p.cpf} placeholder="000.000.000-00" />{p.cpf && <span className="hint">O CPF não pode ser alterado</span>}</label>
        <label>RG<input name="rg" defaultValue={p.rg} required /></label>
        <label>Telefone (com DDD)<input name="phone" defaultValue={p.phone} inputMode="tel" required autoComplete="tel" placeholder="(11) 90000-0000" /></label>
      </div>
      <div className="cols">
        <label>Endereço<input name="address" defaultValue={p.address} required autoComplete="street-address" placeholder="Rua, número, complemento" /></label>
        <label>Cidade<input name="city" defaultValue={p.city} required /></label>
        <label>UF<input name="uf" defaultValue={p.uf ?? 'SP'} maxLength={2} required /></label>
      </div>
      <div className="cols">
        <label>Contato de emergência (nome)<input name="emergencyName" defaultValue={p.emergency_name} required /></label>
        <label>Telefone de emergência<input name="emergencyPhone" defaultValue={p.emergency_phone} inputMode="tel" required /></label>
      </div>
      <div><button className="primary" disabled={busy === 'profile'}>{busy === 'profile' ? 'Salvando…' : me.profile ? 'Salvar alterações' : 'Salvar e continuar'}</button></div>
    </form>
  );
}
