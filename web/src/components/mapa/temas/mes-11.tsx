// Novembro: Mar. Água azul com ondas, ilhas de pedra, peixinhos, bolhas e um barquinho.
import { type Tema } from '../kit';

const onda = (x: number, y: number, w = 40) => <path d={`M${x} ${y} q${w / 4} -7 ${w / 2} 0 t${w / 2} 0`} fill="none" stroke="rgba(255,255,255,0.7)" strokeWidth="3" strokeLinecap="round" />;
const ilha = (x: number, y: number, s = 1) => (
  <g transform={`translate(${x} ${y}) scale(${s})`}>
    <ellipse cx="0" cy="10" rx="34" ry="8" fill="rgba(255,255,255,0.35)" />
    <path d="M-30 8 Q-26 -14 -6 -18 Q16 -20 28 -4 Q32 6 26 8 Z" fill="#9aa7b4" stroke="#5f6f80" strokeWidth="1.8" />
    <path d="M-14 -12 Q0 -16 12 -12" fill="none" stroke="rgba(255,255,255,0.5)" strokeWidth="2.5" strokeLinecap="round" />
    <path d="M-6 -16 Q-2 -30 6 -38 M6 -38 q-12 -2 -18 6 M6 -38 q10 -6 18 2" fill="none" stroke="#3f9a52" strokeWidth="3" strokeLinecap="round" />
  </g>
);
const peixe = (x: number, y: number, cor: string, flip = false) => (
  <g transform={`translate(${x} ${y}) scale(${flip ? -1 : 1} 1)`}>
    <ellipse cx="0" cy="0" rx="10" ry="6" fill={cor} />
    <path d="M8 0 l9 -6 v12z" fill={cor} />
    <circle cx="-5" cy="-1.5" r="1.6" fill="#1d2b3a" />
  </g>
);
const bolhas = (x: number, y: number) => (
  <g fill="none" stroke="rgba(255,255,255,0.8)" strokeWidth="1.5">
    <circle cx={x} cy={y} r="4" /><circle cx={x + 6} cy={y - 10} r="2.6" /><circle cx={x + 1} cy={y - 18} r="1.8" />
  </g>
);
const barco = (x: number, y: number) => (
  <g transform={`translate(${x} ${y})`}>
    <path d="M-24 0 H24 L16 12 H-16 Z" fill="#c8642e" stroke="#7a3a14" strokeWidth="1.8" />
    <path d="M0 0 V-34" stroke="#7a3a14" strokeWidth="2.5" />
    <path d="M2 -32 L22 -6 H2 Z" fill="#fff" stroke="#c9d6e0" strokeWidth="1.2" />
    <path d="M-2 -28 L-16 -6 H-2 Z" fill="#ffd84d" stroke="#e0b020" strokeWidth="1.2" />
  </g>
);

const mar: Tema = {
  mes: 11,
  nome: 'Mar',
  chao: ['#7fd0f0', '#3d9fd6'],
  trilha: '#fff6dc',
  borda: '#2f7fb4',
  Cenario: ({ x0, w, h }) => (
    <g>
      {onda(x0 + w * 0.1, h * 0.08)}
      {onda(x0 + w * 0.55, h * 0.16, 36)}
      {onda(x0 + w * 0.2, h * 0.72, 44)}
      {onda(x0 + w * 0.6, h * 0.88, 36)}
      {barco(x0 + w * 0.7, h * 0.11)}
      {ilha(x0 + w * 0.22, h * 0.24, 0.85)}
      {ilha(x0 + w * 0.82, h * 0.8, 0.9)}
      {peixe(x0 + w * 0.3, h * 0.84, '#ff9a4d')}
      {peixe(x0 + w * 0.5, h * 0.94, '#ffd84d', true)}
      {peixe(x0 + w * 0.12, h * 0.6, '#ff6fa1', true)}
      {bolhas(x0 + w * 0.42, h * 0.8)}
      {bolhas(x0 + w * 0.88, h * 0.4)}
    </g>
  ),
};
export default mar;
