import "dotenv/config";
import { all, run, backend } from "./db.js";

/**
 * Removes every seeded/demo account (google_id starting with "seed_" or
 * "dev_") and, via ON DELETE CASCADE, everything attached to them — their
 * skills, availability, connections, and sessions. Real users (real Google
 * sign-ins) are untouched.
 *
 * Run this once against your production database after you've onboarded
 * real students and no longer want the sample data cluttering the app:
 *
 *   npm run clear-demo
 */
async function main() {
  const demoUsers = await all(
    `SELECT id, username, email FROM users WHERE google_id LIKE 'seed_%' OR google_id LIKE 'dev_%'`
  );

  if (demoUsers.length === 0) {
    console.log("No seeded/demo accounts found — nothing to clear.");
    process.exit(0);
  }

  console.log(`Removing ${demoUsers.length} demo account(s) (${backend}):`);
  for (const u of demoUsers) console.log(`  - @${u.username || u.email}`);

  await run(`DELETE FROM users WHERE google_id LIKE 'seed_%' OR google_id LIKE 'dev_%'`);
  console.log("Done. Real user accounts were not touched.");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
