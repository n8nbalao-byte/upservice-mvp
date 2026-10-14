export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export async function api<T = any>(path: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method: opts.method ?? (opts.body === undefined ? 'GET' : 'POST'),
    headers: opts.body === undefined ? {} : { 'Content-Type': 'application/json' },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  const data = res.headers.get('content-type')?.includes('json') ? await res.json() : null;
  if (!res.ok) throw new ApiError(res.status, data?.error ?? 'Erro inesperado. Tente novamente.');
  return data as T;
}

export type Role = 'PROFISSIONAL' | 'GESTOR' | 'ADMINISTRADOR';
export type Doc = { id: string; type: 'CPF' | 'RG' | 'COMPROVANTE'; status: string; rejection_reason: string | null };
export type Me = {
  user: { id: string; name: string; email: string; role: Role; status: string };
  profile: Record<string, any> | null;
  documents: Doc[];
  complete: boolean;
};
export type Unit = { id: string; code: string; name: string; region: string | null; address: string; cep: string | null; street: string | null; number: string | null; district: string | null; city: string | null; uf: string | null; lat: number; lng: number; radius_m: number; max_accuracy_m: number; status: string; status_reason: string | null };

const TZ = 'America/Sao_Paulo';
export const fmtDateTime = (s: string) => new Date(s).toLocaleString('pt-BR', { timeZone: TZ, dateStyle: 'short', timeStyle: 'short' });
export const fmtTime = (s: string) => new Date(s).toLocaleTimeString('pt-BR', { timeZone: TZ, hour: '2-digit', minute: '2-digit' });
export const fmtMoney = (n: number) => Number(n).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
export const fmtMinutes = (m: number) => `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}`;
export const todayBR = () => new Date().toLocaleDateString('sv-SE', { timeZone: TZ });
/** ISO → valor de <input type="datetime-local"> no fuso do aparelho. */
export const toLocalInput = (iso: string) => {
  const d = new Date(iso);
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
};

export const LABEL: Record<string, string> = {
  PENDENTE: 'Pendente', APROVADA: 'Aprovada', RECUSADA: 'Recusada', CANCELADA: 'Cancelada',
  RASCUNHO: 'Rascunho', ABERTA: 'Aberta', ENCERRADA: 'Encerrada',
  AGUARDANDO_CHECKIN: 'Aguardando check-in', EM_ATIVIDADE: 'Em atividade', EM_PAUSA: 'Em pausa',
  PAUSA_EXCEDIDA: 'Pausa excedida', FINALIZADA: 'Finalizada', CANCELADA_ADMINISTRATIVAMENTE: 'Cancelada pelo gestor',
  CHECK_IN: 'Check-in', PAUSE_START: 'Início da pausa', PAUSE_END: 'Retorno da pausa', CHECK_OUT: 'Checkout',
  CONCLUIDA: 'Concluída', NAO_COMPARECEU: 'Não compareceu', APROVADO: 'Aprovado', REJEITADO: 'Rejeitado',
  ATIVA: 'Ativa', BLOQUEADA_FINANCEIRA: 'Bloqueada (financeiro)', INATIVA: 'Inativa',
  ATIVO: 'Ativo', EM_ANALISE: 'Em análise', BLOQUEADO_TEMPORARIAMENTE: 'Bloqueado temporariamente',
  BLOQUEADO_PERMANENTEMENTE: 'Bloqueado permanentemente', INATIVO: 'Inativo',
  PROFISSIONAL: 'Profissional', GESTOR: 'Gestor', ADMINISTRADOR: 'Administrador',
  PENDENTE_DE_EXCECAO: 'Aguardando exceção', PENDENTE_DE_FECHAMENTO: 'Checkout pendente',
  GPS_VALIDADO: 'GPS validado', EXCECAO_APROVADA: 'Exceção aprovada', FECHAMENTO_ADMINISTRATIVO: 'Fechamento administrativo',
  GPS_INDISPONIVEL: 'GPS indisponível', PRECISAO_INSUFICIENTE: 'Precisão insuficiente', PERMISSAO_NEGADA: 'Permissão negada',
  FORA_DO_RAIO: 'Fora do raio', FORA_DO_HORARIO: 'Fora do horário', OUTRO: 'Outro',
  INFORMADO_PROFISSIONAL: 'Horário informado pelo profissional', PREVISTO: 'Horário previsto da vaga', CONFIRMADO_GESTOR: 'Horário confirmado pelo gestor',
};
export const label = (s: string | null | undefined) => (s ? LABEL[s] ?? s : '—');
