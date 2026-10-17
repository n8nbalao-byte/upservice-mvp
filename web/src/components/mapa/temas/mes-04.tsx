// Abril: Montanhas e Pontes. Picos com neve, um rio que corre por baixo e uma ponte de madeira.
import { kit, type Tema } from '../kit';

const pico = (x: number, y: number, s: number, cor: string) => (
  <g transform={`translate(${x} ${y}) scale(${s})`}>
    <path d="M-40 0 L-6 -58 L4 -44 L14 -60 L46 0 Z" fill={cor} stroke="rgba(40,40,60,0.35)" strokeWidth="1.5" strokeLinejoin="round" />
    <path d="M-17 -40 L-6 -58 L4 -44 L14 -60 L24 -42 L14 -46 L4 -36 L-6 -46 Z" fill="#ffffff" />
  </g>
);
const rio = (x0: number, w: number, h: number) => (
  <path d={`M${x0} ${h * 0.82} C${x0 + w * 0.3} ${h * 0.76} ${x0 + w * 0.6} ${h * 0.9} ${x0 + w} ${h * 0.84} V${h * 0.9} C${x0 + w * 0.6} ${h * 0.96} ${x0 + w * 0.3} ${h * 0.82} ${x0} ${h * 0.88} Z`} fill="#7fc8ee" stroke="#4a9ccc" strokeWidth="1.5" />
);
const ponte = (x: number, y: number) => (
  <g transform={`translate(${x} ${y})`}>
    <path d="M-34 0 Q0 -16 34 0" fill="none" stroke="#7a4a1c" strokeWidth="7" />
    {[-26, -16, -6, 4, 14, 24].map((dx) => <rect key={dx} x={dx} y={-12 + Math.abs(dx) * 0.28} width="6" height="9" fill="#b07a40" stroke="#7a4a1c" strokeWidth="1" />)}
    <path d="M-34 -16 Q0 -30 34 -16" fill="none" stroke="#8a5a2a" strokeWidth="2.5" />
    <path d="M-34 -16 V0 M34 -16 V0" stroke="#7a4a1c" strokeWidth="3" />
  </g>
);

const montanhas: Tema = {
  mes: 4,
  nome: 'Montanhas e Pontes',
  chao: ['#d6ecc0', '#9ccf7e'],
  trilha: '#f4e2b8',
  borda: '#a9874f',
  Cenario: ({ x0, w, h }) => (
    <g>
      {pico(x0 + w * 0.25, h * 0.24, 1, '#8fa3b8')}
      {pico(x0 + w * 0.7, h * 0.22, 0.85, '#a3b6c8')}
      {kit.nuvem(x0 + w * 0.5, h * 0.07, 0.7)}
      {rio(x0, w, h)}
      {ponte(x0 + w * 0.32, h * 0.83)}
      {kit.pedra(x0 + w * 0.8, h * 0.95, 0.7, '#9aa7b4')}
      {kit.arbusto(x0 + w * 0.12, h * 0.66, 0.7, '#4f9e3f')}
    </g>
  ),
};
export default montanhas;
