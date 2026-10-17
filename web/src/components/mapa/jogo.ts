// Dados do mapa do ano: o panorama (imagem da UP Service, com o caminho e os 12 pontos), a posição de cada mês
// nele, os fundos dos meses e os personagens. Sem DOM: testado em test/mapa.test.js.

/** Muda quando as imagens forem trocadas, para o navegador não usar a versão antiga do cache. */
const V = '1';
const img = (p: string) => `/estrelas/${p}?v=${V}`;

/** Panorama: 2688 × 1152 (proporção usada para a largura do mapa). */
export const MAPA = { src: img('mapa.webp'), srcPequeno: img('mapa-1600.webp'), largura: 2688, altura: 1152 };
export const MAPA_PROPORCAO = MAPA.largura / MAPA.altura;

/** Ponto de cada mês no panorama, em % da largura e da altura, na ordem do caminho (janeiro = 0). */
export const PONTOS: { x: number; y: number }[] = [
  { x: 7.0, y: 23.9 }, { x: 6.1, y: 40.8 }, { x: 22.9, y: 44.9 }, { x: 33.1, y: 57.5 },
  { x: 43.1, y: 74.1 }, { x: 52.8, y: 58.9 }, { x: 50.2, y: 30.9 }, { x: 64.5, y: 45.5 },
  { x: 74.8, y: 30.9 }, { x: 78.9, y: 58.9 }, { x: 92.0, y: 43.4 }, { x: 94.9, y: 21.2 },
];

/** Fundo do calendário de cada mês (1 a 12). */
export const fundoDoMes = (mes: number) => img(`mes-${String(mes).padStart(2, '0')}.webp`);

export const PERSONAGENS = [
  { id: 'guerreiro', nome: 'Guerreiro' },
  { id: 'mago', nome: 'Mago' },
  { id: 'arqueira', nome: 'Arqueira' },
  { id: 'inventora', nome: 'Inventora' },
  { id: 'dragao', nome: 'Dragão' },
] as const;
export type PersonagemId = (typeof PERSONAGENS)[number]['id'];
export const imagemPersonagem = (id: string) => img(`personagens/${PERSONAGENS.some((p) => p.id === id) ? id : PERSONAGENS[0].id}.webp`);
