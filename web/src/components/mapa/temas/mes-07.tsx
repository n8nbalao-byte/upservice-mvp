// Julho: Inverno nas Serras. Pinheiros, neblina, um chalé com chaminé e uma caneca de chocolate quente.
import { type Tema } from '../kit';

const pinheiro = (x: number, y: number, s = 1) => (
  <g transform={`translate(${x} ${y}) scale(${s})`}>
    <ellipse cx="0" cy="2" rx="16" ry="4" fill="rgba(40,50,60,0.2)" />
    <rect x="-3" y="-10" width="6" height="10" fill="#6a4020" />
    <path d="M0 -60 L14 -36 H7 L18 -12 H-18 L-7 -36 H-14 Z" fill="#2f6e55" stroke="#1d4a38" strokeWidth="1.5" strokeLinejoin="round" />
    <path d="M0 -60 L6 -50 L0 -48 L-6 -50 Z M-7 -36 L0 -40 L7 -36 L5 -33 L0 -35 L-5 -33Z" fill="#ffffff" opacity="0.9" />
  </g>
);
const chale = (x: number, y: number) => (
  <g transform={`translate(${x} ${y})`}>
    <ellipse cx="0" cy="2" rx="30" ry="5" fill="rgba(40,50,60,0.2)" />
    <rect x="-24" y="-30" width="48" height="32" fill="#9a6a3a" stroke="#5a3a1a" strokeWidth="1.8" />
    {[-22, -14, -6].map((yy) => <path key={yy} d={`M-24 ${yy} H24`} stroke="#7a4a20" strokeWidth="1" />)}
    <path d="M-30 -28 L0 -54 L30 -28 Z" fill="#ffffff" stroke="#b9c9da" strokeWidth="1.8" strokeLinejoin="round" />
    <rect x="12" y="-52" width="8" height="14" fill="#7a5a4a" />
    <path d="M16 -56 q-6 -8 0 -14 q6 -6 0 -12" fill="none" stroke="rgba(255,255,255,0.8)" strokeWidth="3" strokeLinecap="round" />
    <rect x="-7" y="-16" width="14" height="18" fill="#5a3a1a" />
    <rect x="-20" y="-24" width="10" height="9" fill="#ffd45c" />
  </g>
);
const caneca = (x: number, y: number) => (
  <g transform={`translate(${x} ${y})`}>
    <rect x="-9" y="-16" width="18" height="18" rx="3" fill="#e05d5d" stroke="#8a2a2a" strokeWidth="1.5" />
    <path d="M9 -12 q8 0 8 6 q0 6 -8 6" fill="none" stroke="#8a2a2a" strokeWidth="2.5" />
    <ellipse cx="0" cy="-16" rx="9" ry="3" fill="#6a3a1a" />
    <path d="M-3 -20 q-3 -5 0 -9 M3 -20 q-3 -5 0 -9" fill="none" stroke="rgba(255,255,255,0.8)" strokeWidth="1.8" strokeLinecap="round" />
  </g>
);
const neblina = (x0: number, w: number, y: number) => <rect x={x0} y={y} width={w} height="26" rx="13" fill="rgba(255,255,255,0.45)" />;

const serras: Tema = {
  mes: 7,
  nome: 'Inverno nas Serras',
  chao: ['#dfeaf2', '#b7cad8'],
  trilha: '#fbf3e4',
  borda: '#8fa3b8',
  Cenario: ({ x0, w, h }) => (
    <g>
      {neblina(x0 - 10, w * 0.8, h * 0.05)}
      {chale(x0 + w * 0.72, h * 0.24)}
      {pinheiro(x0 + w * 0.18, h * 0.26, 0.95)}
      {pinheiro(x0 + w * 0.36, h * 0.18, 0.7)}
      {pinheiro(x0 + w * 0.82, h * 0.92, 1.05)}
      {pinheiro(x0 + w * 0.14, h * 0.94, 0.85)}
      {caneca(x0 + w * 0.46, h * 0.92)}
      {neblina(x0 + w * 0.3, w * 0.7, h * 0.7)}
    </g>
  ),
};
export default serras;
