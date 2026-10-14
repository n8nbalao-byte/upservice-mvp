// CEP → endereço (ViaCEP) e endereço → coordenadas (Google Geocoding se houver chave; senão OpenStreetMap).
import { fail } from './http.js';

export async function lookupCep(cep) {
  const res = await fetch(`https://viacep.com.br/ws/${cep}/json/`).catch(() => null);
  const v = res?.ok ? await res.json() : null;
  if (!v || v.erro) fail(404, 'CEP não encontrado.');
  return { street: v.logradouro, district: v.bairro, city: v.localidade, uf: v.uf };
}

// OpenStreetMap erra centenas de metros a km em avenidas longas (medido nas lojas reais); o Google acerta o número.
// Por isso o formulário sempre mostra o pino no mapa para conferência.
export async function geocode({ street, number, district, city, uf, cep }) {
  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (key) {
    const address = `${street}, ${number || ''} - ${district}, ${city} - ${uf}, ${cep}, Brasil`;
    const r = await (await fetch(`https://maps.googleapis.com/maps/api/geocode/json?${new URLSearchParams({ address, region: 'br', key })}`)).json();
    const loc = r.results?.[0]?.geometry?.location;
    if (loc) return { lat: loc.lat, lng: loc.lng, source: 'google' };
  }
  const params = new URLSearchParams({ street: `${number ? `${number} ` : ''}${street}`, city, state: uf, country: 'Brasil', format: 'json', limit: '1' });
  const res = await fetch(`https://nominatim.openstreetmap.org/search?${params}`, {
    headers: { 'User-Agent': 'UpService/1.0 (contato@upserviceintermed.com)' },
  }).catch(() => null);
  const hit = res?.ok ? (await res.json())[0] : null;
  return hit ? { lat: Number(hit.lat), lng: Number(hit.lon), source: 'openstreetmap' } : { lat: null, lng: null, source: null };
}
