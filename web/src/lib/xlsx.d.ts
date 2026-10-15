export type Cell = string | number;
export type EscalaItem = { filial: string; name: string; date: string; positions: number };
export type Escala = { month: number | null; year: number | null; items: EscalaItem[]; stores: { filial: string; name: string }[]; from: string; to: string };
export function readXlsx(buf: ArrayBuffer): Promise<Cell[][]>;
export function parseEscala(rows: Cell[][], opts?: { year?: number }): Escala;
