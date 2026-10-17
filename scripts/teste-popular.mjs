// Dados de TESTE (marcados) para experimentar o app com volume: 300 profissionais (teste+N@teste.upservice.invalid,
// telefone com DDD 00, que não existe), ~20 vagas por loja de amanhã até 31/12 ("[TESTE]" na descrição), parte delas
// já aceita; diárias concluídas do dia 1º do mês até ontem (valor a receber) e quebras de caixa em parte das de caixa.
// Grava direto no banco: nada passa pelos fluxos que mandam WhatsApp ou e-mail. Não cria gestor nem administrador.
// Uso: node --env-file=<.env> scripts/teste-popular.mjs     Apagar tudo: scripts/teste-limpar.mjs
import { randomUUID } from 'node:crypto';

const { q, closeDb } = await import('../server/db.js');

const WORKERS = 300;
const JOBS_PER_UNIT = 20;
const DOMAIN = '@teste.upservice.invalid';
const TAG = '[TESTE]';

if ((await q('SELECT COUNT(*) AS n FROM users WHERE email LIKE ?', [`%${DOMAIN}`]))[0].n) {
  console.error('Já existem dados de teste. Rode scripts/teste-limpar.mjs antes de popular de novo.');
  process.exit(1);
}

const FIRST = ['Ana', 'Bruno', 'Carla', 'Diego', 'Eduarda', 'Felipe', 'Gabriela', 'Henrique', 'Isabela', 'João', 'Karina', 'Lucas', 'Mariana', 'Nicolas', 'Olívia', 'Pedro', 'Rafaela', 'Samuel', 'Tatiane', 'Vinícius', 'Bianca', 'Caio', 'Daniela', 'Everton', 'Fernanda', 'Gustavo', 'Helena', 'Igor', 'Jéssica', 'Leandro', 'Michele', 'Natan', 'Patrícia', 'Renato', 'Simone', 'Thiago', 'Vanessa', 'Wesley', 'Yasmin', 'Zé Carlos'];
const LAST = ['Silva', 'Santos', 'Oliveira', 'Souza', 'Rodrigues', 'Ferreira', 'Alves', 'Pereira', 'Lima', 'Gomes', 'Costa', 'Ribeiro', 'Martins', 'Carvalho', 'Almeida', 'Lopes', 'Soares', 'Fernandes', 'Vieira', 'Barbosa', 'Rocha', 'Dias', 'Nascimento', 'Andrade', 'Moreira', 'Nunes', 'Marques', 'Machado', 'Mendes', 'Freitas'];
const FUNCOES = [
  { title: 'Repositor', value: 120 }, { title: 'Operador de Caixa', value: 150, cashier: true }, { title: 'Empacotador', value: 100 },
  { title: 'Conferente', value: 140 }, { title: 'Estoquista', value: 130 }, { title: 'Auxiliar de Limpeza', value: 110 },
  { title: 'Manutenção', value: 160 }, { title: 'Promotor de Vendas', value: 130 },
];
const SHIFTS = [['06', '12'], ['08', '14'], ['12', '18'], ['14', '20']]; // 6 h cada
const MOTIVOS = ['Faltou dinheiro no fechamento do caixa', 'Troco dado a mais, conferido na filmagem', 'Diferença no fechamento: cédula não localizada', 'Sangria registrada a menos'];

const pick = (list, i) => list[((i % list.length) + list.length) % list.length];
const dateOf = (d) => new Date(d).toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });
const at = (day, hh) => new Date(`${day}T${hh}:00:00-03:00`);
const addDays = (day, n) => dateOf(Date.parse(`${day}T12:00:00-03:00`) + n * 86400e3);
const bulk = async (table, cols, rows) => {
  for (let i = 0; i < rows.length; i += 1000) await q(`INSERT INTO ${table} (${cols.join(',')}) VALUES ?`, [rows.slice(i, i + 1000)]);
};
/** CPF válido a partir de 9 dígitos. */
const cpf = (base) => {
  const d = String(base).padStart(9, '0').split('').map(Number);
  for (const len of [9, 10]) { const s = d.slice(0, len).reduce((t, x, i) => t + x * (len + 1 - i), 0); d.push(((s * 10) % 11) % 10); }
  return d.join('');
};

const today = dateOf(Date.now());
const lastDay = `${today.slice(0, 4)}-12-31`;
const firstPast = `${today.slice(0, 7)}-01`;
const [admin] = await q("SELECT id FROM users WHERE role = 'ADMINISTRADOR' ORDER BY is_owner DESC, created_at LIMIT 1");
const units = await q("SELECT id, code, lat, lng FROM units WHERE status = 'ATIVA' ORDER BY code");
if (!admin || !units.length) throw new Error('Sem administrador ou sem lojas ativas.');
const usedCpf = new Set((await q('SELECT cpf FROM worker_profiles')).map((r) => r.cpf));

// ---------- profissionais ----------
const workers = [];
for (let i = 0, base = 731000000; workers.length < WORKERS; i++, base += 7919) {
  const c = cpf(base);
  if (usedCpf.has(c)) continue;
  const n = workers.length;
  workers.push({ id: randomUUID(), email: `teste+${n + 1}${DOMAIN}`, name: `${pick(FIRST, n)} ${pick(LAST, n * 7)} ${pick(LAST, n * 13 + 5)}`, cpf: c, n });
}
await bulk('users', ['id', 'email', 'name', 'role', 'status'], workers.map((w) => [w.id, w.email, w.name, 'PROFISSIONAL', 'ATIVO']));
await bulk('worker_profiles', ['user_id', 'cpf', 'rg', 'phone', 'address', 'city', 'uf', 'emergency_name', 'emergency_phone', 'terms_accepted_at', 'pix_type', 'pix_key'],
  workers.map((w) => [w.id, w.cpf, String(30000000 + w.n), `009${String(w.n).padStart(8, '0')}`, `Rua de Teste, ${w.n + 1}`, 'São Paulo', 'SP', 'Contato de teste', '00900000000', new Date(),
    w.n % 3 === 2 ? null : 'ALEATORIA', w.n % 3 === 2 ? null : randomUUID()]));
await bulk('worker_documents', ['id', 'user_id', 'type', 'storage_key', 'sha256', 'size', 'mime', 'status'],
  workers.flatMap((w) => ['CPF', 'RG', 'COMPROVANTE', 'SELFIE'].map((t) => [randomUUID(), w.id, t, `teste/${t.toLowerCase()}.jpg`, '0'.repeat(64), 1000, 'image/jpeg', 'APROVADO'])));

// Um profissional não pega duas diárias no mesmo dia.
const busy = new Map();
const free = (w, day) => !busy.get(w.id)?.has(day);
const take = (w, day) => { if (!busy.has(w.id)) busy.set(w.id, new Set()); busy.get(w.id).add(day); };
let cursor = 0;
const nextFree = (day) => { for (let k = 0; k < WORKERS; k++) { const w = workers[cursor++ % WORKERS]; if (free(w, day)) return w; } return null; };

const jobs = [], apps = [], sessions = [], events = [], confirms = [], breaks = [];
const job = (unit, day, shift, f, k, status, positions) => {
  const id = randomUUID();
  const value = f.value + (k % 3) * 10;
  jobs.push([id, unit.id, f.title, `${TAG} Vaga de teste: ${f.title.toLowerCase()} em turno de 6 h.`, at(day, shift[0]), at(day, shift[1]), positions, value, 1, 15, status, f.cashier ? 1 : 0, admin.id]);
  return { id, value };
};

// ---------- vagas futuras: ~20 por loja, de amanhã a 31/12 ----------
const days = [];
for (let d = addDays(today, 1); d <= lastDay; d = addDays(d, 1)) days.push(d);
units.forEach((unit, u) => {
  for (let k = 0; k < JOBS_PER_UNIT; k++) {
    const day = days[Math.floor((k * days.length) / JOBS_PER_UNIT + u) % days.length];
    const f = pick(FUNCOES, k + u);
    const positions = 1 + ((k * 7 + u) % 4);
    const { id } = job(unit, day, pick(SHIFTS, k + u * 3), f, k, 'ABERTA', positions);
    // Parte já aceita: nenhuma, metade ou todas as posições; vaga cheia às vezes tem alguém na reserva.
    const accepted = [0, Math.ceil(positions / 2), positions][(k + u) % 3];
    for (let a = 0; a < accepted + (accepted === positions && k % 4 === 0 ? 1 : 0); a++) {
      const w = nextFree(day);
      if (!w) break;
      const appId = randomUUID();
      const approved = a < accepted;
      apps.push([appId, id, w.id, approved ? 'APROVADA' : 'PENDENTE']);
      if (!approved) continue;
      take(w, day);
      sessions.push([randomUUID(), appId, 'AGUARDANDO_CHECKIN', 0, null, null, null]);
    }
  }
});

// ---------- diárias concluídas (dia 1º até ontem): metade dos profissionais tem valor a receber ----------
const pastDays = [];
for (let d = firstPast; d < today; d = addDays(d, 1)) pastDays.push(d);
if (pastDays.length) {
  for (const w of workers.slice(0, WORKERS / 2)) {
    for (let j = 0; j < 1 + (w.n % 4); j++) {
      const day = pick(pastDays, w.n * 3 + j * 5);
      if (!free(w, day)) continue;
      take(w, day);
      const unit = pick(units, w.n + j * 11);
      const f = pick(FUNCOES, w.n + j);
      const shift = pick(SHIFTS, w.n + j);
      const { id } = job(unit, day, shift, f, w.n + j, 'ENCERRADA', 1);
      const appId = randomUUID();
      const sid = randomUUID();
      apps.push([appId, id, w.id, 'APROVADA']);
      sessions.push([sid, appId, 'FINALIZADA', 1, 345, 15, 'GPS_VALIDADO']);
      const ev = (type, t) => events.push([randomUUID(), sid, type, w.id, t, unit.lat, unit.lng, 20, unit.lat, unit.lng, 12, 300, 'GPS_VALIDADO']);
      const start = at(day, shift[0]);
      ev('CHECK_IN', new Date(start.getTime() + 3 * 60e3));
      ev('PAUSE_START', new Date(start.getTime() + 3 * 3600e3));
      ev('PAUSE_END', new Date(start.getTime() + 3 * 3600e3 + 15 * 60e3));
      ev('CHECK_OUT', at(day, shift[1]));
      confirms.push([appId, 'CONCLUIDA', admin.id]);
      // Quebra de caixa em parte das diárias de caixa (abate do A receber, com o motivo).
      if (f.cashier && Math.floor((w.n + j) / FUNCOES.length) % 2 === 0) breaks.push([randomUUID(), appId, w.id, unit.id, 5 + ((w.n * 7) % 8) * 5, pick(MOTIVOS, w.n), admin.id]);
    }
  }
}

await bulk('jobs', ['id', 'unit_id', 'title', 'description', 'starts_at', 'ends_at', 'positions', 'daily_value', 'break_count', 'break_minutes', 'status', 'is_cashier', 'created_by'], jobs);
await bulk('applications', ['id', 'job_id', 'user_id', 'status'], apps);
await bulk('work_sessions', ['id', 'application_id', 'status', 'breaks_used', 'worked_min', 'break_min', 'sources'], sessions);
await bulk('presence_events', ['id', 'work_session_id', 'type', 'actor_user_id', 'occurred_at', 'lat', 'lng', 'accuracy_m', 'unit_lat', 'unit_lng', 'distance_m', 'radius_m', 'validation'], events);
await bulk('daily_confirmations', ['application_id', 'result', 'confirmed_by'], confirms);
await bulk('cash_breaks', ['id', 'application_id', 'user_id', 'unit_id', 'amount', 'reason', 'created_by'], breaks);

const future = jobs.filter((j) => j[10] === 'ABERTA');
console.log(JSON.stringify({
  profissionais: workers.length, lojas: units.length, vagasFuturas: future.length, aceitasFuturas: sessions.filter((s) => s[2] === 'AGUARDANDO_CHECKIN').length,
  reserva: apps.filter((a) => a[3] === 'PENDENTE').length, diariasConcluidas: confirms.length, quebrasDeCaixa: breaks.length, ate: lastDay,
}));
await closeDb();
process.exit(0);
