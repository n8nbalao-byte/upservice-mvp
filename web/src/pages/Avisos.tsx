import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { EmptyState, Loading, PageHeader } from '../components/ui';
import { api, fmtDateTime } from '../lib/api';

export type Aviso = { id: string; kind: string; title: string; body: string | null; link: string | null; created_at: string; read_at: string | null };

/** Avisos do profissional (ex.: "você saiu da reserva"). Abrir a página marca todos como lidos. */
export default function Avisos() {
  const [items, setItems] = useState<Aviso[]>();
  useEffect(() => {
    api<{ items: Aviso[] }>('/me/avisos').then((a) => {
      setItems(a.items);
      if (a.items.some((i) => !i.read_at)) api('/me/avisos/lidos', { body: {} }).catch(() => {});
    }, () => setItems([]));
  }, []);
  return (
    <div className="page" style={{ maxWidth: 640 }}>
      <PageHeader title="Avisos" description="Novidades sobre as suas diárias." />
      {!items ? <Loading /> : items.length === 0 ? <div className="card"><EmptyState icon="bell" title="Nenhum aviso por enquanto" /></div> : (
        <ul className="avisos">
          {items.map((a) => (
            <li key={a.id} className={`card aviso${a.read_at ? '' : ' new'}`}>
              <div className="row between"><b>{a.title}</b><small className="muted">{fmtDateTime(a.created_at)}</small></div>
              {a.body && <p>{a.body}</p>}
              {a.link && <Link className="link" to={a.link}>{a.link === '/carteira' ? 'Ver na Carteira' : 'Ver minhas diárias'}</Link>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
