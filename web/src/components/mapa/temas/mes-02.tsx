// Fevereiro: Carnaval. Confete, serpentinas, máscaras e um trio colorido.
import { type Tema } from '../kit';

const CORES = ['#ff5a8a', '#ffd84d', '#4fc3f7', '#7ed26b', '#b07cff', '#ff9a4d'];
const confete = (x0: number, w: number, h: number) =>
  Array.from({ length: 26 }, (_, i) => {
    const kx = ((i * 37) % 100) / 100;
    const ky = i % 2 ? 0.04 + ((i * 13) % 20) / 100 : 0.78 + ((i * 7) % 20) / 100;
    return <rect key={i} x={x0 + w * kx} y={h * ky} width="5" height="8" rx="1.5" fill={CORES[i % CORES.length]} transform={`rotate(${(i * 47) % 360} ${x0 + w * kx} ${h * ky})`} />;
  });
const serpentina = (x: number, y: number, cor: string) => <path d={`M${x} ${y} q10 -12 20 0 t20 0 t20 0`} fill="none" stroke={cor} strokeWidth="3.5" strokeLinecap="round" />;
const mascara = (x: number, y: number) => (
  <g transform={`translate(${x} ${y})`}>
    <path d="M-24 -4 Q-24 -16 -10 -14 L0 -10 L10 -14 Q24 -16 24 -4 Q22 8 8 6 L0 2 L-8 6 Q-22 8 -24 -4Z" fill="#b07cff" stroke="#5b2fa3" strokeWidth="2" />
    <ellipse cx="-11" cy="-5" rx="6" ry="4" fill="#2b1a4a" /><ellipse cx="11" cy="-5" rx="6" ry="4" fill="#2b1a4a" />
    <path d="M20 -14 Q30 -34 22 -44 M24 -14 Q38 -30 36 -42" fill="none" stroke="#ff5a8a" strokeWidth="3" strokeLinecap="round" />
    {[-14, -6, 2, 10].map((dx) => <circle key={dx} cx={dx} cy="-13" r="1.6" fill="#ffd84d" />)}
  </g>
);
const trio = (x: number, y: number) => (
  <g transform={`translate(${x} ${y})`}>
    <ellipse cx="0" cy="6" rx="36" ry="6" fill="rgba(60,20,60,0.18)" />
    <rect x="-34" y="-26" width="68" height="28" rx="6" fill="#ff5a8a" stroke="#a3214f" strokeWidth="2" />
    <rect x="-28" y="-40" width="56" height="16" rx="4" fill="#ffd84d" stroke="#b08400" strokeWidth="2" />
    {[-22, 0, 22].map((dx) => <circle key={dx} cx={dx} cy="-12" r="6" fill="#2b1a4a" stroke="#fff" strokeWidth="2" />)}
    <circle cx="-20" cy="4" r="7" fill="#333" /><circle cx="20" cy="4" r="7" fill="#333" />
    <path d="M-10 -48 l4 -10 M2 -50 l2 -10 M12 -48 l-2 -10" stroke="#4fc3f7" strokeWidth="3" strokeLinecap="round" />
  </g>
);

const carnaval: Tema = {
  mes: 2,
  nome: 'Carnaval',
  chao: ['#ffe2f0', '#ffc2dd'],
  trilha: '#fff6e8',
  borda: '#e57aa8',
  Cenario: ({ x0, w, h }) => (
    <g>
      {confete(x0, w, h)}
      {serpentina(x0 + w * 0.05, h * 0.14, '#4fc3f7')}
      {serpentina(x0 + w * 0.45, h * 0.9, '#7ed26b')}
      {mascara(x0 + w * 0.75, h * 0.18)}
      {trio(x0 + w * 0.3, h * 0.88)}
    </g>
  ),
};
export default carnaval;
