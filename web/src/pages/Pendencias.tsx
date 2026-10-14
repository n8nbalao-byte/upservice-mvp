import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useInbox } from '../App';
import { fmtDateTime, fmtTime, label } from '../lib/api';

const ORDER = ['EXCECAO', 'CHECKOUT_PENDENTE', 'CONTESTACAO', 'OCORRENCIA', 'CANDIDATURA', 'DOCUMENTO'];

/** Tudo o que espera decisão do gestor/admin. Atualiza sozinha (App consulta a cada 20 s) e avisa quando surge algo novo. */
export default function Pendencias() {
  const { items, updatedAt, refresh } = useInbox();
  const [permission, setPermission] = useState(() => ('Notification' in window ? Notification.permission : 'denied'));

  const enable = () => Notification.requestPermission().then(setPermission);

  return (
    <div className="stack">
      <div className="row between">
        <h1>Pendências</h1>
        <button onClick={refresh}>Atualizar agora</button>
      </div>
      <p className="muted">
        Atualiza sozinha a cada 20 segundos{updatedAt && ` · última às ${fmtTime(updatedAt)}`}. Quando surgir algo novo, toca um aviso e aparece uma notificação do navegador.
      </p>
      {permission === 'default' && (
        <div className="notice row between">
          <span>Ative as notificações para ser avisado mesmo com o app em outra aba.</span>
          <button className="primary" onClick={enable}>Ativar notificações</button>
        </div>
      )}
      {permission === 'denied' && 'Notification' in window && <p className="muted">Notificações bloqueadas no navegador: os avisos aparecem só nesta tela, com som.</p>}

      {items.length === 0 && <p className="notice">Nada pendente. 🎉</p>}
      {ORDER.map((kind) => {
        const group = items.filter((i) => i.kind === kind);
        if (!group.length) return null;
        return (
          <div key={kind} className="card stack">
            <h2>{label(kind)} <span className="badge">{group.length}</span></h2>
            {group.map((i) => (
              <Link key={i.key} to={i.link} className="row between pending-item">
                <span><b>{i.title}</b><div className="muted">{i.detail}</div></span>
                <span className="muted">{fmtDateTime(i.at)}</span>
              </Link>
            ))}
          </div>
        );
      })}
    </div>
  );
}
