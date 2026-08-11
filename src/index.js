import "dotenv/config";
import express from "express";
import cors from "cors";
import { backend } from "./db.js";

import authRoutes from "./routes/auth.js";
import userRoutes from "./routes/users.js";
import skillRoutes from "./routes/skills.js";
import matchRoutes from "./routes/matches.js";
import connectionRoutes from "./routes/connections.js";
import sessionRoutes from "./routes/sessions.js";

const app = express();
app.use(cors());
app.use(express.json());

app.get("/api/health", (req, res) => res.json({ ok: true, db: backend }));

app.use("/api/auth", authRoutes);
app.use("/api/users", userRoutes);
app.use("/api/skills", skillRoutes);
app.use("/api/matches", matchRoutes);
app.use("/api/connections", connectionRoutes);
app.use("/api/sessions", sessionRoutes);

app.use((req, res) => res.status(404).json({ error: "Not found" }));
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: "Internal server error" });
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`TimeSwap API listening on :${PORT} (db: ${backend})`);
});