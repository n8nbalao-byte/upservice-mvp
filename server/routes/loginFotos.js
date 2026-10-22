// Fotos do carrossel da tela de login: públicas (o login aparece antes de entrar), gerenciadas pelo administrador
// principal em Configurações. Cada foto tem a versão de computador (até 1920 px) e a de celular (960 px), já reduzidas
// pelo navegador de quem envia, e um tipo (profissional ou loja) para o login alternar.
import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import { audit } from '../audit.js';
import { requireOwner } from '../auth.js';
import { q, tx } from '../db.js';
import { fail } from '../http.js';
import { decodeBase64, loadFile, removeFile, saveFile, sniff } from '../storage.js';

const r = Router();
const TIPOS = ['PROFISSIONAL', 'LOJA'];
const MAX_BYTES = 3 * 1024 * 1024;
const MAX_FOTOS = 40;
const isWebp = (b) => b.length > 12 && b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP';
const tipoImagem = (b) => (isWebp(b) ? 'image/webp' : ['image/jpeg', 'image/png'].includes(sniff(b)) ? sniff(b) : null);
const url = (f, tam) => `/api/public/login-fotos/${f.id}/${tam}`;

r.get('/public/login-fotos', async (req, res) => {
  const fotos = await q('SELECT id, tipo FROM login_fotos ORDER BY created_at');
  res.set('Cache-Control', 'public, max-age=60');
  res.json(fotos.map((f) => ({ id: f.id, tipo: f.tipo, src: url(f, 'g'), small: url(f, 'p') })));
});

// O arquivo de uma foto nunca muda (foto nova = id novo): o navegador guarda por um ano.
r.get('/public/login-fotos/:id/:tam', async (req, res) => {
  if (!['g', 'p'].includes(req.params.tam)) fail(404, 'Não encontrado.');
  const [f] = await q('SELECT big_key, small_key, mime FROM login_fotos WHERE id = ?', [req.params.id]);
  if (!f) fail(404, 'Não encontrado.');
  const buf = await loadFile(req.params.tam === 'g' ? f.big_key : f.small_key).catch(() => null);
  if (!buf) fail(404, 'Não encontrado.');
  res.set({ 'Content-Type': f.mime, 'Cache-Control': 'public, max-age=31536000, immutable', 'X-Content-Type-Options': 'nosniff' });
  res.send(buf);
});

r.get('/admin/login-fotos', requireOwner, async (req, res) => {
  const fotos = await q('SELECT id, tipo, width, created_at AS createdAt FROM login_fotos ORDER BY created_at');
  res.json(fotos.map((f) => ({ ...f, src: url(f, 'g'), small: url(f, 'p') })));
});

r.post('/admin/login-fotos', requireOwner, async (req, res) => {
  const tipo = String(req.body.tipo ?? '');
  if (!TIPOS.includes(tipo)) fail(400, 'Escolha se a foto é de profissional ou de loja.');
  const big = decodeBase64(req.body.big);
  const small = decodeBase64(req.body.small);
  if (!big.length || !small.length) fail(400, 'Envie a foto.');
  if (big.length > MAX_BYTES || small.length > MAX_BYTES) fail(413, 'Foto grande demais (máximo 3 MB depois de reduzida).');
  const mime = tipoImagem(big);
  if (!mime || tipoImagem(small) !== mime) fail(400, 'Formato aceito: JPG, PNG ou WebP.');
  if ((await q('SELECT COUNT(*) AS n FROM login_fotos'))[0].n >= MAX_FOTOS) fail(409, `O carrossel já tem ${MAX_FOTOS} fotos. Apague alguma antes.`);
  const width = Number.isInteger(req.body.width) && req.body.width > 0 && req.body.width < 20000 ? req.body.width : null;
  const [g, p] = [await saveFile('login', big, mime), await saveFile('login', small, mime)];
  const id = randomUUID();
  try {
    await tx(async (tq) => {
      await tq('INSERT INTO login_fotos SET ?', [{ id, tipo, big_key: g.key, small_key: p.key, mime, width, created_by: req.user.id }]);
      await audit(tq, req, 'LOGIN_FOTO_ADD', 'login_foto', id, { after: { tipo, width, sha256: g.sha256 } });
    });
  } catch (e) {
    await removeFile(g.key);
    await removeFile(p.key);
    throw e;
  }
  res.status(201).json({ id, tipo, src: url({ id }, 'g'), small: url({ id }, 'p') });
});

r.delete('/admin/login-fotos/:id', requireOwner, async (req, res) => {
  const [f] = await q('SELECT id, tipo, big_key, small_key FROM login_fotos WHERE id = ?', [req.params.id]);
  if (!f) fail(404, 'Não encontrado.');
  await tx(async (tq) => {
    await tq('DELETE FROM login_fotos WHERE id = ?', [f.id]);
    await audit(tq, req, 'LOGIN_FOTO_DELETE', 'login_foto', f.id, { before: { tipo: f.tipo } });
  });
  await removeFile(f.big_key);
  await removeFile(f.small_key);
  res.json({ ok: true });
});

export default r;
