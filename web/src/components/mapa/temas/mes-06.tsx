// Junho: Festa Junina. Bandeirinhas, fogueira, lanternas e balões (de papel, desenhados, só decoração).
import { type Tema } from '../kit';

const CORES = ['#ff5a5a', '#ffd84d', '#4fc3f7', '#7ed26b', '#ff9a4d', '#b07cff'];
const varal = (x0: number, w: number, y: number) => (
  <g>
    <path d={`M${x0} ${y} Q${x0 + w / 2} ${y + 18} ${x0 + w} ${y}`} fill="none" stroke="#7a4a1c" strokeWidth="1.5" />
    {Array.from({ length: 9 }, (_, i) => {
      const t = (i + 0.5) / 9;
      const x = x0 + w * t;
      const yy = y + 18 * 4 * t * (1 - t) * 0.5 + 1;
      return <path key={i} d={`M${x - 6} ${yy} H${x + 6} V${yy + 12} L${x} ${yy + 7} L${x - 6} ${yy + 12} Z`} fill={CORES[i % CORES.length]} />;
    })}
  </g>
);
const fogueira = (x: number, y: number) => (
  <g transform={`translate(${x} ${y})`}>
    <ellipse cx="0" cy="4" rx="26" ry="6" fill="rgba(60,30,10,0.22)" />
    <path d="M-20 2 L18 -6 M-18 -6 L20 2" stroke="#7a4a1c" strokeWidth="6" strokeLinecap="round" />
    <path d="M0 -40 Q16 -20 10 -4 Q0 4 -10 -4 Q-16 -20 0 -40Z" fill="#ff8a2a" />
    <path d="M0 -26 Q8 -14 5 -4 Q0 0 -5 -4 Q-8 -14 0 -26Z" fill="#ffd84d" />
  </g>
);
const lanterna = (x: number, y: number, cor: string) => (
  <g transform={`translate(${x} ${y})`}>
    <path d="M0 -16 V-26" stroke="#7a4a1c" strokeWidth="1.5" />
    <ellipse cx="0" cy="-6" rx="9" ry="11" fill={cor} stroke="rgba(0,0,0,0.25)" strokeWidth="1" />
    <path d="M-9 -6 H9 M-7 -13 H7 M-7 1 H7" stroke="rgba(0,0,0,0.2)" strokeWidth="1" />
    <circle cx="0" cy="-6" r="14" fill="rgba(255,226,122,0.25)" />
  </g>
);
const balao = (x: number, y: number) => (
  <g transform={`translate(${x} ${y})`}>
    <path d="M0 -26 Q16 -24 14 -6 Q10 8 0 12 Q-10 8 -14 -6 Q-16 -24 0 -26Z" fill="#ff5a5a" stroke="#a32121" strokeWidth="1.5" />
    <path d="M0 -26 V12 M-13 -10 H13" stroke="#ffd84d" strokeWidth="2" />
    <rect x="-4" y="12" width="8" height="5" fill="#ffd84d" />
  </g>
);

const junina: Tema = {
  mes: 6,
  nome: 'Festa Junina',
  chao: ['#f3dcae', '#dcb57a'],
  trilha: '#fff1d0',
  borda: '#a7783e',
  Cenario: ({ x0, w, h }) => (
    <g>
      {varal(x0, w, h * 0.06)}
      {balao(x0 + w * 0.78, h * 0.2)}
      {lanterna(x0 + w * 0.2, h * 0.26, '#ff9a4d')}
      {lanterna(x0 + w * 0.92, h * 0.7, '#ffd84d')}
      {fogueira(x0 + w * 0.3, h * 0.9)}
      {varal(x0, w, h * 0.74)}
      {lanterna(x0 + w * 0.7, h * 0.95, '#7ed26b')}
    </g>
  ),
};
export default junina;
