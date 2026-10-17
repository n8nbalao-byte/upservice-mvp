// Mapa do ano: 12 bolinhas (meses) num caminho sinuoso, cada mês com o seu cenário. O Explorador fica no mês atual
// e, quando o mês vira (desde a última visita neste aparelho), anda do mês anterior até o atual com a câmera
// acompanhando. Tocar numa bolinha abre o calendário daquele mês. Só o mapa rola (na horizontal).
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { monthName, type Month, type StarsData } from '../Estrelas';
import { MAP_H, MAP_W, SEG, monthPoints, pathD, stepD, type Pt } from './caminho';
import { Explorador, type Pose } from './Explorador';
import { temaDo } from './regioes';

const SEEN = 'mapa-mes-visto';
const CURTO = ['JAN', 'FEV', 'MAR', 'ABR', 'MAI', 'JUN', 'JUL', 'AGO', 'SET', 'OUT', 'NOV', 'DEZ'];
const read = () => { try { return localStorage.getItem(SEEN); } catch { return null; } };
const write = (v: string) => { try { localStorage.setItem(SEEN, v); } catch { /* sem armazenamento: só não lembra */ } };
const hex = (c: string) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
const mix = (a: string, b: string) => `#${hex(a).map((v, i) => Math.round((v + hex(b)[i]) / 2).toString(16).padStart(2, '0')).join('')}`;
const mesNome = (m: string) => monthName(m).split(' ')[0];

const STAR = 'M0 -7 L2 -2.3 7 -2 3.2 1.3 4.4 6.4 0 3.7 -4.4 6.4 -3.2 1.3 -7 -2 -2 -2.3Z';

/** Uma bolinha (mês): plataforma redonda, nome curto, estrelas da nota, cadeado no futuro, presente/TV. */
function Bolinha({ m, i, p, estado, onOpen }: { m: Month; i: number; p: Pt; estado: 'passado' | 'atual' | 'futuro'; onOpen: () => void }) {
  const cor = { passado: ['#8fdc78', '#4e9e3c'], atual: ['#ffd447', '#d48f00'], futuro: ['#c7b6e6', '#8d79b6'] }[estado];
  const nota = m.rating;
  const texto = `${mesNome(m.month)}: ${estado === 'atual' ? 'mês atual' : estado === 'futuro' ? 'ainda não chegou' : 'concluído'}${nota != null ? `, nota ${nota} de 3 estrelas` : ''}${m.hasBonus ? ', com bônus' : ''}${m.hasDraw ? ', dia do sorteio' : ''}. Abrir o calendário`;
  const key = (e: KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(); } };
  return (
    <g className={`g-mapa-mes ${estado}`} transform={`translate(${p.x} ${p.y})`} role="button" tabIndex={0} aria-label={texto} data-mes={m.month} onClick={(e) => { e.stopPropagation(); onOpen(); }} onKeyDown={key}>
      {/* Área de toque maior que o brilho e o presente animados (a bolinha fica "parada" para o toque). */}
      <circle r="58" fill="transparent" />
      {estado === 'atual' && <ellipse className="g-mapa-brilho" cx="0" cy="2" rx="44" ry="18" fill="rgba(255,230,120,0.55)" />}
      <ellipse cx="0" cy="12" rx="36" ry="11" fill="rgba(40,25,5,0.22)" />
      <ellipse cx="0" cy="7" rx="31" ry="12.5" fill={cor[1]} />
      <rect x="-31" y="0" width="62" height="7" fill={cor[1]} />
      <ellipse cx="0" cy="0" rx="31" ry="12.5" fill={cor[0]} stroke="rgba(255,255,255,0.6)" strokeWidth="2" />
      <text x="0" y="4.5" textAnchor="middle" className="g-mapa-rotulo">{CURTO[i]}</text>
      {estado === 'futuro' ? (
        <g transform="translate(0 -26)">
          <circle r="11" fill="#fff8e8" stroke="#8d79b6" strokeWidth="2" />
          <path d="M-4.5 -1 v-2.5 a4.5 4.5 0 0 1 9 0 v2.5 M-6 -1 h12 v8 h-12z" fill="none" stroke="#5a4a80" strokeWidth="2" strokeLinejoin="round" />
        </g>
      ) : nota != null && (
        <g transform="translate(0 -28)">
          {[-17, 0, 17].map((dx, k) => <path key={k} d={STAR} transform={`translate(${dx} ${k === 1 ? -5 : 0}) scale(1.35)`} className={k < nota ? 'on' : 'off'} />)}
        </g>
      )}
      {m.hasBonus && (
        <g transform="translate(40 -10)"><g className="g-mapa-presente">
          <rect x="-11" y="-8" width="22" height="18" rx="3" fill="#8e5bd8" stroke="#5b2fa3" strokeWidth="1.5" />
          <rect x="-13" y="-12" width="26" height="6" rx="2" fill="#a774ee" stroke="#5b2fa3" strokeWidth="1.5" />
          <rect x="-2.5" y="-12" width="5" height="22" fill="#ffd84d" />
          <path d="M0 -12 q-9 -9 -10 -2 q4 3 10 2 q9 -9 10 -2 q-4 3 -10 2z" fill="#ffd84d" stroke="#c48a00" strokeWidth="1" />
        </g></g>
      )}
      {m.hasDraw && (
        <g transform="translate(-42 -12)" className="g-mapa-tv">
          <rect x="-15" y="-11" width="30" height="21" rx="4" fill="#2b2f45" stroke="#e05d8f" strokeWidth="2.5" />
          <rect x="-11" y="-7" width="22" height="13" rx="2" fill="#7fd6ff" />
          <path d="M-6 -11 l6 -6 6 6" fill="none" stroke="#e05d8f" strokeWidth="2" />
        </g>
      )}
    </g>
  );
}

export function MapaAno({ data, onOpen }: { data: StarsData; onOpen: (month: string) => void }) {
  const box = useRef<HTMLDivElement>(null);
  const step = useRef<SVGPathElement>(null);
  const skip = useRef<(() => void) | null>(null);
  const started = useRef(false);
  const pts = monthPoints();
  const cur = Math.max(0, data.months.findIndex((m) => m.month === data.current));
  const [h, setH] = useState(0);
  const [pos, setPos] = useState<Pt>(pts[cur]);
  const [pose, setPose] = useState<Pose>('parado');
  const [titulo, setTitulo] = useState<string | null>(null);
  const scale = h / MAP_H;

  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setH(el.clientHeight));
    ro.observe(el);
    setH(el.clientHeight);
    return () => ro.disconnect();
  }, []);
  const camera = (x: number) => { const el = box.current; if (el) el.scrollLeft = x * (el.clientHeight / MAP_H) - el.clientWidth / 2; };

  // Câmera no mês atual; se o mês virou desde a última visita, o Explorador anda do mês anterior até ele (uma vez).
  useEffect(() => {
    if (!h || started.current) return;
    started.current = true;
    const visto = read();
    write(data.current);
    const nome = `${mesNome(data.current)} · ${temaDo(cur + 1).nome}`;
    const fimTitulo = () => setTimeout(() => { setTitulo(null); setPose('parado'); }, 2200);
    camera(pts[cur].x);
    if (!visto || visto >= data.current) return;
    const reduzido = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const path = step.current;
    if (reduzido || cur === 0 || !path) { setTitulo(nome); fimTitulo(); return; }
    const L = path.getTotalLength();
    const t0 = performance.now();
    const dur = 2000;
    let raf = 0;
    let acabou = false;
    const chegar = () => {
      if (acabou) return;
      acabou = true;
      cancelAnimationFrame(raf);
      skip.current = null;
      setPos(pts[cur]);
      camera(pts[cur].x);
      setPose('comemorando');
      setTitulo(nome);
      fimTitulo();
    };
    skip.current = chegar;
    setPos(pts[cur - 1]);
    camera(pts[cur - 1].x);
    setPose('andando');
    const tick = (now: number) => {
      const t = Math.min(1, (now - t0) / dur);
      const e = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
      const p = path.getPointAtLength(L * e);
      setPos({ x: p.x, y: p.y });
      camera(p.x);
      if (t < 1) raf = requestAnimationFrame(tick);
      else chegar();
    };
    raf = requestAnimationFrame(tick);
  }, [h]);

  const abrir = (m: string) => { if (skip.current) skip.current(); else onOpen(m); };
  const temas = data.months.map((_, i) => temaDo(i + 1));
  const d = pathD();

  return (
    <div className="g-mapa-wrap">
    <div className="g-mapa" ref={box} onClick={() => skip.current?.()}>
      {h > 0 && (
        <svg className="g-mapa-svg" width={MAP_W * scale} height={h} viewBox={`0 0 ${MAP_W} ${MAP_H}`} role="group" aria-label={`Mapa do ano ${data.year}: um mês por fase`}>
          <defs>
            {temas.map((t, i) => (
              <linearGradient key={i} id={`gm-chao-${i}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={t.chao[0]} /><stop offset="1" stopColor={t.chao[1]} /></linearGradient>
            ))}
            {temas.slice(1).map((t, i) => (
              <linearGradient key={i} id={`gm-emenda-${i + 1}`} x1="0" y1="0" x2="1" y2="0">
                <stop offset="0" stopColor={mix(temas[i].chao[0], temas[i].chao[1])} stopOpacity="0" />
                <stop offset="0.5" stopColor={mix(mix(temas[i].chao[0], temas[i].chao[1]), mix(t.chao[0], t.chao[1]))} stopOpacity="0.8" />
                <stop offset="1" stopColor={mix(t.chao[0], t.chao[1])} stopOpacity="0" />
              </linearGradient>
            ))}
            {temas.map((_, i) => <clipPath key={i} id={`gm-trecho-${i}`}><rect x={i * SEG} y="0" width={SEG + 0.5} height={MAP_H} /></clipPath>)}
          </defs>
          {temas.map((t, i) => <rect key={i} x={i * SEG} y="0" width={SEG + 1} height={MAP_H} fill={`url(#gm-chao-${i})`} />)}
          {temas.map((t, i) => <g key={i} className="g-mapa-cena" data-tema={t.nome} data-mes-n={i + 1}>{t.Cenario({ x0: i * SEG, w: SEG, h: MAP_H })}</g>)}
          {temas.slice(1).map((_, i) => <rect key={i} x={(i + 1) * SEG - 24} y="0" width="48" height={MAP_H} fill={`url(#gm-emenda-${i + 1})`} />)}
          {temas.map((t, i) => (
            <g key={i} clipPath={`url(#gm-trecho-${i})`}>
              <path d={d} fill="none" stroke={t.borda} strokeWidth="40" strokeLinecap="round" />
              <path d={d} fill="none" stroke={t.trilha} strokeWidth="30" strokeLinecap="round" />
              <path d={d} fill="none" stroke={t.borda} strokeWidth="3" strokeDasharray="2 12" strokeLinecap="round" opacity="0.6" />
            </g>
          ))}
          {cur > 0 && <path ref={step} d={stepD(cur - 1, cur)} fill="none" stroke="none" />}
          {data.months.map((m, i) => <Bolinha key={m.month} m={m} i={i} p={pts[i]} estado={i < cur ? 'passado' : i === cur ? 'atual' : 'futuro'} onOpen={() => abrir(m.month)} />)}
          {/* Ao lado da bolinha, para não cobrir o nome nem as estrelas. */}
          <Explorador x={pos.x - 34} y={pos.y + 4} pose={pose} />
        </svg>
      )}
    </div>
      {titulo && <div className="g-mapa-titulo" role="status" onClick={() => skip.current?.()}><span>{titulo}</span></div>}
    </div>
  );
}
