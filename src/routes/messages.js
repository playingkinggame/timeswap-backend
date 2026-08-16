import express from "express";
import { all, get, run } from "../db.js";
import { requireAuth } from "../middleware/auth.js";

const router = express.Router();

async function loadParticipantConnection(connectionId, meId) {
  const conn = await get(`SELECT * FROM connections WHERE id = $1`, [connectionId]);
  if (!conn) return { error: [404, "Connection not found"] };
  if (conn.requester_id !== meId && conn.receiver_id !== meId) {
    return { error: [403, "You're not part of this connection"] };
  }
  if (conn.status !== "accepted") {
    return { error: [400, "Chat unlocks once the connection is accepted"] };
  }
  return { conn };
}

/** GET /api/connections/:id/messages */
router.get("/:id/messages", requireAuth, async (req, res) => {
  const { conn, error } = await loadParticipantConnection(req.params.id, req.userId);
  if (error) return res.status(error[0]).json({ error: error[1] });

  const messages = await all(
    `SELECT m.id, m.body, m.created_at, m.sender_id, u.username, u.avatar_url
     FROM messages m JOIN users u ON u.id = m.sender_id
     WHERE m.connection_id = $1
     ORDER BY m.created_at ASC`,
    [conn.id]
  );
  res.json({ messages });
});

/** POST /api/connections/:id/messages  { body } */
router.post("/:id/messages", requireAuth, async (req, res) => {
  const { conn, error } = await loadParticipantConnection(req.params.id, req.userId);
  if (error) return res.status(error[0]).json({ error: error[1] });

  const body = (req.body.body || "").trim().slice(0, 2000);
  if (!body) return res.status(400).json({ error: "Message can't be empty" });

  const result = await run(
    `INSERT INTO messages (connection_id, sender_id, body) VALUES ($1,$2,$3) RETURNING *`,
    [conn.id, req.userId, body]
  );
  let message = result.rows[0];
  if (!message) message = await get(`SELECT * FROM messages WHERE id = $1`, [result.lastID]);

  const withUser = await get(
    `SELECT m.id, m.body, m.created_at, m.sender_id, u.username, u.avatar_url
     FROM messages m JOIN users u ON u.id = m.sender_id WHERE m.id = $1`,
    [message.id]
  );
  res.status(201).json({ message: withUser });
});

export default router;
