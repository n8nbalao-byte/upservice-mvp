import { useEffect, useState } from 'react';
import { api, fmtDateTime, fmtMoney, fmtTime, label } from '../lib/api';
import { getPosition } from '../lib/device';

type Job = {
  id: string; title: string; description: string | null; starts_at: string; ends_at: string; daily_value: number;
  break_count: number; break_minutes: number; unit_name: string; unit_address: string; available: number;
  distance_m: number | null; my_status: string | null;
};

export default function Vagas() {
  const [jobs, setJobs] = useState<Job[]>();
  const [where, setWhere] = useState<{ lat: number; lng: number } | null>(null);
  const [geoMsg, setGeoMsg] = useState('Buscando sua localização para mostrar as lojas mais próximas…');
  const [error, setError] = useState('');

  const load = (pos = where) => api<Job[]>(`/jobs${pos ? `?lat=${pos.lat}&lng=${pos.lng}` : ''}`).then(setJobs, (e) => setError(e.message));

  useEffect(() => {
    getPosition()
      .then((p) => {
        const pos = { lat: p.coords.latitude, lng: p.coords.longitude };
        setWhere(pos);
        setGeoMsg('');
        load(pos);
      })
      .catch(() => {
        setGeoMsg('Sem localização: vagas ordenadas por data. Permita a localização para ver as mais próximas.');
        load(null);
      });
  }, []);

  async function apply(id: string) {
    setError('');
    try {
      await api(`/jobs/${id}/apply`, { body: {} });
      await load();
    } catch (e: any) {
      setError(e.message);
    }
  }

  return (
    <div>
      <h1>Vagas disponíveis</h1>
      {geoMsg && <p className="notice">{geoMsg}</p>}
      {error && <p className="error">{error}</p>}
      {jobs?.length === 0 && <p className="muted">Nenhuma vaga aberta no momento.</p>}
      {jobs?.map((j) => (
        <div key={j.id} className="card stack">
          <div className="row between">
            <b>{j.title}</b>
            {j.distance_m != null && <span className="badge">{(j.distance_m / 1000).toFixed(1)} km</span>}
          </div>
          <div>{j.unit_name} · <span className="muted">{j.unit_address}</span></div>
          <div>{fmtDateTime(j.starts_at)} até {fmtTime(j.ends_at)} · {fmtMoney(j.daily_value)}</div>
          <div className="muted">
            {j.break_count ? `${j.break_count} pausa(s) de ${j.break_minutes} min` : 'Sem pausas'} · {j.available} posição(ões) disponível(is)
          </div>
          {j.description && <div className="muted">{j.description}</div>}
          {j.my_status ? (
            <span className="badge">Sua candidatura: {label(j.my_status)}</span>
          ) : (
            <button className="primary" disabled={!j.available} onClick={() => apply(j.id)}>Candidatar-me</button>
          )}
        </div>
      ))}
    </div>
  );
}
