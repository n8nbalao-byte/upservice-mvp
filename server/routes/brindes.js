// Brinde sorteado por dia: o administrador cadastra no calendário (boné, camiseta, celular...) para uma unidade ou
// todas. Concorre quem fez 3 estrelas naquele dia (na unidade do brinde). O sorteio roda às 9h do dia seguinte, pela
// varredura periódica; o ganhador é avisado no app e pelo WhatsApp, os outros participantes recebem o resultado no app.
import { randomInt, randomUUID } from 'node:crypto';
import { Router } from 'express';
import { audit } from '../audit.js';
import { assertUnit, requireRole, unitScope } from '../auth.js';
import { q, tx } from '../db.js';
import { fail, text } from '../http.js';
import { sendWhatsappSafe } from '../whatsapp.js';
import { diaries } from './estrelas.js';

const r = Router();
const dateOf = (d) => new Date(d).toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });
const ddmm = (k) => `${k.slice(8, 10)}/${k.slice(5, 7)}`;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
/** "Maria Souza Lima" → "Maria L." (o resultado é visto por todos). */
export const nomeCurto = (n) => { const p = String(n).trim().split(/\s+/); return p.length > 1 ? `${p[0]} ${p.at(-1)[0]}.` : p[0]; };
/** O brinde do dia D é sorteado a partir das 9h (Brasília, UTC−3) de D+1: sorteável se D <= esta data. */
export const ultimoDiaSorteavel = (now = Date.now()) => dateOf(now - 33 * 3600e3);

const SELECT = `SELECT b.id, DATE_FORMAT(b.day, '%Y-%m-%d') AS day, b.unit_id AS unitId, un.code AS unitCode, un.name AS unitName, b.premio, b.status,
  b.participants, b.drawn_at AS drawnAt, b.winner_user_id AS winnerId, w.name AS winnerName
  FROM brindes b LEFT JOIN units un ON un.id = b.unit_id LEFT JOIN users w ON w.id = b.winner_user_id`;
const shape = ({ winnerName, ...b }) => ({ ...b, winner: winnerName ? nomeCurto(winnerName) : null });

/** Brindes de um período (sem os cancelados). Com unidade: os dela e os de todas as unidades. `scope`: filtro SQL
 *  extra sobre b.unit_id (o gestor só vê os de todas as unidades e os das lojas dele). */
export async function brindesEntre(from, to, unitId, scope = ['1 = 1', []]) {
  const rows = await q(
    `${SELECT} WHERE b.day BETWEEN ? AND ? AND b.status <> 'CANCELADO'${unitId ? ' AND (b.unit_id IS NULL OR b.unit_id = ?)' : ''}
     AND (b.unit_id IS NULL OR ${scope[0]}) ORDER BY b.day, b.created_at`,
    [from, to, ...(unitId ? [unitId] : []), ...scope[1]],
  );
  return rows.map(shape);
}

r.get('/manage/brindes', requireRole('GESTOR', 'ADMINISTRADOR'), async (req, res) => {
  const { from, to, unitId } = req.query;
  if (!DAY.test(from ?? '') || !DAY.test(to ?? '')) fail(400, 'Período inválido.');
  if (unitId) await assertUnit(req.user, unitId);
  const items = await brindesEntre(from, to, unitId || null, unitScope(req.user, 'b.unit_id'));
  res.json({ items: items.map(({ winnerId: _, ...b }) => b) });
});

r.post('/admin/brindes', requireRole('ADMINISTRADOR'), async (req, res) => {
  const day = String(req.body.day ?? '');
  if (!DAY.test(day) || dateOf(`${day}T12:00:00-03:00`) !== day) fail(400, 'Dia inválido.');
  if (day < dateOf(Date.now())) fail(400, 'Escolha hoje ou um dia futuro.');
  const premio = text(req.body.premio, 'prêmio', { min: 2, max: 120 });
  const unitId = req.body.unitId || null;
  if (unitId && !(await q('SELECT id FROM units WHERE id = ?', [unitId])).length) fail(400, 'Unidade não encontrada.');
  const id = randomUUID();
  await tx(async (tq) => {
    await tq('INSERT INTO brindes SET ?', [{ id, day, unit_id: unitId, premio, created_by: req.user.id }]);
    await audit(tq, req, 'BRINDE_CRIADO', 'brinde', id, { after: { day, unitId, premio } });
  });
  res.status(201).json(shape((await q(`${SELECT} WHERE b.id = ?`, [id]))[0]));
});

r.delete('/admin/brindes/:id', requireRole('ADMINISTRADOR'), async (req, res) => {
  const done = await q("UPDATE brindes SET status = 'CANCELADO' WHERE id = ? AND status = 'AGENDADO'", [req.params.id]);
  if (!done.affectedRows) fail(409, 'Este brinde já foi sorteado ou cancelado.');
  await audit(q, req, 'BRINDE_CANCELADO', 'brinde', req.params.id, {});
  res.json({ ok: true });
});

/** Sorteia os brindes vencidos (chamado pela varredura). Cada brinde é travado e sorteado uma vez só. */
export async function sortearBrindes(now = Date.now()) {
  const due = await q("SELECT id, DATE_FORMAT(day, '%Y-%m-%d') AS day FROM brindes WHERE status = 'AGENDADO' AND day <= ?", [ultimoDiaSorteavel(now)]);
  for (const { id, day } of due) {
    // Quem fez 3 estrelas no dia (diária concluída). A janela larga cobre o fuso; o filtro é pela data de Brasília.
    const feitas = (await diaries('j.starts_at BETWEEN DATE_SUB(?, INTERVAL 1 DAY) AND DATE_ADD(?, INTERVAL 2 DAY)', [day, day]))
      .filter((d) => d.date === day && d.stars === 3);
    const zap = await tx(async (tq) => {
      const [b] = await tq("SELECT * FROM brindes WHERE id = ? AND status = 'AGENDADO' FOR UPDATE", [id]);
      if (!b) return null;
      const people = [...new Set(feitas.filter((d) => !b.unit_id || d.unitId === b.unit_id).map((d) => d.userId))];
      if (!people.length) {
        await tq("UPDATE brindes SET status = 'SEM_PARTICIPANTES', participants = 0, drawn_at = ? WHERE id = ?", [new Date(now), id]);
        return null;
      }
      const winner = people[randomInt(people.length)];
      await tq("UPDATE brindes SET status = 'SORTEADO', winner_user_id = ?, participants = ?, drawn_at = ? WHERE id = ?", [winner, people.length, new Date(now), id]);
      const [w] = await tq('SELECT name, whatsapp, whatsapp_verified_at FROM users WHERE id = ?', [winner]);
      const title = `Você ganhou o sorteio: ${b.premio}!`;
      const body = `Você fez 3 estrelas em ${ddmm(day)} e foi sorteado(a) entre ${people.length} participante(s). A UP Service vai combinar a entrega com você.`;
      const others = `Sorteio de ${b.premio} (${ddmm(day)}): ganhou ${nomeCurto(w.name)}`;
      const notes = people.map((u) => [randomUUID(), u, 'BRINDE', u === winner ? title : others, u === winner ? body : 'Obrigado por participar! Faça 3 estrelas nos próximos dias de brinde para concorrer de novo.', '/estrelas']);
      await tq('INSERT INTO notifications (id, user_id, kind, title, body, link) VALUES ?', [notes]);
      await audit(tq, null, 'BRINDE_SORTEADO', 'brinde', id, { after: { winner, participants: people.length } });
      // WhatsApp só para número confirmado (depois da transação).
      return w.whatsapp_verified_at && w.whatsapp ? () => sendWhatsappSafe(w.whatsapp, `UP Service: ${title} ${body}`) : null;
    });
    if (zap) await zap();
  }
}

export default r;
