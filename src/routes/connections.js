import express from "express";
import { all, get, run } from "../db.js";
import { requireAuth } from "../middleware/auth.js";

const router = express.Router();

function makeMeetLink(id) {
  return `https://meet.google.com/timeswap-${id.toString(36)}-swap`;
}

const CONN_SELECT = `
  SELECT c.id, c.requester_id, c.receiver_id, c.status, c.meet_link, c.created_at, c.updated_at,
         s.id as skill_id, s.name as skill_name, s.emoji as skill_emoji,
         ru.username as requester_username, ru.avatar_url as requester_avatar,
         cu.username as receiver_username, cu.avatar_url as receiver_avatar
  FROM connections c
  LEFT JOIN skills s ON s.id = c.skill_id
  JOIN users ru ON ru.id = c.requester_id
  JOIN users cu ON cu.id = c.receiver_id
`;

router.get("/", requireAuth, async (req, res) => {
  const meId = req.userId;
  const sent = await all(`${CONN_SELECT} WHERE c.requester_id = $1 ORDER BY c.created_at DESC`, [meId]);
  const received = await all(`${CONN_SELECT} WHERE c.receiver_id = $1 ORDER BY c.created_at DESC`, [meId]);
  res.json({ sent, received });
});

/** POST /api/connections  { receiverId, skillId } */
router.post("/", requireAuth, async (req, res) => {
  const meId = req.userId;
  const { receiverId, skillId } = req.body;
  if (!receiverId) return res.status(400).json({ error: "receiverId is required" });
  if (Number(receiverId) === meId) return res.status(400).json({ error: "You can't connect with yourself" });

  // Split into two type-safe queries instead of one query with an ambiguous
  // "$N IS NULL" branch — Postgres can't infer a parameter's type when it's
  // only ever compared to NULL, and throws 42P18 ("indeterminate_datatype").
  // SQLite doesn't enforce this, so the old version worked locally but broke
  // in production.
  const existing = skillId
    ? await get(
        `SELECT * FROM connections WHERE requester_id = $1 AND receiver_id = $2 AND skill_id = $3`,
        [meId, receiverId, skillId]
      )
    : await get(
        `SELECT * FROM connections WHERE requester_id = $1 AND receiver_id = $2 AND skill_id IS NULL`,
        [meId, receiverId]
      );
  if (existing) return res.status(200).json({ connection: existing, already: true });

  const result = await run(
    `INSERT INTO connections (requester_id, receiver_id, skill_id, status) VALUES ($1,$2,$3,'pending') RETURNING *`,
    [meId, receiverId, skillId || null]
  );
  let connection = result.rows[0];
  if (!connection) {
    connection = await get(`SELECT * FROM connections WHERE id = $1`, [result.lastID]);
  }
  res.status(201).json({ connection });
});

/** PATCH /api/connections/:id  { status: 'accepted' | 'declined' } */
router.patch("/:id", requireAuth, async (req, res) => {
  const meId = req.userId;
  const { status } = req.body;
  if (!["accepted", "declined"].includes(status)) {
    return res.status(400).json({ error: "status must be 'accepted' or 'declined'" });
  }
  const conn = await get(`SELECT * FROM connections WHERE id = $1`, [req.params.id]);
  if (!conn) return res.status(404).json({ error: "Connection not found" });
  if (conn.receiver_id !== meId) return res.status(403).json({ error: "Only the receiver can respond" });

  const meetLink = status === "accepted" ? makeMeetLink(conn.id) : null;
  await run(
    `UPDATE connections SET status = $1, meet_link = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $3`,
    [status, meetLink, req.params.id]
  );
  const updated = await get(`${CONN_SELECT} WHERE c.id = $1`, [req.params.id]);
  res.json({ connection: updated });
});

/**
 * DELETE /api/connections/:id
 * - Pending: only the requester can cancel it.
 * - Accepted: either side can end/disconnect it (also clears the chat history,
 *   via ON DELETE CASCADE on messages).
 * - Declined: either side can clear it from their list.
 */
router.delete("/:id", requireAuth, async (req, res) => {
  const meId = req.userId;
  const conn = await get(`SELECT * FROM connections WHERE id = $1`, [req.params.id]);
  if (!conn) return res.status(404).json({ error: "Connection not found" });

  const isParticipant = conn.requester_id === meId || conn.receiver_id === meId;
  if (!isParticipant) return res.status(403).json({ error: "You're not part of this connection" });

  if (conn.status === "pending" && conn.requester_id !== meId) {
    return res.status(403).json({ error: "Only the requester can cancel a pending request" });
  }

  await run(`DELETE FROM connections WHERE id = $1`, [req.params.id]);
  res.json({ ok: true });
});

export default router;