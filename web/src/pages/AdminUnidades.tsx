import { useEffect, useState, type FormEvent } from 'react';
import { api, label, type Unit } from '../lib/api';
import { getPosition } from '../lib/device';

type Form = { name: string; region: string; cep: string; street: string; number: string; district: string; city: string; uf: string; lat: string; lng: string; radiusM: string; maxAccuracyM: string };

const fmtCep = (v: string) => v.replace(/\D/g, '').slice(0, 8).replace(/^(\d{5})(\d)/, '$1-$2');

const toForm = (u: Partial<Unit>): Form => ({
  name: u.name ?? '', region: u.region ?? '', cep: fmtCep(u.cep ?? ''), street: u.street ?? '', number: u.number ?? '',
  district: u.district ?? '', city: u.city ?? '', uf: u.uf ?? '', lat: u.lat != null ? String(u.lat) : '', lng: u.lng != null ? String(u.lng) : '',
  radiusM: String(u.radius_m ?? 300), maxAccuracyM: String(u.max_accuracy_m ?? 100),
});

function UnitForm({ unit, onSaved, onCancel }: { unit: Partial<Unit>; onSaved: () => void; onCancel: () => void }) {
  const [f, setF] = useState<Form>(() => toForm(unit));
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const set = (k: keyof Form, v: string) => setF((old) => ({ ...old, [k]: v }));

  async function lookup(cep: string, number = '') {
    setError('');
    setStatus(number ? 'Buscando coordenadas…' : 'Buscando endereço…');
    try {
      const a = await api(`/geo/address?cep=${cep.replace(/\D/g, '')}&number=${encodeURIComponent(number)}`);
      setF((old) => ({
        ...old, street: a.street || old.street, district: a.district || old.district, city: a.city, uf: a.uf,
        ...(a.lat != null ? { lat: String(a.lat), lng: String(a.lng) } : {}),
      }));
      setStatus(number ? (a.lat != null ? 'Coordenadas encontradas: confira o pino no mapa.' : 'Coordenadas não encontradas: use "Usar minha localização" ou preencha à mão.') : '');
    } catch (e: any) {
      setError(e.message);
      setStatus('');
    }
  }

  function onCep(v: string) {
    const masked = fmtCep(v);
    set('cep', masked);
    if (masked.length === 9) lookup(masked, f.number);
  }

  async function useHere() {
    setError('');
    try {
      const p = await getPosition();
      setF((old) => ({ ...old, lat: p.coords.latitude.toFixed(6), lng: p.coords.longitude.toFixed(6) }));
      setStatus(`Localização atual usada (precisão ${Math.round(p.coords.accuracy)} m).`);
    } catch (e: any) {
      setError(e.message);
    }
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    setError('');
    try {
      if (unit.id) await api(`/units/${unit.id}`, { method: 'PUT', body: f });
      else await api('/units', { body: f });
      onSaved();
    } catch (err: any) {
      setError(err.message);
    }
  }

  const lat = Number(f.lat);
  const lng = Number(f.lng);
  const hasPin = f.lat !== '' && f.lng !== '' && Number.isFinite(lat) && Number.isFinite(lng);
  const input = (k: keyof Form, props: Record<string, unknown> = {}) => <input value={f[k]} onChange={(e) => set(k, e.target.value)} {...props} />;

  return (
    <form className="card stack" onSubmit={save}>
      <h2>{unit.id ? `Editar ${unit.code}` : 'Nova unidade'}</h2>
      {!unit.id && <p className="muted">O código (ATC-001, ATC-002…) é gerado automaticamente ao salvar.</p>}
      <div className="cols">
        <label>Nome{input('name', { required: true, placeholder: 'Atacadão Penha' })}</label>
        <label>Região{input('region', { placeholder: 'Zona Leste' })}</label>
      </div>
      <div className="cols">
        <label>CEP<input value={f.cep} onChange={(e) => onCep(e.target.value)} inputMode="numeric" placeholder="00000-000" required /></label>
        <label>Número{input('number', { required: true, placeholder: '2521 ou s/n', onBlur: () => f.cep.length === 9 && f.number && lookup(f.cep, f.number) })}</label>
      </div>
      <div className="cols">
        <label>Logradouro{input('street', { required: true })}</label>
        <label>Bairro{input('district', { required: true })}</label>
        <label>Cidade{input('city', { required: true })}</label>
        <label>UF{input('uf', { required: true, maxLength: 2 })}</label>
      </div>
      {status && <p className="notice">{status}</p>}
      {error && <p className="error">{error}</p>}
      <div className="cols">
        <label>Latitude{input('lat', { required: true, inputMode: 'decimal' })}</label>
        <label>Longitude{input('lng', { required: true, inputMode: 'decimal' })}</label>
        <label>Raio de presença (m){input('radiusM', { type: 'number', min: 100, max: 500, required: true })}</label>
        <label>Precisão GPS máxima (m){input('maxAccuracyM', { type: 'number', min: 10, max: 500, required: true })}</label>
      </div>
      <div className="row">
        <button type="button" onClick={useHere}>Usar minha localização</button>
        {hasPin && <a className="button" href={`https://www.google.com/maps?q=${lat},${lng}`} target="_blank" rel="noreferrer">Abrir no Google Maps</a>}
      </div>
      {hasPin && (
        <iframe
          title="Pino da unidade"
          style={{ width: '100%', height: 260, border: 0, borderRadius: 10 }}
          src={`https://www.openstreetmap.org/export/embed.html?bbox=${lng - 0.006},${lat - 0.004},${lng + 0.006},${lat + 0.004}&layer=mapnik&marker=${lat},${lng}`}
        />
      )}
      <p className="muted">O pino deve ficar na entrada da loja: é dele que o raio de presença é medido.</p>
      <div className="row"><button className="primary">Salvar</button><button type="button" onClick={onCancel}>Cancelar</button></div>
    </form>
  );
}

export default function AdminUnidades() {
  const [units, setUnits] = useState<Unit[]>([]);
  const [editing, setEditing] = useState<Partial<Unit> | null>(null);
  const [error, setError] = useState('');

  const load = () => api<Unit[]>('/units').then(setUnits, (e) => setError(e.message));
  useEffect(() => { load(); }, []);

  async function setStatus(u: Unit, status: string) {
    const reason = prompt(`Justificativa para mudar ${u.code} para "${label(status)}" (10 a 500 caracteres):`);
    if (reason) await api(`/units/${u.id}/status`, { body: { status, reason } }).then(load, (e) => setError(e.message));
  }

  return (
    <div className="stack">
      <div className="row between"><h1>Unidades</h1><button className="primary" onClick={() => setEditing({})}>Nova unidade</button></div>
      {error && <p className="error">{error}</p>}

      {editing && <UnitForm key={editing.id ?? 'new'} unit={editing} onCancel={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />}

      <div className="scroll">
        <table>
          <thead><tr><th>Código</th><th>Nome</th><th>Raio</th><th>Status</th><th></th></tr></thead>
          <tbody>
            {units.map((u) => (
              <tr key={u.id}>
                <td>{u.code}</td>
                <td>{u.name}<div className="muted">{u.address}</div></td>
                <td>{u.radius_m} m</td>
                <td>{label(u.status)}{u.status_reason && <div className="muted">{u.status_reason}</div>}</td>
                <td className="row">
                  <button onClick={() => setEditing(u)}>Editar</button>
                  {u.status !== 'ATIVA' && <button onClick={() => setStatus(u, 'ATIVA')}>Reativar</button>}
                  {u.status === 'ATIVA' && <button className="danger" onClick={() => setStatus(u, 'BLOQUEADA_FINANCEIRA')}>Bloquear (financeiro)</button>}
                  {u.status !== 'INATIVA' && <button onClick={() => setStatus(u, 'INATIVA')}>Inativar</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
