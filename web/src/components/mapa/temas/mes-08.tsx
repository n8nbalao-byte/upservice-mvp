// Agosto: Cânion de Cristais. Paredões de pedra avermelhada e cristais coloridos brilhando.
import { type Tema } from '../kit';

const paredao = (x0: number, w: number, y: number, flip = false) => (
  <path d={flip
    ? `M${x0} ${y} L${x0 + w * 0.2} ${y - 22} L${x0 + w * 0.42} ${y - 10} L${x0 + w * 0.6} ${y - 30} L${x0 + w * 0.82} ${y - 14} L${x0 + w} ${y - 26} V${y + 120} H${x0} Z`
    : `M${x0} 0 H${x0 + w} V${y} L${x0 + w * 0.78} ${y + 18} L${x0 + w * 0.56} ${y + 6} L${x0 + w * 0.34} ${y + 24} L${x0 + w * 0.14} ${y + 10} L${x0} ${y + 20} Z`}
    fill="#c9744a" stroke="#8a4024" strokeWidth="1.8" strokeLinejoin="round" />
);
const cristal = (x: number, y: number, cor: string, s = 1) => (
  <g transform={`translate(${x} ${y}) scale(${s})`}>
    <path d="M0 -30 L9 -12 L5 4 H-5 L-9 -12 Z" fill={cor} stroke="rgba(255,255,255,0.9)" strokeWidth="1.5" strokeLinejoin="round" />
    <path d="M12 -18 L18 -6 L15 4 H9 L7 -8 Z" fill={cor} opacity="0.85" stroke="rgba(255,255,255,0.9)" strokeWidth="1.2" />
    <path d="M-2 -24 L-5 -10" stroke="rgba(255,255,255,0.8)" strokeWidth="2" strokeLinecap="round" />
    <path d="M14 -34 l1.6 3.4 3.4 1.6 -3.4 1.6 -1.6 3.4 -1.6 -3.4 -3.4 -1.6 3.4 -1.6z" fill="#ffffff" />
  </g>
);

const canion: Tema = {
  mes: 8,
  nome: 'Cânion de Cristais',
  chao: ['#f0c9a4', '#dc9f74'],
  trilha: '#fbe7cc',
  borda: '#9a5a34',
  Cenario: ({ x0, w, h }) => (
    <g>
      {paredao(x0, w, h * 0.14)}
      {paredao(x0, w, h * 0.86, true)}
      {cristal(x0 + w * 0.2, h * 0.3, '#7fd6ff')}
      {cristal(x0 + w * 0.8, h * 0.32, '#c79bff', 0.9)}
      {cristal(x0 + w * 0.3, h * 0.82, '#ff8fc8', 0.85)}
      {cristal(x0 + w * 0.7, h * 0.8, '#7fe0b0', 1.05)}
    </g>
  ),
};
export default canion;
