import express from "express";
import { all } from "../db.js";
import { requireAuth } from "../middleware/auth.js";

const router = express.Router();

function toMinutes(hhmm) {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

/** Overlap (in minutes) + the clipped [start,end] window between two same-day slots. */
function overlapSlot(a, b) {
  const aStart = toMinutes(a.start_time), aEnd = toMinutes(a.end_time);
  const bStart = toMinutes(b.start_time), bEnd = toMinutes(b.end_time);
  const start = Math.max(aStart, bStart);
  const end = Math.min(aEnd, bEnd);
  if (end <= start) return null;
  const toHHMM = (mins) => `${String(Math.floor(mins / 60)).padStart(2, "0")}:${String(mins % 60).padStart(2, "0")}`;
  return { day_of_week: a.day_of_week, start_time: toHHMM(start), end_time: toHHMM(end), minutes: end - start };
}

async function loadUserSkillsMap() {
  const rows = await all(
    `SELECT us.user_id, us.type, s.id as skill_id, s.name, s.category, s.emoji
     FROM user_skills us JOIN skills s ON s.id = us.skill_id`
  );
  const map = new Map();
  for (const r of rows) {
    if (!map.has(r.user_id)) map.set(r.user_id, { teach: [], learn: [] });
    map.get(r.user_id)[r.type].push({ id: r.skill_id, name: r.name, category: r.category, emoji: r.emoji });
  }
  return map;
}

async function loadAvailabilityMap() {
  const rows = await all(`SELECT user_id, day_of_week, start_time, end_time FROM availability`);
  const map = new Map();
  for (const r of rows) {
    if (!map.has(r.user_id)) map.set(r.user_id, []);
    map.get(r.user_id).push(r);
  }
  return map;
}

/**
 * Core matching computation, reused by both GET /api/matches and the
 * notifications summary (which just needs the count).
 *
 * Rule: candidate qualifies if (their teach ∩ my learn) OR (their learn ∩ my teach)
 * is non-empty, AND at least one availability slot overlaps on day_of_week + time.
 * Sorted by total overlapping minutes (proxy for "number of overlapping slots"), desc.
 */
export async function computeMatches(meId, { skillFilter = null, dayFilter = null } = {}) {
  const skillsMap = await loadUserSkillsMap();
  const availMap = await loadAvailabilityMap();

  const mine = skillsMap.get(meId) || { teach: [], learn: [] };
  const myAvail = availMap.get(meId) || [];
  const myLearnIds = new Set(mine.learn.map((s) => s.id));

  const users = await all(
    `SELECT id, username, avatar_url, bio FROM users WHERE id != $1 AND onboarded = 1 AND username IS NOT NULL`,
    [meId]
  );

  const results = [];
  for (const user of users) {
    const theirs = skillsMap.get(user.id) || { teach: [], learn: [] };
    const theyTeachIWantToLearn = theirs.teach.filter((s) => myLearnIds.has(s.id));
    const iTeachTheyWantToLearn = mine.teach.filter((s) => new Set(theirs.learn.map((x) => x.id)).has(s.id));

    if (theyTeachIWantToLearn.length === 0 && iTeachTheyWantToLearn.length === 0) continue;

    const theirAvail = availMap.get(user.id) || [];
    const overlaps = [];
    for (const mySlot of myAvail) {
      for (const theirSlot of theirAvail) {
        if (mySlot.day_of_week !== theirSlot.day_of_week) continue;
        const o = overlapSlot(mySlot, theirSlot);
        if (o) overlaps.push(o);
      }
    }
    if (overlaps.length === 0) continue;

    if (skillFilter && !theyTeachIWantToLearn.some((s) => s.id === skillFilter) && !iTeachTheyWantToLearn.some((s) => s.id === skillFilter)) {
      continue;
    }
    if (dayFilter !== null && !overlaps.some((o) => o.day_of_week === dayFilter)) continue;

    const totalMinutes = overlaps.reduce((sum, o) => sum + o.minutes, 0);
    results.push({
      user,
      theyCanTeachYou: theyTeachIWantToLearn,
      youCanTeach: iTeachTheyWantToLearn,
      overlaps: overlaps.sort((a, b) => a.day_of_week - b.day_of_week),
      overlapCount: overlaps.length,
      overlapMinutes: totalMinutes,
    });
  }

  results.sort((a, b) => b.overlapMinutes - a.overlapMinutes || b.overlapCount - a.overlapCount);
  return results;
}

router.get("/", requireAuth, async (req, res) => {
  const skillFilter = req.query.skill ? Number(req.query.skill) : null;
  const dayFilter = req.query.day !== undefined && req.query.day !== "" ? Number(req.query.day) : null;
  const matches = await computeMatches(req.userId, { skillFilter, dayFilter });
  res.json({ matches });
});

router.get("/:userId", requireAuth, async (req, res) => {
  const targetId = Number(req.params.userId);
  const meId = req.userId;
  const skillsMap = await loadUserSkillsMap();
  const availMap = await loadAvailabilityMap();

  const mine = skillsMap.get(meId) || { teach: [], learn: [] };
  const theirs = skillsMap.get(targetId) || { teach: [], learn: [] };
  const myLearnIds = new Set(mine.learn.map((s) => s.id));
  const theirLearnIds = new Set(theirs.learn.map((s) => s.id));

  const theyCanTeachYou = theirs.teach.filter((s) => myLearnIds.has(s.id));
  const youCanTeach = mine.teach.filter((s) => theirLearnIds.has(s.id));

  const myAvail = availMap.get(meId) || [];
  const theirAvail = availMap.get(targetId) || [];
  const overlaps = [];
  for (const mySlot of myAvail) {
    for (const theirSlot of theirAvail) {
      if (mySlot.day_of_week !== theirSlot.day_of_week) continue;
      const o = overlapSlot(mySlot, theirSlot);
      if (o) overlaps.push(o);
    }
  }

  const user = await all(`SELECT id, username, avatar_url, bio FROM users WHERE id = $1`, [targetId]);
  res.json({
    user: user[0] || null,
    theyCanTeachYou,
    youCanTeach,
    overlaps: overlaps.sort((a, b) => a.day_of_week - b.day_of_week),
  });
});

export default router;
