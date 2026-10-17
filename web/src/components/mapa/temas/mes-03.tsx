// Março: Jardins Floridos. Canteiros coloridos, borboletas e um arco de flores.
import { kit, type Tema } from '../kit';

const canteiro = (x: number, y: number, cores: string[]) => (
  <g transform={`translate(${x} ${y})`}>
    <rect x="-28" y="-6" width="56" height="12" rx="6" fill="#8a5a2a" />
    {cores.map((c, i) => <g key={i}>{kit.flor(-20 + i * 13, -10, c, '#ffd84d')}</g>)}
  </g>
);
const borboleta = (x: number, y: number, cor: string) => (
  <g transform={`translate(${x} ${y})`}>
    <ellipse cx="-6" cy="-3" rx="6" ry="8" fill={cor} transform="rotate(-20 -6 -3)" />
    <ellipse cx="6" cy="-3" rx="6" ry="8" fill={cor} transform="rotate(20 6 -3)" />
    <ellipse cx="-4" cy="6" rx="4" ry="5" fill={cor} opacity="0.8" />
    <ellipse cx="4" cy="6" rx="4" ry="5" fill={cor} opacity="0.8" />
    <rect x="-1" y="-8" width="2" height="16" rx="1" fill="#4a2a0c" />
  </g>
);
const arco = (x: number, y: number) => (
  <g transform={`translate(${x} ${y})`}>
    <path d="M-30 0 V-30 A30 30 0 0 1 30 -30 V0" fill="none" stroke="#5aa64a" strokeWidth="6" />
    {[-30, -20, -6, 6, 20, 30].map((dx, i) => {
      const yy = Math.abs(dx) === 30 ? -14 - (i % 2) * 14 : -54 + Math.abs(dx) * 0.6;
      return <g key={i}>{kit.flor(dx, yy, ['#ff8fb3', '#fff', '#ffd84d'][i % 3], '#e05d8f')}</g>;
    })}
  </g>
);

const jardins: Tema = {
  mes: 3,
  nome: 'Jardins Floridos',
  chao: ['#d9f5c0', '#a6dc84'],
  trilha: '#fbefd0',
  borda: '#c4a066',
  Cenario: ({ x0, w, h }) => (
    <g>
      {arco(x0 + w * 0.28, h * 0.25)}
      {canteiro(x0 + w * 0.72, h * 0.16, ['#ff6b8a', '#ffd84d', '#b07cff', '#ffffff'])}
      {canteiro(x0 + w * 0.3, h * 0.92, ['#ffffff', '#ff9a4d', '#ff6b8a', '#4fc3f7'])}
      {canteiro(x0 + w * 0.78, h * 0.88, ['#b07cff', '#ffffff', '#ffd84d', '#ff6b8a'])}
      {borboleta(x0 + w * 0.6, h * 0.3, '#ffb347')}
      {borboleta(x0 + w * 0.12, h * 0.7, '#7fb8ff')}
      {borboleta(x0 + w * 0.9, h * 0.62, '#ff8fb3')}
    </g>
  ),
};
export default jardins;
