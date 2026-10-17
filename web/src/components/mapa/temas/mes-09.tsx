// Setembro: Floresta da Primavera. Ipês floridos (rosa e amarelo), cogumelos e passarinhos.
import { kit, type Tema } from '../kit';

const ipe = (x: number, y: number, cor: string, s = 1) => (
  <g transform={`translate(${x} ${y}) scale(${s})`}>
    <ellipse cx="0" cy="2" rx="22" ry="5" fill="rgba(40,60,20,0.18)" />
    <path d="M0 0 V-36 M0 -24 L-12 -38 M0 -30 L12 -44" stroke="#6a4020" strokeWidth="5" strokeLinecap="round" />
    <circle cx="-14" cy="-44" r="15" fill={cor} />
    <circle cx="10" cy="-52" r="17" fill={cor} />
    <circle cx="-2" cy="-62" r="14" fill={cor} />
    <circle cx="-6" cy="-56" r="4" fill="rgba(255,255,255,0.35)" />
  </g>
);
const cogumelo = (x: number, y: number) => (
  <g transform={`translate(${x} ${y})`}>
    <rect x="-3.5" y="-10" width="7" height="10" rx="2" fill="#fff2dc" />
    <path d="M-12 -9 Q-12 -22 0 -22 Q12 -22 12 -9 Z" fill="#e05d5d" stroke="#8a2a2a" strokeWidth="1.2" />
    <circle cx="-5" cy="-15" r="2" fill="#fff" /><circle cx="5" cy="-17" r="1.6" fill="#fff" />
  </g>
);
const passaro = (x: number, y: number, cor: string) => (
  <g transform={`translate(${x} ${y})`}>
    <ellipse cx="0" cy="0" rx="8" ry="6" fill={cor} />
    <circle cx="6" cy="-4" r="4.5" fill={cor} />
    <path d="M10 -4 l5 1 -5 2z" fill="#ffb347" />
    <circle cx="7" cy="-5" r="1" fill="#1d2b3a" />
    <path d="M-2 -2 q-6 -8 -12 -2" fill="none" stroke="rgba(0,0,0,0.25)" strokeWidth="2" />
  </g>
);

const floresta: Tema = {
  mes: 9,
  nome: 'Floresta da Primavera',
  chao: ['#c6ea9e', '#7cc35a'],
  trilha: '#f6e6bc',
  borda: '#a8874c',
  Cenario: ({ x0, w, h }) => (
    <g>
      {ipe(x0 + w * 0.2, h * 0.3, '#ff8fc8')}
      {ipe(x0 + w * 0.78, h * 0.24, '#ffd84d', 0.9)}
      {ipe(x0 + w * 0.84, h * 0.94, '#ff8fc8', 0.95)}
      {cogumelo(x0 + w * 0.3, h * 0.88)}
      {cogumelo(x0 + w * 0.4, h * 0.92)}
      {passaro(x0 + w * 0.5, h * 0.12, '#4fc3f7')}
      {passaro(x0 + w * 0.12, h * 0.72, '#ff9a4d')}
      {kit.flor(x0 + w * 0.6, h * 0.94, '#ffffff')}
      {kit.flor(x0 + w * 0.66, h * 0.9, '#ffd1e3')}
    </g>
  ),
};
export default floresta;
