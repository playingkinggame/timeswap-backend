import express from "express";
import { all, get, run } from "../db.js";
import { requireAuth } from "../middleware/auth.js";

const router = express.Router();

async function userSkills(userId) {
  const rows = await all(
    `SELECT us.type, us.level, s.id as skill_id, s.name, s.category, s.emoji
     FROM user_skills us JOIN skills s ON s.id = us.skill_id
     WHERE us.user_id = $1`,
    [userId]
  );
  return {
    teach: rows.filter((r) => r.type === "teach"),
    learn: rows.filter((r) => r.type === "learn"),
  };
}

async function userAvailability(userId) {
  return all(
    `SELECT id, day_of_week, start_time, end_time FROM availability WHERE user_id = $1 ORDER BY day_of_week, start_time`,
    [userId]
  );
}

async function fullProfile(userId) {
  const user = await get(`SELECT id, email, username, avatar_url, bio, onboarded, created_at FROM users WHERE id = $1`, [userId]);
  if (!user) return null;
  const skills = await userSkills(userId);
  const availability = await userAvailability(userId);
  return { ...user, skills, availability };
}

router.get("/me/profile", requireAuth, async (req, res) => {
  const profile = await fullProfile(req.userId);
  if (!profile) return res.status(404).json({ error: "Not found" });
  res.json({ profile });
});

router.get("/:id/profile", requireAuth, async (req, res) => {
  const profile = await fullProfile(Number(req.params.id));
  if (!profile) return res.status(404).json({ error: "Not found" });
  res.json({ profile });
});

router.get("/username-available/:username", requireAuth, async (req, res) => {
  const username = req.params.username.toLowerCase();
  const valid = /^[a-z0-9_]{3,20}$/.test(username);
  if (!valid) return res.json({ available: false, reason: "3-20 chars: letters, numbers, underscore" });
  const existing = await get(`SELECT id FROM users WHERE username = $1 AND id != $2`, [username, req.userId]);
  res.json({ available: !existing });
});

/**
 * PATCH /api/users/me/onboarding
 * Body: {
 *   username, bio,
 *   teach: [{ skillId, level }], learn: [{ skillId, level }],
 *   availability: [{ day_of_week, start_time, end_time }]
 * }
 * Replaces skills + availability wholesale (simple v1 onboarding write).
 */
router.patch("/me/onboarding", requireAuth, async (req, res) => {
  const { username, bio, teach = [], learn = [], availability = [] } = req.body;

  if (username) {
    const uname = String(username).toLowerCase();
    if (!/^[a-z0-9_]{3,20}$/.test(uname)) {
      return res.status(400).json({ error: "Username must be 3-20 chars: letters, numbers, underscore" });
    }
    const existing = await get(`SELECT id FROM users WHERE username = $1 AND id != $2`, [uname, req.userId]);
    if (existing) return res.status(409).json({ error: "Username already taken" });
    await run(`UPDATE users SET username = $1 WHERE id = $2`, [uname, req.userId]);
  }
  if (typeof bio === "string") {
    await run(`UPDATE users SET bio = $1 WHERE id = $2`, [bio, req.userId]);
  }

  await run(`DELETE FROM user_skills WHERE user_id = $1`, [req.userId]);
  for (const t of teach) {
    await run(
      `INSERT INTO user_skills (user_id, skill_id, type, level) VALUES ($1,$2,'teach',$3)`,
      [req.userId, t.skillId, t.level || "Intermediate"]
    );
  }
  for (const l of learn) {
    await run(
      `INSERT INTO user_skills (user_id, skill_id, type, level) VALUES ($1,$2,'learn',$3)`,
      [req.userId, l.skillId, l.level || "Beginner"]
    );
  }

  await run(`DELETE FROM availability WHERE user_id = $1`, [req.userId]);
  for (const slot of availability) {
    await run(
      `INSERT INTO availability (user_id, day_of_week, start_time, end_time) VALUES ($1,$2,$3,$4)`,
      [req.userId, slot.day_of_week, slot.start_time, slot.end_time]
    );
  }

  await run(`UPDATE users SET onboarded = 1 WHERE id = $1`, [req.userId]);
  const profile = await fullProfile(req.userId);
  res.json({ profile });
});

export default router;
