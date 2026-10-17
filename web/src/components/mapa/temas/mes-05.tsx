// Maio: Vila Antiga. Casinhas com telhado, um poço de pedra e lampiões.
import { kit, type Tema } from '../kit';

const casa = (x: number, y: number, telhado: string, s = 1) => (
  <g transform={`translate(${x} ${y}) scale(${s})`}>
    <ellipse cx="0" cy="2" rx="28" ry="5" fill="rgba(60,40,20,0.18)" />
    <rect x="-22" y="-30" width="44" height="32" fill="#f4e4c4" stroke="#8a6a44" strokeWidth="1.8" />
    <path d="M-28 -28 L0 -52 L28 -28 Z" fill={telhado} stroke="#6a3418" strokeWidth="1.8" strokeLinejoin="round" />
    <rect x="-6" y="-16" width="12" height="18" rx="2" fill="#8a5a2a" />
    <rect x="-18" y="-24" width="9" height="9" fill="#9fd8ff" stroke="#8a6a44" strokeWidth="1.2" />
    <rect x="9" y="-24" width="9" height="9" fill="#9fd8ff" stroke="#8a6a44" strokeWidth="1.2" />
    <rect x="12" y="-50" width="7" height="12" fill="#a87a5a" />
  </g>
);
const poco = (x: number, y: number) => (
  <g transform={`translate(${x} ${y})`}>
    <ellipse cx="0" cy="0" rx="18" ry="6" fill="#9aa7b4" stroke="#5f6f80" strokeWidth="1.5" />
    <rect x="-18" y="-14" width="36" height="14" fill="#b6c0ca" stroke="#5f6f80" strokeWidth="1.5" />
    <ellipse cx="0" cy="-14" rx="18" ry="6" fill="#3a5a7a" stroke="#5f6f80" strokeWidth="1.5" />
    <path d="M-16 -14 V-38 M16 -14 V-38" stroke="#7a4a1c" strokeWidth="3" />
    <path d="M-20 -36 L0 -48 L20 -36 Z" fill="#c8642e" stroke="#6a3418" strokeWidth="1.5" />
  </g>
);
const lampiao = (x: number, y: number) => (
  <g transform={`translate(${x} ${y})`}>
    <rect x="-1.8" y="-40" width="3.6" height="40" fill="#3a3a44" />
    <rect x="-6" y="-50" width="12" height="12" rx="2" fill="#ffe27a" stroke="#3a3a44" strokeWidth="2" />
    <circle cx="0" cy="-44" r="11" fill="rgba(255,226,122,0.35)" />
  </g>
);

const vila: Tema = {
  mes: 5,
  nome: 'Vila Antiga',
  chao: ['#e9e2c8', '#c7c09a'],
  trilha: '#d8cdb0',
  borda: '#8f8466',
  Cenario: ({ x0, w, h }) => (
    <g>
      {casa(x0 + w * 0.22, h * 0.24, '#c8642e')}
      {casa(x0 + w * 0.76, h * 0.2, '#5b8fb4', 0.85)}
      {casa(x0 + w * 0.8, h * 0.94, '#8e5bd8', 0.9)}
      {poco(x0 + w * 0.3, h * 0.92)}
      {lampiao(x0 + w * 0.08, h * 0.66)}
      {lampiao(x0 + w * 0.94, h * 0.62)}
      {kit.arbusto(x0 + w * 0.52, h * 0.95, 0.6, '#6aa84f')}
    </g>
  ),
};
export default vila;
