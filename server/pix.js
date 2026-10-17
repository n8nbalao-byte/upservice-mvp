// Pix: validação da chave do profissional e o código "copia e cola" (BR Code estático, padrão EMV do Banco Central)
// que o gestor lê no app do banco para pagar. O app não fala com banco: só monta o código e registra o pagamento.
import { isValidCpf } from './rules.js';

export const PIX_TYPES = ['CPF', 'EMAIL', 'TELEFONE', 'ALEATORIA'];

/** Normaliza e valida a chave conforme o tipo. Devolve a chave no formato do Pix ou null se inválida. */
export function normalizePixKey(type, value) {
  const v = String(value ?? '').trim();
  if (type === 'CPF') { const d = v.replace(/\D/g, ''); return isValidCpf(d) ? d : null; }
  if (type === 'EMAIL') { const e = v.toLowerCase(); return e.length <= 77 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) ? e : null; }
  if (type === 'TELEFONE') {
    let d = v.replace(/\D/g, '');
    if (/^55\d{10,11}$/.test(d)) d = d.slice(2);
    return /^\d{10,11}$/.test(d) ? `+55${d}` : null;
  }
  if (type === 'ALEATORIA') { const k = v.toLowerCase(); return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(k) ? k : null; }
  return null;
}

const field = (id, value) => `${id}${String(value.length).padStart(2, '0')}${value}`;
// Nome e cidade no BR Code: só letras sem acento, números e espaço.
const plain = (s, max) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim().toUpperCase().slice(0, max).trim();

/** CRC16-CCITT (polinômio 0x1021, início 0xFFFF), exigido no campo 63 do BR Code. */
export function crc16(s) {
  let crc = 0xffff;
  for (const byte of Buffer.from(s, 'utf8')) {
    crc ^= byte << 8;
    for (let i = 0; i < 8; i++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

/** Código Pix estático com valor: chave, valor, nome e cidade de quem recebe. */
export function brCode({ key, amount, name, city, txid = '***' }) {
  const payload = [
    field('00', '01'),
    field('26', field('00', 'br.gov.bcb.pix') + field('01', key)),
    field('52', '0000'),
    field('53', '986'),
    amount > 0 ? field('54', Number(amount).toFixed(2)) : '',
    field('58', 'BR'),
    field('59', plain(name, 25) || 'PROFISSIONAL'),
    field('60', plain(city, 15) || 'SAO PAULO'),
    field('62', field('05', txid)),
    '6304',
  ].join('');
  return payload + crc16(payload);
}
