// Kit de desenho dos cenários do mapa: tipos e pequenos elementos em SVG reaproveitados pelos temas de cada mês.
import type { ReactElement } from 'react';

export type Cena = { x0: number; w: number; h: number };
export type Tema = {
  mes: number; // 1 a 12
  nome: string; // ex.: "Praia"
  /** Cores do chão (de cima para baixo), da trilha e da borda da trilha. */
  chao: [string, string];
  trilha: string;
  borda: string;
  /** Desenho do trecho do mês: ocupa [x0, x0 + w] × [0, h]. */
  Cenario: (c: Cena) => ReactElement;
};

/** Pequenos elementos reaproveitáveis pelos temas. */
export const kit = {
  pedra: (x: number, y: number, s = 1, cor = '#b89a76') => (
    <g transform={`translate(${x} ${y}) scale(${s})`}>
      <ellipse cx="0" cy="8" rx="20" ry="5" fill="rgba(0,0,0,0.12)" />
      <path d="M-18 6 Q-16 -10 -2 -12 Q14 -12 18 4 Q10 9 -18 6Z" fill={cor} stroke="rgba(60,40,20,0.35)" strokeWidth="1.5" />
      <path d="M-8 -6 Q0 -9 8 -5" fill="none" stroke="rgba(255,255,255,0.45)" strokeWidth="2" strokeLinecap="round" />
    </g>
  ),
  arbusto: (x: number, y: number, s = 1, cor = '#5fae4a') => (
    <g transform={`translate(${x} ${y}) scale(${s})`}>
      <ellipse cx="0" cy="10" rx="26" ry="6" fill="rgba(0,0,0,0.12)" />
      <circle cx="-12" cy="0" r="13" fill={cor} />
      <circle cx="10" cy="-2" r="15" fill={cor} />
      <circle cx="0" cy="-12" r="13" fill={cor} />
      <circle cx="-4" cy="-16" r="5" fill="rgba(255,255,255,0.25)" />
    </g>
  ),
  flor: (x: number, y: number, cor = '#ffffff', miolo = '#ffc93c') => (
    <g transform={`translate(${x} ${y})`}>
      {[0, 72, 144, 216, 288].map((a) => <ellipse key={a} cx="0" cy="-5" rx="3" ry="5" fill={cor} transform={`rotate(${a})`} />)}
      <circle r="2.6" fill={miolo} />
    </g>
  ),
  nuvem: (x: number, y: number, s = 1) => (
    <g transform={`translate(${x} ${y}) scale(${s})`} opacity="0.9">
      <circle cx="-16" cy="2" r="12" fill="#fff" />
      <circle cx="2" cy="-6" r="16" fill="#fff" />
      <circle cx="20" cy="2" r="11" fill="#fff" />
      <rect x="-28" y="2" width="58" height="12" rx="6" fill="#fff" />
    </g>
  ),
};
