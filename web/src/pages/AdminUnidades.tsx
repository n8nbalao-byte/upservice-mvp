import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Icon } from '../components/icons';
import { Alert, EmptyState, Loading, PageHeader, StatusBadge, reasonOpts, useAction, useDialog } from '../components/ui';
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
  const { busy, run } = useAction();
  const [f, setF] = useState<Form>(() => toForm(unit));
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => ref.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), []);
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

  function save(e: FormEvent) {
    e.preventDefault();
    run('save', () => (unit.id ? api(`/units/${unit.id}`, { method: 'PUT', body: f }) : api('/units', { body: f })), unit.id ? 'Unidade atualizada.' : 'Unidade cadastrada.')
      .then((ok) => ok && onSaved());
  }

  const lat = Number(f.lat);
  const lng = Number(f.lng);
  const hasPin = f.lat !== '' && f.lng !== '' && Number.isFinite(lat) && Number.isFinite(lng);
  const input = (k: keyof Form, props: Record<string, unknown> = {}) => <input value={f[k]} onChange={(e) => set(k, e.target.value)} {...props} />;

  return (
    <form ref={ref} className="card form" onSubmit={save}>
      <div className="card-header" style={{ marginBottom: 0 }}>
        <h2>{unit.id ? `Editar ${unit.code}` : 'Nova unidade'}</h2>
        {!unit.id && <span className="sub">O código (ATC-001, ATC-002…) é gerado ao salvar</span>}
      </div>
      <div className="cols">
        <label>Nome{input('name', { required: true, placeholder: 'Atacadão Penha' })}</label>
        <label>Região <span className="hint">(opcional)</span>{input('region', { placeholder: 'Zona Leste' })}</label>
      </div>
      <h3>Endereço</h3>
      <div className="cols">
        <label>CEP<input value={f.cep} onChange={(e) => onCep(e.target.value)} inputMode="numeric" placeholder="00000-000" required /><span className="hint">Preenche logradouro, bairro, cidade e UF</span></label>
        <label>Número{input('number', { required: true, placeholder: '2521 ou s/n', onBlur: () => f.cep.length === 9 && f.number && lookup(f.cep, f.number) })}<span className="hint">Ao sair do campo, calcula as coordenadas</span></label>
        <label>Logradouro{input('street', { required: true })}</label>
        <label>Bairro{input('district', { required: true })}</label>
        <label>Cidade{input('city', { required: true })}</label>
        <label>UF{input('uf', { required: true, maxLength: 2 })}</label>
      </div>
      {status && <Alert kind="info">{status}</Alert>}
      {error && <Alert kind="danger">{error}</Alert>}
      <h3>Localização e raio de presença</h3>
      <div className="grid-2">
        <div className="form">
          <div className="cols">
            <label>Latitude{input('lat', { required: true, inputMode: 'decimal' })}</label>
            <label>Longitude{input('lng', { required: true, inputMode: 'decimal' })}</label>
            <label>Raio de presença (m){input('radiusM', { type: 'number', min: 100, max: 500, required: true })}</label>
            <label>Precisão GPS máxima (m){input('maxAccuracyM', { type: 'number', min: 10, max: 500, required: true })}</label>
          </div>
          <div className="row">
            <button type="button" className="sm" onClick={useHere}><Icon name="pin" size={16} />Usar minha localização</button>
            {hasPin && <a className="btn sm" href={`https://www.google.com/maps?q=${lat},${lng}`} target="_blank" rel="noreferrer">Abrir no Google Maps</a>}
          </div>
          <p className="muted">O pino deve ficar na entrada da loja: é dele que o raio de presença é medido.</p>
        </div>
        {hasPin ? (
          <iframe
            title="Pino da unidade"
            style={{ width: '100%', minHeight: 240, border: '1px solid var(--line)', borderRadius: 'var(--radius)' }}
            src={`https://www.openstreetmap.org/export/embed.html?bbox=${lng - 0.006},${lat - 0.004},${lng + 0.006},${lat + 0.004}&layer=mapnik&marker=${lat},${lng}`}
          />
        ) : <div className="subpanel"><EmptyState icon="pin" title="Sem pino ainda" text="Preencha CEP e número ou use sua localização." /></div>}
      </div>
      <div className="row"><button type="button" onClick={onCancel}>Cancelar</button><button className="primary" disabled={busy === 'save'}>{busy === 'save' ? 'Salvando…' : 'Salvar unidade'}</button></div>
    </form>
  );
}

export default function AdminUnidades() {
  const { ask } = useDialog();
  const { busy, run } = useAction();
  const [units, setUnits] = useState<Unit[]>();
  const [editing, setEditing] = useState<Partial<Unit> | null>(null);
  const [search, setSearch] = useState('');
  const [error, setError] = useState('');

  const load = () => api<Unit[]>('/units').then(setUnits, (e) => setError(e.message));
  useEffect(() => { load(); }, []);

  async function setStatus(u: Unit, status: string) {
    const blocking = status !== 'ATIVA';
    const reason = await ask(reasonOpts(`${u.code}: mudar para "${label(status)}"?`, {
      message: status === 'BLOQUEADA_FINANCEIRA' ? 'A loja deixa de receber vagas e candidaturas novas. Atividades já aprovadas continuam.' : undefined,
      confirmText: label(status), tone: blocking ? 'danger' : 'primary',
    }));
    if (reason && await run(u.id, () => api(`/units/${u.id}/status`, { body: { status, reason } }), 'Status da unidade atualizado.')) load();
  }

  const term = search.trim().toLowerCase();
  const shown = (units ?? []).filter((u) => !term || `${u.code} ${u.name} ${u.address} ${u.region ?? ''}`.toLowerCase().includes(term));

  return (
    <div className="page">
      <PageHeader
        title="Unidades"
        description="Lojas atendidas, endereço, pino de localização e raio de presença."
        actions={<button className="primary" onClick={() => setEditing({})}><Icon name="plus" size={18} />Nova unidade</button>}
      />
      {error && <Alert kind="danger">{error}</Alert>}
      {editing && <UnitForm key={editing.id ?? 'new'} unit={editing} onCancel={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />}

      <div className="filters"><label style={{ maxWidth: 420 }}>Buscar<input placeholder="Código, nome, endereço ou região" value={search} onChange={(e) => setSearch(e.target.value)} /></label></div>
      <div className="card tight">
        <div className="card-header"><h2>Lojas</h2><span className="sub">{shown.length} de {units?.length ?? 0}</span></div>
        {!units ? <Loading /> : shown.length === 0 ? <EmptyState icon="store" title="Nenhuma unidade encontrada" /> : (
          <div className="table-wrap">
            <table className="responsive">
              <thead><tr><th>Código</th><th>Loja</th><th className="num">Raio</th><th>Status</th><th>Ações</th></tr></thead>
              <tbody>
                {shown.map((u) => (
                  <tr key={u.id}>
                    <td data-label="Código" className="strong nowrap">{u.code}</td>
                    <td data-label="Loja"><span className="strong">{u.name}</span><span className="muted">{u.address}</span></td>
                    <td data-label="Raio" className="num">{u.radius_m} m</td>
                    <td data-label="Status"><StatusBadge status={u.status} />{u.status_reason && u.status !== 'ATIVA' && <span className="muted">{u.status_reason}</span>}</td>
                    <td data-label="Ações">
                      <div className="row">
                        <button className="sm" onClick={() => setEditing(u)}>Editar</button>
                        {u.status !== 'ATIVA' && <button className="sm" disabled={busy === u.id} onClick={() => setStatus(u, 'ATIVA')}>Reativar</button>}
                        {u.status === 'ATIVA' && <button className="sm ghost text-danger" disabled={busy === u.id} onClick={() => setStatus(u, 'BLOQUEADA_FINANCEIRA')}>Bloquear (financeiro)</button>}
                        {u.status !== 'INATIVA' && <button className="sm ghost" disabled={busy === u.id} onClick={() => setStatus(u, 'INATIVA')}>Inativar</button>}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
