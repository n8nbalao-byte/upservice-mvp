// "Online agora" ou "visto há…", pelo último acesso (o app aberto consulta o servidor a cada 30–60 s).
const ONLINE_MS = 2 * 60e3;

export function presenca(lastSeenAt: string | null | undefined, agora = Date.now()): { online: boolean; texto: string } {
  if (!lastSeenAt) return { online: false, texto: 'Ainda não acessou' };
  const ms = agora - new Date(lastSeenAt).getTime();
  if (ms < ONLINE_MS) return { online: true, texto: 'Online agora' };
  const min = Math.round(ms / 60e3);
  if (min < 60) return { online: false, texto: `Visto há ${min} min` };
  const h = Math.round(min / 60);
  if (h < 24) return { online: false, texto: `Visto há ${h} h` };
  const d = Math.round(h / 24);
  return { online: false, texto: d === 1 ? 'Visto ontem' : `Visto há ${d} dias` };
}
