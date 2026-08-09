import express from "express";
import { all } from "../db.js";
import { requireAuth } from "../middleware/auth.js";

const router = express.Router();

router.get("/", requireAuth, async (req, res) => {
  const skills = await all(`SELECT id, name, category, emoji FROM skills ORDER BY category, name`);
  res.json({ skills });
});

export default router;
