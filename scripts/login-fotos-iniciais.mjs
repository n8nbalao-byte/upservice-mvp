// Uma vez só: leva as fotos do carrossel que vinham dentro do app (login-N.webp e 960/login-N.webp) para o servidor,
// com o tipo de cada uma. Não faz nada se já houver fotos. Uso:
//   node --env-file=<.env> scripts/login-fotos-iniciais.mjs <pasta com login-N.webp e 960/> "1-5:PROFISSIONAL,6-9:LOJA"
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const [pasta, mapa = '1-5:PROFISSIONAL,6-9:LOJA'] = process.argv.slice(2);
if (!pasta) throw new Error('Informe a pasta com as fotos.');
const { q, closeDb } = await import('../server/db.js');
const { saveFile } = await import('../server/storage.js');

if ((await q('SELECT COUNT(*) AS n FROM login_fotos'))[0].n > 0) {
  console.log('Já há fotos cadastradas: nada a fazer.');
} else {
  const tipos = {};
  for (const parte of mapa.split(',')) {
    const [faixa, tipo] = parte.split(':');
    const [a, b = a] = faixa.split('-').map(Number);
    for (let n = a; n <= b; n++) tipos[n] = tipo;
  }
  for (const [n, tipo] of Object.entries(tipos)) {
    const g = path.join(pasta, `login-${n}.webp`);
    const p = path.join(pasta, '960', `login-${n}.webp`);
    if (!existsSync(g) || !existsSync(p)) { console.log(`login-${n}: arquivo não encontrado, pulei`); continue; }
    const [big, small] = [await saveFile('login', readFileSync(g), 'image/webp'), await saveFile('login', readFileSync(p), 'image/webp')];
    // created_at em sequência, para a ordem original ficar registrada.
    await q('INSERT INTO login_fotos (id, tipo, big_key, small_key, mime, created_at) VALUES (?,?,?,?,?,?)', [randomUUID(), tipo, big.key, small.key, 'image/webp', new Date(Date.now() + Number(n))]);
    console.log(`login-${n}: ${tipo}`);
  }
}
await closeDb();
process.exit(0);
