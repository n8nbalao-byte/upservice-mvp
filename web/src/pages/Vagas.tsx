import { useEffect, useState } from 'react';
import { Icon } from '../components/icons';
import { Alert, EmptyState, Loading, PageHeader, StatusBadge, useAction } from '../components/ui';
import { api, fmtMoney, fmtTime, label } from '../lib/api';
import { getPosition } from '../lib/device';

type Job = {
  id: string; title: string; description: string | null; starts_at: string; ends_at: string; daily_value: number;
  break_count: number; break_minutes: number; unit_name: string; unit_address: string; available: number;
  distance_m: number | null; my_status: string | null;
};
const dayBR = (s: string) => new Date(s).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo', weekday: 'long', day: '2-digit', month: '2-digit' });
const km = (m: number) => (m < 1000 ? `${m} m` : `${(m / 1000).toFixed(1).replace('.', ',')} km`);

export default function Vagas() {
  const { busy, run } = useAction();
  const [jobs, setJobs] = useState<Job[]>();
  const [where, setWhere] = useState<{ lat: number; lng: number } | null>(null);
  const [geo, setGeo] = useState<'loading' | 'ok' | 'off'>('loading');
  const [error, setError] = useState('');

  const load = (pos = where) => api<Job[]>(`/jobs${pos ? `?lat=${pos.lat}&lng=${pos.lng}` : ''}`).then(setJobs, (e) => setError(e.message));

  useEffect(() => {
    getPosition()
      .then((p) => {
        const pos = { lat: p.coords.latitude, lng: p.coords.longitude };
        setWhere(pos);
        setGeo('ok');
        load(pos);
      })
      .catch(() => { setGeo('off'); load(null); });
  }, []);

  async function apply(j: Job) {
    if (await run(j.id, () => api(`/jobs/${j.id}/apply`, { body: {} }), 'Candidatura enviada! Acompanhe em Diárias.')) load();
  }

  return (
    <div className="page">
      <PageHeader title="Vagas disponíveis" description={geo === 'ok' ? 'Das lojas mais próximas de você para as mais distantes.' : 'Ordenadas por data.'} />
      {geo === 'off' && <Alert kind="info">Permita a localização no navegador para ver primeiro as lojas mais próximas. Ela só é usada para ordenar a lista.</Alert>}
      {error && <Alert kind="danger">{error}</Alert>}
      {!jobs ? <Loading text={geo === 'loading' ? 'Buscando sua localização…' : 'Carregando vagas…'} /> : jobs.length === 0 ? (
        <div className="card"><EmptyState icon="briefcase" title="Nenhuma vaga aberta no momento" text="Novas vagas aparecem aqui assim que forem publicadas." /></div>
      ) : (
        <div className="grid-2">
          {jobs.map((j) => (
            <article key={j.id} className="card stack">
              <div className="row between">
                <h2>{j.title}</h2>
                {j.distance_m != null && <StatusBadge tone="info"><Icon name="pin" size={12} />{km(j.distance_m)}</StatusBadge>}
              </div>
              <div>
                <div className="strong">{j.unit_name}</div>
                <div className="muted">{j.unit_address}</div>
              </div>
              <div className="row between">
                <span><Icon name="clock" size={14} /> <span style={{ textTransform: 'capitalize' }}>{dayBR(j.starts_at)}</span> · {fmtTime(j.starts_at)}–{fmtTime(j.ends_at)}</span>
                <span className="money">{fmtMoney(j.daily_value)}</span>
              </div>
              <div className="muted">
                {j.break_count ? `${j.break_count} pausa(s) de ${j.break_minutes} min` : 'Sem pausas'} · {j.available ? `${j.available} vaga(s) livre(s)` : 'Sem vagas livres'}
              </div>
              {j.description && <p className="muted">{j.description}</p>}
              {j.my_status ? (
                <StatusBadge status={j.my_status}>Sua candidatura: {label(j.my_status)}</StatusBadge>
              ) : (
                <button className="primary big" disabled={!j.available || busy === j.id} onClick={() => apply(j)}>{busy === j.id ? 'Enviando…' : 'Candidatar-me'}</button>
              )}
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
