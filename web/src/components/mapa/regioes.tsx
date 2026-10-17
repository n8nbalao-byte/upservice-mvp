// Cenários do mapa do ano: cada mês tem um tema próprio num arquivo temas/mes-MM.tsx, carregado automaticamente
// (import.meta.glob). Para acrescentar o cenário de um mês, basta criar o arquivo: nada aqui precisa mudar.
// Sem tema, o mês usa o cenário neutro de campo (abaixo). Tudo em SVG, desenho próprio.
import { kit, type Tema } from './kit';

export type { Tema } from './kit';

/** Cenário neutro (campo), usado pelos meses que ainda não têm tema próprio. */
export const CAMPO: Tema = {
  mes: 0,
  nome: 'Campo',
  chao: ['#bfe39a', '#8fcf6d'],
  trilha: '#f1dfb4',
  borda: '#c9a86a',
  Cenario: ({ x0, w, h }) => (
    <g>
      {kit.nuvem(x0 + w * 0.3, h * 0.12, 0.9)}
      {kit.arbusto(x0 + w * 0.15, h * 0.2, 0.9)}
      {kit.arbusto(x0 + w * 0.85, h * 0.85, 1.1, '#4f9e3f')}
      {kit.pedra(x0 + w * 0.8, h * 0.18, 0.8, '#a8b4a0')}
      {kit.flor(x0 + w * 0.25, h * 0.88)}
      {kit.flor(x0 + w * 0.32, h * 0.92, '#ffd1e3')}
      {kit.flor(x0 + w * 0.7, h * 0.1, '#ffffff')}
    </g>
  ),
};

const mods = import.meta.glob<{ default: Tema }>('./temas/mes-*.tsx', { eager: true });
const TEMAS = new Map(Object.values(mods).map((m) => [m.default.mes, m.default]));

/** Tema do mês (1 a 12); sem arquivo próprio, o campo. */
export const temaDo = (mes: number): Tema => TEMAS.get(mes) ?? CAMPO;
/** Meses que já têm cenário próprio (para o teste e para a lista de limitações). */
export const mesesComTema = () => [...TEMAS.keys()].sort((a, b) => a - b);
