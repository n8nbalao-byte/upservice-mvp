// Dezembro: Natal e a grande conquista. Neve, pinheiros com luzes, presentes e o castelo dourado do fim do ano.
import { type Tema } from '../kit';

const pinheiro = (x: number, y: number, s = 1) => (
  <g transform={`translate(${x} ${y}) scale(${s})`}>
    <ellipse cx="0" cy="2" rx="20" ry="5" fill="rgba(40,60,90,0.18)" />
    <rect x="-4" y="-12" width="8" height="12" fill="#7a4a1c" />
    <path d="M0 -70 L18 -40 H10 L24 -14 H-24 L-10 -40 H-18 Z" fill="#2f8a4d" stroke="#1d5e33" strokeWidth="1.5" strokeLinejoin="round" />
    <path d="M0 -76 l2.4 5 5.4 .6 -4 3.6 1.2 5.4 -5 -2.8 -5 2.8 1.2 -5.4 -4 -3.6 5.4 -.6z" fill="#ffd84d" />
    {[[-8, -48, '#ff5a5a'], [7, -36, '#ffd84d'], [-12, -24, '#7fd6ff'], [12, -20, '#ff5a5a'], [0, -56, '#7fd6ff']].map(([cx, cy, c], i) => <circle key={i} cx={cx as number} cy={cy as number} r="2.6" fill={c as string} />)}
  </g>
);
const presente = (x: number, y: number, cor: string) => (
  <g transform={`translate(${x} ${y})`}>
    <rect x="-9" y="-14" width="18" height="14" rx="2" fill={cor} stroke="rgba(0,0,0,0.25)" strokeWidth="1" />
    <rect x="-1.8" y="-14" width="3.6" height="14" fill="#ffd84d" />
    <path d="M0 -14 q-7 -7 -8 -1 q3 2 8 1 q7 -7 8 -1 q-3 2 -8 1z" fill="#ffd84d" />
  </g>
);
const castelo = (x: number, y: number) => (
  <g transform={`translate(${x} ${y})`}>
    <ellipse cx="0" cy="4" rx="46" ry="8" fill="rgba(40,60,90,0.18)" />
    <rect x="-34" y="-40" width="68" height="42" fill="#f2c24a" stroke="#a87400" strokeWidth="2" />
    {[-34, -10, 14].map((tx) => <rect key={tx} x={tx} y="-48" width="20" height="10" fill="#f2c24a" stroke="#a87400" strokeWidth="2" />)}
    <rect x="-46" y="-62" width="18" height="64" fill="#ffd45c" stroke="#a87400" strokeWidth="2" />
    <rect x="28" y="-62" width="18" height="64" fill="#ffd45c" stroke="#a87400" strokeWidth="2" />
    <path d="M-48 -62 L-37 -80 L-26 -62Z M26 -62 L37 -80 L48 -62Z" fill="#e05d5d" stroke="#8a2a2a" strokeWidth="1.5" />
    <path d="M-10 2 V-18 a10 10 0 0 1 20 0 V2Z" fill="#7a4a1c" />
    <path d="M37 -80 V-94 l12 4 -12 4" fill="#e05d8f" stroke="#7a4a1c" strokeWidth="1.5" />
    <circle cx="-37" cy="-40" r="4" fill="#7fd6ff" stroke="#a87400" strokeWidth="1.5" />
    <circle cx="37" cy="-40" r="4" fill="#7fd6ff" stroke="#a87400" strokeWidth="1.5" />
  </g>
);
const flocos = (x0: number, w: number, h: number) =>
  [[0.1, 0.05], [0.3, 0.12], [0.55, 0.04], [0.8, 0.1], [0.65, 0.6], [0.15, 0.68], [0.45, 0.95], [0.9, 0.55]].map(([kx, ky], i) => (
    <g key={i} transform={`translate(${x0 + w * kx} ${h * ky})`} stroke="#ffffff" strokeWidth="1.6" strokeLinecap="round" opacity="0.9">
      <path d="M-4 0 H4 M0 -4 V4 M-3 -3 L3 3 M-3 3 L3 -3" />
    </g>
  ));

const natal: Tema = {
  mes: 12,
  nome: 'Grande Conquista',
  chao: ['#eef6ff', '#cfe1f2'],
  trilha: '#fff8e6',
  borda: '#b9c9da',
  Cenario: ({ x0, w, h }) => (
    <g>
      {flocos(x0, w, h)}
      {castelo(x0 + w * 0.62, h * 0.2)}
      {pinheiro(x0 + w * 0.14, h * 0.26, 0.9)}
      {pinheiro(x0 + w * 0.86, h * 0.86, 1)}
      {pinheiro(x0 + w * 0.22, h * 0.94, 0.75)}
      {presente(x0 + w * 0.36, h * 0.9, '#e05d5d')}
      {presente(x0 + w * 0.5, h * 0.93, '#5b8fe0')}
      {presente(x0 + w * 0.62, h * 0.88, '#8e5bd8')}
    </g>
  ),
};
export default natal;
