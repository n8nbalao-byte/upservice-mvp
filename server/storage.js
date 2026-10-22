import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

// Arquivos privados: nunca dentro de web/dist. Só saem pelas rotas /api/files, com checagem de acesso e auditoria.
const root = () => path.resolve(process.env.STORAGE_DIR || './storage');

export function decodeBase64(value) {
  const s = String(value ?? '');
  return Buffer.from(s.slice(s.indexOf(',') + 1), 'base64');
}

/** Tipo real pelo conteúdo (magic bytes), ignorando o que o cliente declara. */
export function sniff(buf) {
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length > 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf.subarray(0, 5).toString('latin1') === '%PDF-') return 'application/pdf';
  return null;
}

const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'application/pdf': 'pdf' };

export async function saveFile(dir, buf, mime) {
  const key = `${dir}/${randomUUID()}.${EXT[mime]}`;
  const full = path.join(root(), key);
  await mkdir(path.dirname(full), { recursive: true });
  await writeFile(full, buf, { flag: 'wx' });
  return { key, sha256: createHash('sha256').update(buf).digest('hex') };
}

// key vem sempre do banco, nunca do cliente.
export const loadFile = (key) => readFile(path.join(root(), key));
export const removeFile = (key) => rm(path.join(root(), key), { force: true });
