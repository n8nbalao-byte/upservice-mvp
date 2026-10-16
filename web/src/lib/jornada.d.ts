export type JornadaSession = { status: string; starts_at: string; ends_at: string; break_count: number; break_minutes: number; breaks_used: number; break_ends_at: string | null };
export type JornadaEvent = { type: string; occurred_at: string };
export type Jornada = {
  phase: 'antes' | 'trabalhando' | 'pausa' | 'pendente' | 'fim';
  clock: { label: string; ms: number } | null;
  total: number;
  part: { label: string; pct: number; msLeft: number; ready: boolean } | null;
};
export function suggestedBreakAt(s: JornadaSession, k: number): number;
export function jornadaStatus(s: JornadaSession, events: JornadaEvent[], now: number): Jornada;
export function hms(ms: number): string;
export function minutesLeft(ms: number): string;
