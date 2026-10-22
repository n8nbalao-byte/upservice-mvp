// Ordem das fotos do login: embaralha as de profissional e as de loja e intercala (profissional, loja, profissional…),
// começando pelo grupo maior, para não ficarem duas iguais seguidas. Sem DOM: testado em test/carrossel.test.js.
export type Foto = { tipo: string };

export function embaralhar<T>(lista: T[], rand: () => number = Math.random): T[] {
  const b = [...lista];
  for (let i = b.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [b[i], b[j]] = [b[j], b[i]];
  }
  return b;
}

export function alternar<T extends Foto>(fotos: T[], rand: () => number = Math.random): T[] {
  const prof = embaralhar(fotos.filter((f) => f.tipo === 'PROFISSIONAL'), rand);
  const loja = embaralhar(fotos.filter((f) => f.tipo !== 'PROFISSIONAL'), rand);
  const [a, b] = prof.length > loja.length || (prof.length === loja.length && rand() < 0.5) ? [prof, loja] : [loja, prof];
  const out: T[] = [];
  for (let i = 0; i < a.length; i++) {
    out.push(a[i]);
    if (b[i]) out.push(b[i]);
  }
  return out;
}
