import express from "express";
import { get, run } from "../db.js";
import { signSession, requireAuth } from "../middleware/auth.js";

const router = express.Router();
const ALLOWED_DOMAIN = process.env.ALLOWED_EMAIL_DOMAIN || "vitstudent.ac.in";

let firebaseAdmin = null;
if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
  try {
    const admin = await import("firebase-admin");
    const creds = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
    admin.default.initializeApp({ credential: admin.default.credential.cert(creds) });
    firebaseAdmin = admin.default;
  } catch (err) {
    console.warn("Firebase admin not initialized:", err.message);
  }
}

async function upsertUser({ google_id, email, avatar_url }) {
  let user = await get(`SELECT * FROM users WHERE google_id = $1 OR email = $2`, [google_id, email]);
  if (!user) {
    const res = await run(
      `INSERT INTO users (google_id, email, avatar_url) VALUES ($1,$2,$3) RETURNING *`,
      [google_id, email, avatar_url || null]
    );
    user = res.rows[0] || (await get(`SELECT * FROM users WHERE google_id = $1`, [google_id]));
  }
  return user;
}

/**
 * POST /api/auth/google
 * Body: { idToken }  -- a Firebase ID token from "Sign in with Google" on the client.
 * Verifies the token, enforces the @vitstudent.ac.in domain, upserts the user,
 * and returns our own short-lived-refreshable session JWT.
 */
router.post("/google", async (req, res) => {
  const { idToken } = req.body;
  if (!idToken) return res.status(400).json({ error: "idToken is required" });

  try {
    let google_id, email, avatar_url;

    if (firebaseAdmin) {
      const decoded = await firebaseAdmin.auth().verifyIdToken(idToken);
      google_id = decoded.uid;
      email = decoded.email;
      avatar_url = decoded.picture;
    } else {
      // DEMO MODE: no Firebase service account configured on the backend.
      // The frontend firebase.js still runs the real Google OAuth popup;
      // here we just trust the decoded client-side payload for local demos.
      // Replace with real firebase-admin verification in production.
      const payload = JSON.parse(Buffer.from(idToken.split(".")[1] || "", "base64").toString("utf-8") || "{}");
      google_id = payload.uid || payload.sub || payload.email;
      email = payload.email;
      avatar_url = payload.picture;
      if (!email) return res.status(400).json({ error: "Could not read email from token" });
    }

    if (!email.endsWith(`@${ALLOWED_DOMAIN}`)) {
      return res.status(403).json({ error: `Only @${ALLOWED_DOMAIN} accounts can sign in to TimeSwap.` });
    }

    const user = await upsertUser({ google_id, email, avatar_url });
    const token = signSession(user);
    res.json({ token, user });
  } catch (err) {
    console.error(err);
    res.status(401).json({ error: "Sign-in failed. Please try again." });
  }
});

/**
 * POST /api/auth/dev-login
 * Demo-only convenience endpoint so reviewers can explore the product without
 * wiring a real Firebase project. Disabled automatically once
 * FIREBASE_SERVICE_ACCOUNT_JSON is set (i.e. in a real deployment).
 * Body: { email }  e.g. "aisha.k@vitstudent.ac.in"
 */
router.post("/dev-login", async (req, res) => {
  if (firebaseAdmin) return res.status(404).json({ error: "Dev login disabled in production" });
  const { email } = req.body;
  if (!email || !email.endsWith(`@${ALLOWED_DOMAIN}`)) {
    return res.status(403).json({ error: `Only @${ALLOWED_DOMAIN} accounts can sign in to TimeSwap.` });
  }
  const google_id = `dev_${email}`;
  const avatar_url = `https://api.dicebear.com/9.x/notionists/svg?seed=${encodeURIComponent(email)}`;
  const user = await upsertUser({ google_id, email, avatar_url });
  const token = signSession(user);
  res.json({ token, user });
});

router.get("/me", requireAuth, async (req, res) => {
  const user = await get(`SELECT * FROM users WHERE id = $1`, [req.userId]);
  if (!user) return res.status(404).json({ error: "User not found" });
  res.json({ user });
});

export default router;
