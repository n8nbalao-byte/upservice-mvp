// Caminho do mapa do ano: 12 bolinhas (meses) num caminho sinuoso que sobe e desce enquanto avança para a direita.
// Funções puras (sem DOM), testadas em test/mapa.test.js. Coordenadas no espaço do SVG (viewBox).

export const MAP_H = 600;
/** Largura do trecho de cada mês: o cenário do mês ocupa [i*SEG, (i+1)*SEG]. */
export const SEG = 150;
export const MAP_W = SEG * 12;

export type Pt = { x: number; y: number };

// Alturas das bolinhas: alternam em cima e embaixo, com pequenas variações para o caminho não parecer repetido.
const Y = [385, 245, 395, 255, 375, 240, 390, 260, 380, 250, 395, 290];

/** Posição de cada mês (0 = janeiro). */
export function monthPoints(): Pt[] {
  return Y.map((y, i) => ({ x: i * SEG + SEG / 2, y }));
}

/** Pontos de controle Catmull-Rom → Bézier cúbica entre p1 e p2. */
function bezier(p0: Pt, p1: Pt, p2: Pt, p3: Pt) {
  const t = 1 / 6;
  const c1 = { x: p1.x + (p2.x - p0.x) * t, y: p1.y + (p2.y - p0.y) * t };
  const c2 = { x: p2.x - (p3.x - p1.x) * t, y: p2.y - (p3.y - p1.y) * t };
  return { c1, c2 };
}

const f = (n: number) => Math.round(n * 10) / 10;

/** Pontos usados no desenho: entrada pela esquerda, os 12 meses e saída pela direita. */
function allPoints(): Pt[] {
  const m = monthPoints();
  return [{ x: 0, y: m[0].y - 60 }, ...m, { x: MAP_W, y: m[11].y - 40 }];
}

/** Trecho do caminho entre o ponto i e o i+1 de allPoints (comando "C" depois de um "M"). */
function piece(pts: Pt[], i: number): string {
  const p0 = pts[Math.max(0, i - 1)];
  const p1 = pts[i];
  const p2 = pts[i + 1];
  const p3 = pts[Math.min(pts.length - 1, i + 2)];
  const { c1, c2 } = bezier(p0, p1, p2, p3);
  return `C ${f(c1.x)} ${f(c1.y)} ${f(c2.x)} ${f(c2.y)} ${f(p2.x)} ${f(p2.y)}`;
}

/** O caminho inteiro (para desenhar a trilha). */
export function pathD(): string {
  const pts = allPoints();
  let d = `M ${pts[0].x} ${pts[0].y}`;
  for (let i = 0; i < pts.length - 1; i++) d += ` ${piece(pts, i)}`;
  return d;
}

/** Só o trecho do mês `from` até o mês `to` (consecutivos), para o personagem andar. */
export function stepD(from: number, to: number): string {
  const pts = allPoints();
  const a = from + 1;
  const b = to + 1;
  if (b !== a + 1) throw new Error('meses consecutivos');
  return `M ${pts[a].x} ${pts[a].y} ${piece(pts, a)}`;
}

/** Ponto de uma Bézier cúbica (para o teste conferir que o caminho fica dentro do cenário). */
export function sample(steps = 24): Pt[] {
  const pts = allPoints();
  const out: Pt[] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(pts.length - 1, i + 2)];
    const { c1, c2 } = bezier(p0, p1, p2, p3);
    for (let s = 0; s <= steps; s++) {
      const t = s / steps, u = 1 - t;
      out.push({
        x: u * u * u * p1.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * p2.x,
        y: u * u * u * p1.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * p2.y,
      });
    }
  }
  return out;
}
