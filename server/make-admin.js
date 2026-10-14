// Cria (ou promove) o primeiro administrador. Uso: npm run make-admin -- email@empresa.com "Nome"
import { randomUUID } from 'node:crypto';
import { audit } from './audit.js';
import { closeDb, q } from './db.js';

const email = process.argv[2]?.trim().toLowerCase();
if (!email?.includes('@')) {
  console.error('Uso: npm run make-admin -- email@empresa.com "Nome"');
  process.exit(1);
}

const [user] = await q('SELECT id FROM users WHERE email = ?', [email]);
const id = user?.id ?? randomUUID();
if (user) await q("UPDATE users SET role = 'ADMINISTRADOR', status = 'ATIVO' WHERE id = ?", [id]);
else await q("INSERT INTO users (id, email, name, role) VALUES (?,?,?,'ADMINISTRADOR')", [id, email, process.argv[3] || email]);
await audit(q, null, 'BOOTSTRAP_ADMIN', 'user', id, { after: { email } });
console.log(`Administrador pronto: ${email}. Entre com a conta Google deste e-mail.`);
await closeDb();
