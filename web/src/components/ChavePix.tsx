import { useState, type FormEvent } from 'react';
import { api } from '../lib/api';
import { useAction } from './ui';

const TYPES = [
  { key: 'CPF', name: 'CPF', hint: 'Só números ou com pontos e traço', mode: 'numeric' },
  { key: 'TELEFONE', name: 'Celular', hint: 'DDD + número, ex.: (11) 91234-5678', mode: 'tel' },
  { key: 'EMAIL', name: 'E-mail', hint: 'O e-mail cadastrado no seu banco como chave Pix', mode: 'email' },
  { key: 'ALEATORIA', name: 'Chave aleatória', hint: 'Copie do app do seu banco (formato 0000…-0000)', mode: 'text' },
] as const;

/** Cadastro ou troca da chave Pix do profissional (é para ela que a UP Service faz os pagamentos). */
export function ChavePix({ initialType, initialKey, cpf, onDone, submitText = 'Salvar chave Pix' }: { initialType?: string | null; initialKey?: string | null; cpf?: string; onDone: () => void; submitText?: string }) {
  const { busy, run } = useAction();
  const [type, setType] = useState<string>(initialType ?? 'CPF');
  const [key, setKey] = useState(initialKey ?? (initialType ? '' : cpf ?? ''));
  const t = TYPES.find((x) => x.key === type) ?? TYPES[0];
  async function save(e: FormEvent) {
    e.preventDefault();
    if (await run('pix', () => api('/me/pix', { method: 'PUT', body: { type, key } }), 'Chave Pix salva.')) onDone();
  }
  return (
    <form className="stack" onSubmit={save}>
      <fieldset className="pix-types">
        <legend>Tipo da chave</legend>
        {TYPES.map((x) => (
          <label key={x.key} className={`pix-type${type === x.key ? ' selected' : ''}`}>
            <input type="radio" name="pix-type" value={x.key} checked={type === x.key} onChange={() => { setType(x.key); setKey(x.key === 'CPF' ? cpf ?? '' : ''); }} />
            {x.name}
          </label>
        ))}
      </fieldset>
      <label>Chave Pix<input value={key} onChange={(e) => setKey(e.target.value)} inputMode={t.mode === 'email' ? 'email' : t.mode === 'tel' ? 'tel' : t.mode === 'numeric' ? 'numeric' : 'text'} type={t.mode === 'email' ? 'email' : 'text'} autoComplete="off" required maxLength={77} /><span className="hint">{t.hint}</span></label>
      <div><button className="primary" disabled={busy === 'pix'}>{busy === 'pix' ? 'Salvando…' : submitText}</button></div>
    </form>
  );
}
