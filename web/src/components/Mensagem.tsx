import { api } from '../lib/api';
import { presenca } from '../lib/online';
import { Icon } from './icons';
import { useAction, useDialog } from './ui';

/** Bolinha verde "Online agora" ou "Visto há…" (último acesso). */
export function Presenca({ lastSeenAt }: { lastSeenAt: string | null | undefined }) {
  const p = presenca(lastSeenAt);
  return <span className={`presenca${p.online ? ' on' : ''}`}><i aria-hidden="true" />{p.texto}</span>;
}

/** Envia uma mensagem para o profissional: aparece na hora no app dele (como uma notificação) e fica nos Avisos. */
export function MensagemButton({ id, name, className = 'sm' }: { id: string; name: string; className?: string }) {
  const { ask } = useDialog();
  const { busy, run } = useAction();
  async function enviar() {
    const texto = await ask({
      title: `Mensagem para ${String(name).trim().split(/\s+/)[0]}`,
      message: 'Aparece na tela do app dele assim que abrir (ou em até 30 segundos, se já estiver com o app aberto) e fica nos Avisos.',
      label: 'Mensagem', placeholder: 'Ex.: Seu RG está ilegível, envie uma foto nova pelo app.', multiline: true, minLength: 3, maxLength: 500, confirmText: 'Enviar mensagem',
    });
    if (!texto) return;
    await run('mensagem', () => api(`/manage/workers/${id}/mensagem`, { body: { texto } }), 'Mensagem enviada.');
  }
  return <button type="button" className={className} disabled={busy === 'mensagem'} onClick={enviar}><Icon name="bell" size={16} />Mensagem</button>;
}
