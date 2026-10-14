export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export function fail(status, message) {
  throw new HttpError(status, message);
}

/** Justificativa obrigatória de ações administrativas: 10 a 500 caracteres. */
export function requireReason(value) {
  const r = String(value ?? '').trim();
  if (r.length < 10 || r.length > 500) fail(400, 'Informe uma justificativa entre 10 e 500 caracteres.');
  return r;
}

export function text(value, field, { min = 1, max = 200, optional = false } = {}) {
  const v = String(value ?? '').trim();
  if (!v && optional) return null;
  if (v.length < min || v.length > max) fail(400, `Campo inválido: ${field}.`);
  return v;
}

export function int(value, field, min, max) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max) fail(400, `Campo inválido: ${field} (de ${min} a ${max}).`);
  return n;
}

export function num(value, field, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < min || n > max) fail(400, `Campo inválido: ${field}.`);
  return n;
}
