// Escolha do personagem que representa o profissional no mapa do ano (na primeira entrada e quando quiser trocar).
import { useState } from 'react';
import { api } from '../../lib/api';
import { useAction } from '../ui';
import { PERSONAGENS, imagemPersonagem } from './jogo';

export function EscolhaPersonagem({ atual, onDone, onCancel }: { atual?: string | null; onDone: (id: string) => void; onCancel?: () => void }) {
  const [sel, setSel] = useState<string>(atual ?? '');
  const { busy, run } = useAction();
  const salvar = async () => {
    if (await run('personagem', () => api('/me/personagem', { method: 'PUT', body: { id: sel } }))) onDone(sel);
  };
  return (
    <section className="g-escolha" aria-labelledby="g-escolha-titulo">
      <h2 id="g-escolha-titulo">{atual ? 'Trocar personagem' : 'Escolha seu personagem'}</h2>
      <p>Ele vai representar você no mapa do ano e avançar um mês a cada mês.</p>
      <div className="g-escolha-grade" role="radiogroup" aria-label="Personagens">
        {PERSONAGENS.map((p) => (
          <button key={p.id} type="button" role="radio" aria-checked={sel === p.id} className={`g-escolha-card${sel === p.id ? ' sel' : ''}`} onClick={() => setSel(p.id)}>
            <img src={imagemPersonagem(p.id)} alt="" draggable={false} />
            <span>{p.nome}</span>
          </button>
        ))}
      </div>
      <div className="g-escolha-acoes">
        {onCancel && <button type="button" className="g-tomapa" onClick={onCancel}>Cancelar</button>}
        <button type="button" className="g-cta" disabled={!sel || busy === 'personagem'} onClick={salvar}>{atual ? 'Salvar' : 'Começar'}</button>
      </div>
    </section>
  );
}
