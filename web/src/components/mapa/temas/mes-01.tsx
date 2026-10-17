// Janeiro: Vale das Boas-vindas. Campo verde, sol nascendo, flores e a placa de "Início" da jornada.
import { kit, type Tema } from '../kit';

const sol = (x: number, y: number) => (
  <g transform={`translate(${x} ${y})`}>
    {Array.from({ length: 10 }, (_, i) => <path key={i} d="M0 -30 V-40" stroke="#ffcf3a" strokeWidth="4" strokeLinecap="round" transform={`rotate(${i * 36})`} />)}
    <circle r="22" fill="#ffd84d" stroke="#f0a500" strokeWidth="2.5" />
    <circle cx="-7" cy="-4" r="2.2" fill="#a8640a" /><circle cx="7" cy="-4" r="2.2" fill="#a8640a" />
    <path d="M-7 5 Q0 11 7 5" fill="none" stroke="#a8640a" strokeWidth="2" strokeLinecap="round" />
  </g>
);
const placa = (x: number, y: number) => (
  <g transform={`translate(${x} ${y})`}>
    <ellipse cx="0" cy="2" rx="16" ry="4" fill="rgba(40,60,20,0.18)" />
    <rect x="-3" y="-34" width="6" height="36" fill="#8a5a2a" />
    <path d="M-26 -46 H20 L28 -38 L20 -30 H-26 Z" fill="#d99a4a" stroke="#7a4a1c" strokeWidth="2" />
    <text x="-2" y="-34" textAnchor="middle" fontFamily="'Luckiest Guy', sans-serif" fontSize="11" fill="#4a2a0c">INÍCIO</text>
  </g>
);
const colina = (x: number, y: number, w: number, cor: string) => <path d={`M${x} ${y} q${w / 2} ${-w * 0.35} ${w} 0 Z`} fill={cor} />;

const vale: Tema = {
  mes: 1,
  nome: 'Vale das Boas-vindas',
  chao: ['#c8eca2', '#86cf62'],
  trilha: '#f3e3b8',
  borda: '#b99a5e',
  Cenario: ({ x0, w, h }) => (
    <g>
      {colina(x0 - 10, h * 0.2, w * 0.7, '#b0e08a')}
      {colina(x0 + w * 0.45, h * 0.22, w * 0.65, '#a2d87c')}
      {sol(x0 + w * 0.72, h * 0.09)}
      {placa(x0 + w * 0.2, h * 0.86)}
      {kit.arbusto(x0 + w * 0.82, h * 0.88, 0.9)}
      {kit.nuvem(x0 + w * 0.25, h * 0.07, 0.8)}
      {[0.08, 0.36, 0.55, 0.9].map((k, i) => kit.flor(x0 + w * k, h * (i % 2 ? 0.95 : 0.78), i % 2 ? '#ffd1e3' : '#ffffff'))}
      {kit.flor(x0 + w * 0.12, h * 0.3, '#fff7a8', '#ff9a4d')}
    </g>
  ),
};
export default vale;
