import { randomUUID } from 'node:crypto';

const json = (v) => (v === undefined ? null : JSON.stringify(v));

/** Append-only: o código nunca faz UPDATE/DELETE em audit_events. */
export function audit(q, req, action, entity, entityId, { before, after, reason } = {}) {
  return q(
    `INSERT INTO audit_events (id, actor_id, action, entity, entity_id, before_json, after_json, reason, request_id)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    [randomUUID(), req?.user?.id ?? null, action, entity, entityId ?? null, json(before), json(after), reason ?? null, req?.id ?? null],
  );
}
