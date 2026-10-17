// Outubro: Praia. Areia dourada, mar na borda de cima, palmeiras, conchas, estrela-do-mar e guarda-sol.
import { kit, type Tema } from '../kit';

const palmeira = (x: number, y: number, s = 1) => (
  <g transform={`translate(${x} ${y}) scale(${s})`}>
    <ellipse cx="6" cy="2" rx="22" ry="5" fill="rgba(90,60,20,0.18)" />
    <path d="M0 0 Q-4 -40 8 -78" fill="none" stroke="#9a6a34" strokeWidth="7" strokeLinecap="round" />
    {[-24, -10, 6, 20].map((dy, i) => <path key={i} d={`M${-2 + i * 2} ${dy - 4} l6 -2`} stroke="#7b5224" strokeWidth="2" />)}
    <g transform="translate(8 -80)">
      <path d="M0 0 Q-22 -14 -40 4 Q-20 -4 0 0Z" fill="#3fa654" />
      <path d="M0 0 Q22 -16 42 2 Q20 -4 0 0Z" fill="#46b35c" />
      <path d="M0 0 Q-10 -26 -30 -28 Q-12 -14 0 0Z" fill="#58c26c" />
      <path d="M0 0 Q12 -28 32 -26 Q14 -12 0 0Z" fill="#3a9a4d" />
      <circle cx="-3" cy="4" r="4" fill="#7a4a1c" />
      <circle cx="4" cy="5" r="4" fill="#8a5624" />
    </g>
  </g>
);
const concha = (x: number, y: number, r = 0) => (
  <g transform={`translate(${x} ${y}) rotate(${r})`}>
    <path d="M0 0 Q-9 -2 -8 -10 Q0 -16 8 -10 Q9 -2 0 0Z" fill="#ffd9cc" stroke="#e09a86" strokeWidth="1.2" />
    {[-5, 0, 5].map((dx) => <path key={dx} d={`M0 -1 L${dx} -12`} stroke="#e09a86" strokeWidth="1" />)}
  </g>
);
const estrela = (x: number, y: number) => (
  <path transform={`translate(${x} ${y})`} d="M0 -9 L2.6 -3 9 -2.6 4 1.6 5.6 8 0 4.6 -5.6 8 -4 1.6 -9 -2.6 -2.6 -3Z" fill="#ff9a62" stroke="#d96a35" strokeWidth="1" strokeLinejoin="round" />
);
const guardaSol = (x: number, y: number) => (
  <g transform={`translate(${x} ${y})`}>
    <ellipse cx="4" cy="2" rx="24" ry="5" fill="rgba(90,60,20,0.18)" />
    <path d="M0 0 L6 -54" stroke="#8a6a4a" strokeWidth="3" strokeLinecap="round" />
    <path d="M-26 -46 Q6 -78 38 -60 Z" fill="#ff6b5a" />
    <path d="M-26 -46 Q-6 -66 6 -54 Z M18 -66 Q30 -64 38 -60 L14 -56Z" fill="#fff" opacity="0.9" />
  </g>
);

const praia: Tema = {
  mes: 10,
  nome: 'Praia',
  chao: ['#fbeab7', '#efcb83'],
  trilha: '#fff4d6',
  borda: '#d9a85c',
  Cenario: ({ x0, w, h }) => (
    <g>
      {/* Mar na borda de cima, com espuma ondulada */}
      <path d={`M${x0} 0 H${x0 + w} V${h * 0.13} Q${x0 + w * 0.75} ${h * 0.17} ${x0 + w * 0.5} ${h * 0.13} T${x0} ${h * 0.13} Z`} fill="#6cc6e8" />
      <path d={`M${x0} ${h * 0.13} Q${x0 + w * 0.25} ${h * 0.09} ${x0 + w * 0.5} ${h * 0.13} T${x0 + w} ${h * 0.13}`} fill="none" stroke="#fff" strokeWidth="4" strokeLinecap="round" opacity="0.85" />
      <path d={`M${x0 + w * 0.15} ${h * 0.06} q8 -5 16 0 M${x0 + w * 0.6} ${h * 0.05} q8 -5 16 0`} stroke="#d8f3ff" strokeWidth="3" fill="none" strokeLinecap="round" />
      {/* Ondulações da areia */}
      {[0.32, 0.55, 0.78].map((k) => <path key={k} d={`M${x0 + w * 0.08} ${h * k} q12 -6 24 0 t24 0`} fill="none" stroke="rgba(190,140,60,0.35)" strokeWidth="2" strokeLinecap="round" />)}
      {palmeira(x0 + w * 0.12, h * 0.36, 0.9)}
      {palmeira(x0 + w * 0.9, h * 0.9, 1.05)}
      {guardaSol(x0 + w * 0.82, h * 0.34)}
      {kit.pedra(x0 + w * 0.22, h * 0.94, 0.8, '#c9a47a')}
      {concha(x0 + w * 0.35, h * 0.86, -15)}
      {concha(x0 + w * 0.68, h * 0.22, 20)}
      {estrela(x0 + w * 0.56, h * 0.9)}
      {estrela(x0 + w * 0.2, h * 0.6)}
    </g>
  ),
};
export default praia;
