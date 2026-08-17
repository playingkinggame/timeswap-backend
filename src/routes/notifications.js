import express from "express";
import { all, get } from "../db.js";
import { requireAuth } from "../middleware/auth.js";
import { attachUnreadCounts } from "./connections.js";
import { computeMatches } from "./matches.js";

const router = express.Router();

/**
 * GET /api/notifications/summary
 * Lightweight counts for nav badges — meant to be polled every ~15-20s.
 */
router.get("/summary", requireAuth, async (req, res) => {
  const meId = req.userId;

  const pendingConnectionRequests = await get(
    `SELECT COUNT(*) as count FROM connections WHERE receiver_id = $1 AND status = 'pending'`,
    [meId]
  );

  const sent = await all(`SELECT id, status FROM connections WHERE requester_id = $1`, [meId]);
  const received = await all(`SELECT id, status FROM connections WHERE receiver_id = $1`, [meId]);
  const withUnread = await attachUnreadCounts([...sent, ...received], meId);
  const unreadMessages = withUnread.reduce((sum, c) => sum + c.unreadCount, 0);

  const pendingSessionRequests = await get(
    `SELECT COUNT(*) as count
     FROM session_requests sr JOIN sessions s ON s.id = sr.session_id
     WHERE s.host_id = $1 AND sr.status = 'pending'`,
    [meId]
  );

  const matches = await computeMatches(meId);

  res.json({
    pendingConnectionRequests: Number(pendingConnectionRequests?.count || 0),
    unreadMessages,
    pendingSessionRequests: Number(pendingSessionRequests?.count || 0),
    matchCount: matches.length,
  });
});

export default router;
