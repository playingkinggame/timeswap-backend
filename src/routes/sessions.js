import express from "express";
import { all, get, run } from "../db.js";
import { requireAuth } from "../middleware/auth.js";

const router = express.Router();

const SESSION_SELECT = `
  SELECT s.id, s.title, s.location, s.session_date, s.start_time, s.end_time, s.notes, s.created_at,
         s.host_id, u.username as host_username, u.avatar_url as host_avatar
  FROM sessions s JOIN users u ON u.id = s.host_id
`;

async function attachRequestInfo(sessions, meId) {
  if (sessions.length === 0) return sessions;
  const ids = sessions.map((s) => s.id);
  const placeholders = ids.map((_, i) => `$${i + 1}`).join(",");
  const requests = await all(
    `SELECT sr.id, sr.session_id, sr.status, sr.requester_id, u.username, u.avatar_url
     FROM session_requests sr JOIN users u ON u.id = sr.requester_id
     WHERE sr.session_id IN (${placeholders})`,
    ids
  );
  const bySession = new Map();
  for (const r of requests) {
    if (!bySession.has(r.session_id)) bySession.set(r.session_id, []);
    bySession.get(r.session_id).push(r);
  }
  return sessions.map((s) => {
    const reqs = bySession.get(s.id) || [];
    const mine = reqs.find((r) => r.requester_id === meId);
    return {
      ...s,
      requests: s.host_id === meId ? reqs : undefined,
      pendingCount: reqs.filter((r) => r.status === "pending").length,
      myRequestStatus: mine?.status || null,
    };
  });
}

/**
 * GET /api/sessions
 * The public browse feed: other students' upcoming, not-yet-passed sessions.
 * Query: date=YYYY-MM-DD to filter a single day.
 */
router.get("/", requireAuth, async (req, res) => {
  const meId = req.userId;
  const today = new Date().toISOString().slice(0, 10);
  const { date } = req.query;

  let query = `${SESSION_SELECT} WHERE s.host_id != $1 AND s.session_date >= $2`;
  const params = [meId, today];
  if (date) {
    query += ` AND s.session_date = $3`;
    params.push(date);
  }
  query += ` ORDER BY s.session_date ASC, s.start_time ASC`;

  const sessions = await all(query, params);
  const withInfo = await attachRequestInfo(sessions, meId);
  res.json({ sessions: withInfo });
});

/** GET /api/sessions/mine — sessions I'm hosting, and sessions I've joined. */
router.get("/mine", requireAuth, async (req, res) => {
  const meId = req.userId;
  const hosting = await all(`${SESSION_SELECT} WHERE s.host_id = $1 ORDER BY s.session_date ASC, s.start_time ASC`, [meId]);
  const hostingWithInfo = await attachRequestInfo(hosting, meId);

  const joined = await all(
    `${SESSION_SELECT}
     JOIN session_requests sr ON sr.session_id = s.id
     WHERE sr.requester_id = $1 AND sr.status = 'accepted'
     ORDER BY s.session_date ASC, s.start_time ASC`,
    [meId]
  );

  res.json({ hosting: hostingWithInfo, joined });
});

/** POST /api/sessions  { title, location, session_date, start_time, end_time, notes } */
router.post("/", requireAuth, async (req, res) => {
  const { title, location, session_date, start_time, end_time, notes } = req.body;
  if (!title?.trim() || !location?.trim() || !session_date || !start_time || !end_time) {
    return res.status(400).json({ error: "title, location, session_date, start_time and end_time are required" });
  }
  if (end_time <= start_time) {
    return res.status(400).json({ error: "end_time must be after start_time" });
  }
  const result = await run(
    `INSERT INTO sessions (host_id, title, location, session_date, start_time, end_time, notes)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [req.userId, title.trim(), location.trim(), session_date, start_time, end_time, notes?.trim() || ""]
  );
  let session = result.rows[0];
  if (!session) session = await get(`SELECT * FROM sessions WHERE id = $1`, [result.lastID]);
  res.status(201).json({ session });
});

/** DELETE /api/sessions/:id — host can cancel their own posted session. */
router.delete("/:id", requireAuth, async (req, res) => {
  const session = await get(`SELECT * FROM sessions WHERE id = $1`, [req.params.id]);
  if (!session) return res.status(404).json({ error: "Session not found" });
  if (session.host_id !== req.userId) return res.status(403).json({ error: "Only the host can cancel this" });
  await run(`DELETE FROM sessions WHERE id = $1`, [req.params.id]);
  res.json({ ok: true });
});

/** POST /api/sessions/:id/requests — ask to join a session. */
router.post("/:id/requests", requireAuth, async (req, res) => {
  const meId = req.userId;
  const session = await get(`SELECT * FROM sessions WHERE id = $1`, [req.params.id]);
  if (!session) return res.status(404).json({ error: "Session not found" });
  if (session.host_id === meId) return res.status(400).json({ error: "You're hosting this session" });

  const existing = await get(
    `SELECT * FROM session_requests WHERE session_id = $1 AND requester_id = $2`,
    [req.params.id, meId]
  );
  if (existing) return res.status(200).json({ request: existing, already: true });

  const result = await run(
    `INSERT INTO session_requests (session_id, requester_id, status) VALUES ($1,$2,'pending') RETURNING *`,
    [req.params.id, meId]
  );
  let request = result.rows[0];
  if (!request) request = await get(`SELECT * FROM session_requests WHERE id = $1`, [result.lastID]);
  res.status(201).json({ request });
});

/** PATCH /api/sessions/:id/requests/:requestId  { status: 'accepted' | 'declined' } — host only. */
router.patch("/:id/requests/:requestId", requireAuth, async (req, res) => {
  const meId = req.userId;
  const { status } = req.body;
  if (!["accepted", "declined"].includes(status)) {
    return res.status(400).json({ error: "status must be 'accepted' or 'declined'" });
  }
  const session = await get(`SELECT * FROM sessions WHERE id = $1`, [req.params.id]);
  if (!session) return res.status(404).json({ error: "Session not found" });
  if (session.host_id !== meId) return res.status(403).json({ error: "Only the host can respond to requests" });

  await run(
    `UPDATE session_requests SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 AND session_id = $3`,
    [status, req.params.requestId, req.params.id]
  );
  const updated = await get(
    `SELECT sr.*, u.username, u.avatar_url FROM session_requests sr JOIN users u ON u.id = sr.requester_id WHERE sr.id = $1`,
    [req.params.requestId]
  );
  res.json({ request: updated });
});

export default router;
