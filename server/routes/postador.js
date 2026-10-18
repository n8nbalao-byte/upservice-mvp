// Configurações → WhatsApp → Postador de vagas (só o administrador principal): liga/desliga, escolhe o grupo de cada
// loja (com sugestão pelo nome) e posta na hora as vagas abertas de uma loja.
import { Router } from 'express';
import { audit } from '../audit.js';
import { requireOwner } from '../auth.js';
import { q } from '../db.js';
import { fail } from '../http.js';
import { ignorarAbertas, postadorConfig, postarLoja, sugerirGrupos } from '../postador.js';
import { connectedNumber, listGroups } from '../whatsapp.js';

const r = Router();

r.get('/admin/postador', requireOwner, async (req, res) => {
  const units = await q(
    `SELECT un.id, un.code, un.name, un.whatsapp_group AS \`group\`, un.whatsapp_group_name AS groupName,
            (SELECT COUNT(*) FROM vagas_postagens p WHERE p.unit_id = un.id AND p.status IN ('PENDENTE', 'ERRO')) AS pendentes,
            (SELECT MAX(p.posted_at) FROM vagas_postagens p WHERE p.unit_id = un.id) AS ultimaPostagem
     FROM units un WHERE un.status = 'ATIVA' ORDER BY un.code`,
  );
  res.json({ enabled: !!(await postadorConfig()).enabled, numero: await connectedNumber(), units });
});

// Grupos do número conectado + sugestão de grupo para cada loja (pelo nome).
r.get('/admin/postador/grupos', requireOwner, async (req, res) => {
  const groups = await listGroups();
  const units = await q("SELECT id, name FROM units WHERE status = 'ATIVA'");
  res.json({ groups, sugestoes: sugerirGrupos(units, groups) });
});

r.put('/admin/postador', requireOwner, async (req, res) => {
  const enabled = req.body.enabled === true;
  const before = await postadorConfig();
  // Primeira vez: as vagas que já estavam abertas não vão todas de uma vez para os grupos.
  if (enabled && !before.enabled) await ignorarAbertas();
  await q("INSERT INTO app_settings (name, value, updated_by) VALUES ('postador', ?, ?) ON DUPLICATE KEY UPDATE value = VALUES(value), updated_by = VALUES(updated_by)", [JSON.stringify({ enabled }), req.user.id]);
  await audit(q, req, 'POSTADOR', 'app_settings', 'postador', { before: { enabled: !!before.enabled }, after: { enabled } });
  res.json({ enabled });
});

r.put('/admin/postador/unidades/:id', requireOwner, async (req, res) => {
  const group = req.body.group ? String(req.body.group) : null;
  if (group && !/^[\d-]+@g\.us$/.test(group)) fail(400, 'Grupo do WhatsApp inválido.');
  const name = group ? String(req.body.groupName ?? '').slice(0, 120) || null : null;
  const [un] = await q('SELECT whatsapp_group FROM units WHERE id = ?', [req.params.id]);
  if (!un) fail(404, 'Loja não encontrada.');
  await q('UPDATE units SET whatsapp_group = ?, whatsapp_group_name = ? WHERE id = ?', [group, name, req.params.id]);
  await audit(q, req, 'UNIT_WHATSAPP_GROUP', 'unit', req.params.id, { before: { group: un.whatsapp_group }, after: { group, name } });
  res.json({ ok: true });
});

// "Postar agora": todas as vagas abertas (com posição livre) da loja, num resumo.
r.post('/admin/postador/unidades/:id/postar', requireOwner, async (req, res) => {
  const n = await postarLoja(req.params.id, { todas: true });
  await audit(q, req, 'POSTADOR_POSTAR', 'unit', req.params.id, { after: { vagas: n } });
  res.json({ postadas: n });
});

export default r;
