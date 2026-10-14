// Componentes de interface compartilhados: cabeçalho, indicadores, status, estados, diálogos e toasts.
import { createContext, useContext, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { label } from '../lib/api';
import { Icon, type IconName } from './icons';

export type Tone = 'neutral' | 'gold' | 'success' | 'warning' | 'danger' | 'info';

/** Cor por significado de cada status do sistema. O contexto pode sobrescrever (ex.: contestação ABERTA = atenção). */
const STATUS_TONE: Record<string, Tone> = {
  APROVADA: 'success', APROVADO: 'success', CONCLUIDA: 'success', FINALIZADA: 'success', ATIVA: 'success', ATIVO: 'success',
  GPS_VALIDADO: 'success', ABERTA: 'success',
  PENDENTE: 'warning', EM_ANALISE: 'warning', PAUSA_EXCEDIDA: 'warning', PENDENTE_DE_EXCECAO: 'warning', PENDENTE_DE_FECHAMENTO: 'warning',
  EM_ATIVIDADE: 'gold', EXCECAO_APROVADA: 'gold', FECHAMENTO_ADMINISTRATIVO: 'gold', AJUSTADA: 'gold',
  EM_PAUSA: 'info', ENCERRADA: 'neutral', RASCUNHO: 'neutral', AGUARDANDO_CHECKIN: 'neutral', MANTIDA: 'neutral', INATIVA: 'neutral', INATIVO: 'neutral',
  RECUSADA: 'danger', REJEITADO: 'danger', CANCELADA: 'danger', CANCELADA_ADMINISTRATIVAMENTE: 'danger', NAO_COMPARECEU: 'danger',
  BLOQUEADO_TEMPORARIAMENTE: 'danger', BLOQUEADO_PERMANENTEMENTE: 'danger', BLOQUEADA_FINANCEIRA: 'danger',
  BLOQUEIO_TEMPORARIO: 'danger', BLOQUEIO_PERMANENTE: 'danger', CONFIRMADA: 'danger', FALTA: 'danger', FRAUDE: 'danger',
};

export function StatusBadge({ status, tone, children }: { status?: string | null; tone?: Tone; children?: ReactNode }) {
  const t = tone ?? (status ? STATUS_TONE[status] : undefined) ?? 'neutral';
  return <span className={`badge tone-${t}`}>{children ?? label(status)}</span>;
}

export function PageHeader({ title, description, actions, back }: { title: ReactNode; description?: ReactNode; actions?: ReactNode; back?: { to: string; label: string } }) {
  return (
    <header className="page-header">
      <div className="titles">
        {back && <Link className="back" to={back.to}><Icon name="chevronLeft" size={16} />{back.label}</Link>}
        <h1>{title}</h1>
        {description && <p className="desc">{description}</p>}
      </div>
      {actions && <div className="actions">{actions}</div>}
    </header>
  );
}

export function Stat({ value, label: text, tone = 'neutral', hint, onClick, selected }: { value: ReactNode; label: ReactNode; tone?: Tone; hint?: ReactNode; onClick?: () => void; selected?: boolean }) {
  const body = (
    <>
      <span className="value">{value}</span>
      <span className="label">{text}</span>
      {hint && <span className="hint">{hint}</span>}
    </>
  );
  return onClick
    ? <button type="button" className={`stat tone-${tone}${selected ? ' selected' : ''}`} onClick={onClick} aria-pressed={selected}>{body}</button>
    : <div className={`stat tone-${tone}`}>{body}</div>;
}

export function EmptyState({ title, text, icon = 'check', action }: { title: string; text?: ReactNode; icon?: IconName; action?: ReactNode }) {
  return (
    <div className="empty">
      <span className="icon"><Icon name={icon} size={24} /></span>
      <h3>{title}</h3>
      {text && <p>{text}</p>}
      {action}
    </div>
  );
}

export const Loading = ({ text = 'Carregando…' }: { text?: string }) => <div className="loading"><span className="spinner" />{text}</div>;

export function Alert({ kind = 'info', children, action }: { kind?: 'info' | 'warning' | 'danger' | 'success'; children: ReactNode; action?: ReactNode }) {
  const icon: IconName = kind === 'success' ? 'check' : kind === 'info' ? 'info' : 'alert';
  return <div className={`alert ${kind}`} role={kind === 'danger' ? 'alert' : undefined}><Icon name={icon} size={18} /><div className="grow">{children}</div>{action}</div>;
}

export function Progress({ value, total }: { value: number; total: number }) {
  const pct = total ? Math.min(100, Math.round((value / total) * 100)) : 0;
  return (
    <div className={`progress${value >= total && total > 0 ? ' full' : ''}`} title={`${value} de ${total}`}>
      <div className="bar"><span style={{ width: `${pct}%` }} /></div>
      <small>{value}/{total} preenchidas</small>
    </div>
  );
}

// ---------- Diálogos e toasts ----------

type ConfirmOpts = { title: string; message?: ReactNode; confirmText?: string; tone?: 'primary' | 'danger' };
type AskOpts = ConfirmOpts & {
  label: string; placeholder?: string; initial?: string; type?: 'text' | 'date';
  minLength?: number; maxLength?: number; multiline?: boolean; optional?: boolean;
  /** Texto que a pessoa precisa digitar para confirmar (ex.: BLOQUEAR). */
  requireText?: string;
};
type Pending = { kind: 'confirm'; opts: ConfirmOpts; resolve: (v: boolean) => void } | { kind: 'ask'; opts: AskOpts; resolve: (v: string | null) => void };
type Toast = { id: number; text: string; kind: 'success' | 'error' };

type DialogApi = {
  confirm: (opts: ConfirmOpts) => Promise<boolean>;
  ask: (opts: AskOpts) => Promise<string | null>;
  toast: (text: string, kind?: Toast['kind']) => void;
};
const DialogContext = createContext<DialogApi>(null!);
export const useDialog = () => useContext(DialogContext);

/** Diálogo nativo (<dialog>): o navegador cuida do foco, do Esc e da tela de fundo. */
export function DialogProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<Pending | null>(null);
  const [value, setValue] = useState('');
  const [toasts, setToasts] = useState<Toast[]>([]);
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    if (pending && !ref.current?.open) ref.current?.showModal();
  }, [pending]);

  const api: DialogApi = {
    confirm: (opts) => new Promise((resolve) => setPending({ kind: 'confirm', opts, resolve })),
    ask: (opts) => new Promise((resolve) => { setValue(opts.initial ?? ''); setPending({ kind: 'ask', opts, resolve }); }),
    toast: (text, kind = 'success') => {
      const id = Date.now() + Math.random();
      setToasts((t) => [...t, { id, text, kind }]);
      setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === 'error' ? 6000 : 3500);
    },
  };

  function close(result: boolean) {
    if (!pending) return;
    if (pending.kind === 'confirm') pending.resolve(result);
    else pending.resolve(result ? value.trim() : null);
    ref.current?.close();
    setPending(null);
  }

  const o = pending?.opts as AskOpts | undefined;
  const text = value.trim();
  const invalid = pending?.kind === 'ask' && o && (
    (o.requireText ? text !== o.requireText : false)
    || (!o.optional && !text)
    || (!!text && o.minLength != null && text.length < o.minLength)
    || (o.maxLength != null && text.length > o.maxLength)
  );

  return (
    <DialogContext.Provider value={api}>
      {children}
      <dialog ref={ref} className="dialog" onCancel={(e) => { e.preventDefault(); close(false); }}>
        {pending && o && (
          <form method="dialog" onSubmit={(e: FormEvent) => { e.preventDefault(); if (!invalid) close(true); }}>
            <h2>{o.title}</h2>
            {o.message && <div className="muted">{o.message}</div>}
            {pending.kind === 'ask' && (
              <label>
                {o.label}
                {o.multiline
                  ? <textarea rows={3} value={value} onChange={(e) => setValue(e.target.value)} placeholder={o.placeholder} maxLength={o.maxLength} autoFocus />
                  : <input type={o.type ?? 'text'} value={value} onChange={(e) => setValue(e.target.value)} placeholder={o.placeholder} maxLength={o.maxLength} autoFocus />}
                {o.minLength != null && !o.requireText && (
                  <span className="counter">{text.length}{o.maxLength ? `/${o.maxLength}` : ''} · mínimo {o.minLength}</span>
                )}
              </label>
            )}
            <div className="dialog-actions">
              <button type="button" onClick={() => close(false)}>Voltar</button>
              <button type="submit" className={o.tone === 'danger' ? 'danger solid' : 'primary'} disabled={!!invalid}>{o.confirmText ?? 'Confirmar'}</button>
            </div>
          </form>
        )}
      </dialog>
      <div className="toasts" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.kind}`}><Icon name={t.kind === 'error' ? 'alert' : 'check'} size={18} />{t.text}</div>
        ))}
      </div>
    </DialogContext.Provider>
  );
}

/** Executa uma ação com estado de ocupado e retorno por toast (sucesso ou erro). */
export function useAction() {
  const { toast } = useDialog();
  const [busy, setBusy] = useState('');
  async function run(key: string, fn: () => Promise<unknown>, success?: string) {
    setBusy(key);
    try {
      await fn();
      if (success) toast(success);
      return true;
    } catch (e: any) {
      toast(e.message ?? 'Erro inesperado.', 'error');
      return false;
    } finally {
      setBusy('');
    }
  }
  return { busy, run };
}

/** Justificativa padrão das ações administrativas (10 a 500 caracteres, como o servidor exige). */
export const reasonOpts = (title: string, extra: Partial<AskOpts> = {}): AskOpts => ({
  title, label: 'Justificativa', multiline: true, minLength: 10, maxLength: 500,
  placeholder: 'Explique o motivo; fica registrado na auditoria.', ...extra,
});
