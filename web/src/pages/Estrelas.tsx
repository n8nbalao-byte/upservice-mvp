import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { EstrelasMapa, type StarsData } from '../components/Estrelas';
import { Alert, Loading, PageHeader } from '../components/ui';
import { api } from '../lib/api';

/** Profissional: as próprias estrelas (só com "Estrelas" ligado em Configurações). */
export default function Estrelas() {
  const [data, setData] = useState<StarsData>();
  const [error, setError] = useState('');
  useEffect(() => { api<StarsData>('/me/estrelas').then(setData, (e) => setError(e.message)); }, []);
  return (
    <div className="page" style={{ maxWidth: 760 }}>
      <PageHeader title="Minhas estrelas" description="Cada diária vale até 3 estrelas. Junte estrelas para subir de nível e desbloquear os bônus do mês." />
      {error ? <Alert kind="info">{error}</Alert> : !data ? <Loading /> : <EstrelasMapa data={data} />}
    </div>
  );
}

/** Gestão: prévia das estrelas de um profissional (funciona ligado ou não). */
export function GestaoEstrelas() {
  const { id } = useParams();
  const [data, setData] = useState<StarsData & { name: string }>();
  const [error, setError] = useState('');
  useEffect(() => { api<StarsData & { name: string }>(`/manage/workers/${id}/estrelas`).then(setData, (e) => setError(e.message)); }, [id]);
  return (
    <div className="page" style={{ maxWidth: 760 }}>
      <PageHeader back={{ to: `/gestao/profissionais/${id}`, label: 'Ficha do profissional' }} title={data ? `Estrelas de ${data.name}` : 'Estrelas'} description="Como o profissional vê a tela de estrelas." />
      {error ? <Alert kind="danger">{error}</Alert> : !data ? <Loading /> : <EstrelasMapa data={data} />}
    </div>
  );
}
