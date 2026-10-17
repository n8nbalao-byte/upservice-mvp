// Mapa do ano sobre o panorama da UP Service (imagem com o caminho e os 12 pontos). Cada ponto é um mês: a bolinha
// fica em cima do ponto da imagem. O personagem escolhido fica no mês atual e, quando o mês vira (desde a última
// visita neste aparelho), anda do ponto anterior até o atual com a câmera acompanhando. Tocar num mês abre o
// calendário daquele mês. Só o mapa rola (na horizontal).
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { monthName, type Month, type StarsData } from '../Estrelas';
import { MAPA, MAPA_PROPORCAO, PONTOS, imagemPersonagem } from './jogo';

const SEEN = 'mapa-mes-visto';
const CURTO = ['JAN', 'FEV', 'MAR', 'ABR', 'MAI', 'JUN', 'JUL', 'AGO', 'SET', 'OUT', 'NOV', 'DEZ'];
const read = () => { try { return localStorage.getItem(SEEN); } catch { return null; } };
const write = (v: string) => { try { localStorage.setItem(SEEN, v); } catch { /* sem armazenamento: só não lembra */ } };
const mesNome = (m: string) => monthName(m).split(' ')[0];
const STAR = 'M0 -7 L2 -2.3 7 -2 3.2 1.3 4.4 6.4 0 3.7 -4.4 6.4 -3.2 1.3 -7 -2 -2 -2.3Z';
type Pt = { x: number; y: number };

/** Marcador do mês em cima do ponto da imagem: nome curto, estrelas da nota, cadeado no futuro, presente/TV. */
function Bolinha({ m, i, estado, onOpen }: { m: Month; i: number; estado: 'passado' | 'atual' | 'futuro'; onOpen: () => void }) {
  const nota = m.rating;
  const texto = `${mesNome(m.month)}: ${estado === 'atual' ? 'mês atual' : estado === 'futuro' ? 'ainda não chegou' : 'concluído'}${nota != null ? `, nota ${nota} de 3 estrelas` : ''}${m.hasBonus ? ', com bônus' : ''}${m.hasDraw ? ', dia do sorteio' : ''}. Abrir o calendário`;
  return (
    <button type="button" className={`g-mapa-mes ${estado}`} style={{ left: `${PONTOS[i].x}%`, top: `${PONTOS[i].y}%` }} aria-label={texto} data-mes={m.month} onClick={(e) => { e.stopPropagation(); onOpen(); }}>
      <svg viewBox="-50 -50 100 100" aria-hidden="true">
        {estado === 'atual' && <ellipse className="g-mapa-brilho" cx="0" cy="6" rx="44" ry="20" />}
        <rect className="g-mapa-placa" x="-26" y="-6" width="52" height="24" rx="12" />
        <text x="0" y="11" textAnchor="middle" className="g-mapa-rotulo">{CURTO[i]}</text>
        {estado === 'futuro' ? (
          <g transform="translate(0 -22)">
            <circle r="12" className="g-mapa-cadeado" />
            <path d="M-4.5 -1 v-2.5 a4.5 4.5 0 0 1 9 0 v2.5 M-6 -1 h12 v8 h-12z" fill="none" stroke="#4a3a70" strokeWidth="2" strokeLinejoin="round" />
          </g>
        ) : nota != null && (
          <g transform="translate(0 -22)">
            {[-18, 0, 18].map((dx, k) => <path key={k} d={STAR} transform={`translate(${dx} ${k === 1 ? -5 : 0}) scale(1.45)`} className={k < nota ? 'on' : 'off'} />)}
          </g>
        )}
        {m.hasBonus && (
          <g transform="translate(34 -4)"><g className="g-mapa-presente">
            <rect x="-10" y="-7" width="20" height="16" rx="3" fill="#8e5bd8" stroke="#3d1d73" strokeWidth="1.5" />
            <rect x="-12" y="-11" width="24" height="6" rx="2" fill="#a774ee" stroke="#3d1d73" strokeWidth="1.5" />
            <rect x="-2.2" y="-11" width="4.4" height="20" fill="#ffd84d" />
          </g></g>
        )}
        {m.hasDraw && (
          <g transform="translate(-36 -6)" className="g-mapa-tv">
            <rect x="-13" y="-10" width="26" height="19" rx="4" fill="#2b2f45" stroke="#e05d8f" strokeWidth="2.5" />
            <rect x="-9" y="-6" width="18" height="11" rx="2" fill="#7fd6ff" />
          </g>
        )}
      </svg>
    </button>
  );
}

export function MapaAno({ data, onOpen, personagem }: { data: StarsData; onOpen: (month: string) => void; personagem?: string }) {
  const box = useRef<HTMLDivElement>(null);
  const skip = useRef<(() => void) | null>(null);
  const started = useRef(false);
  const cur = Math.max(0, data.months.findIndex((m) => m.month === data.current));
  const [h, setH] = useState(0);
  const [pos, setPos] = useState<Pt>(PONTOS[cur]);
  const [pose, setPose] = useState<'parado' | 'andando' | 'comemorando'>('parado');
  const [titulo, setTitulo] = useState<string | null>(null);
  const [carregou, setCarregou] = useState(false);
  const largura = Math.round(h * MAPA_PROPORCAO);

  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setH(el.clientHeight));
    ro.observe(el);
    setH(el.clientHeight);
    return () => ro.disconnect();
  }, []);
  /** Câmera: centraliza o ponto (x em % da largura do panorama). */
  const camera = (xPct: number) => { const el = box.current; if (el) el.scrollLeft = (xPct / 100) * el.clientHeight * MAPA_PROPORCAO - el.clientWidth / 2; };

  useEffect(() => {
    if (!h || started.current) return;
    started.current = true;
    const visto = read();
    write(data.current);
    const nome = mesNome(data.current);
    const fimTitulo = () => setTimeout(() => { setTitulo(null); setPose('parado'); }, 2200);
    camera(PONTOS[cur].x);
    if (!visto || visto >= data.current) return;
    const reduzido = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduzido || cur === 0) { setTitulo(nome); fimTitulo(); return; }
    const a = PONTOS[cur - 1];
    const b = PONTOS[cur];
    const t0 = performance.now();
    const dur = 2000;
    let raf = 0;
    let acabou = false;
    const chegar = () => {
      if (acabou) return;
      acabou = true;
      cancelAnimationFrame(raf);
      skip.current = null;
      setPos(b);
      camera(b.x);
      setPose('comemorando');
      setTitulo(nome);
      fimTitulo();
    };
    skip.current = chegar;
    setPos(a);
    camera(a.x);
    setPose('andando');
    // Caminhada em linha suave entre os dois pontos, com um arco leve para cima.
    const tick = (now: number) => {
      const t = Math.min(1, (now - t0) / dur);
      const e = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
      const p = { x: a.x + (b.x - a.x) * e, y: a.y + (b.y - a.y) * e - Math.sin(Math.PI * e) * 4 };
      setPos(p);
      camera(p.x);
      if (t < 1) raf = requestAnimationFrame(tick);
      else chegar();
    };
    raf = requestAnimationFrame(tick);
  }, [h]);

  const abrir = (m: string) => { if (skip.current) skip.current(); else onOpen(m); };

  return (
    <div className="g-mapa-wrap">
      <div className="g-mapa" ref={box} onClick={() => skip.current?.()}>
        {h > 0 && (
          <div className={`g-mapa-palco${carregou ? ' pronto' : ''}`} style={{ width: largura, height: h }} role="group" aria-label={`Mapa do ano ${data.year}: um mês por ponto do caminho`}>
            <img className="g-mapa-fundo" src={MAPA.src} srcSet={`${MAPA.srcPequeno} 1600w, ${MAPA.src} 2688w`} sizes={`${largura}px`} alt="" onLoad={() => setCarregou(true)} draggable={false} />
            {data.months.map((m, i) => <Bolinha key={m.month} m={m} i={i} estado={i < cur ? 'passado' : i === cur ? 'atual' : 'futuro'} onOpen={() => abrir(m.month)} />)}
            <div className={`g-personagem ${pose}`} style={{ left: `${pos.x}%`, top: `${pos.y}%` }} aria-hidden="true">
              <img src={imagemPersonagem(personagem ?? '')} alt="" draggable={false} />
              {pose === 'comemorando' && <span className="g-personagem-brilhos">✦ ✦ ✦</span>}
            </div>
          </div>
        )}
      </div>
      {titulo && <div className="g-mapa-titulo" role="status" onClick={() => skip.current?.()}><span>{titulo}</span></div>}
    </div>
  );
}
