import "dotenv/config";
import { all, get, run, backend } from "./db.js";

const SKILLS = [
  ["React", "Tech", "⚛️"], ["Python", "Tech", "🐍"], ["DSA", "Tech", "🧠"],
  ["UI/UX Design", "Design", "🎨"], ["Figma", "Design", "🖌️"], ["Photography", "Creative", "📷"],
  ["Video Editing", "Creative", "🎬"], ["Guitar", "Music", "🎸"], ["Piano", "Music", "🎹"],
  ["Public Speaking", "Soft Skills", "🎤"], ["Spanish", "Language", "💬"], ["German", "Language", "🗣️"],
  ["Chess", "Games", "♟️"], ["Machine Learning", "Tech", "🤖"], ["Excel & Finance", "Business", "📊"],
  ["Content Writing", "Creative", "✍️"], ["Competitive Coding", "Tech", "🏆"], ["Yoga", "Wellness", "🧘"],
  ["Cricket Coaching", "Sports", "🏏"], ["Basketball", "Sports", "🏀"], ["Dance (Freestyle)", "Creative", "💃"],
  ["Blender 3D", "Design", "🧊"], ["App Dev (Flutter)", "Tech", "📱"], ["Resume Building", "Soft Skills", "📄"],
];

const NAMES = [
  ["aditi.rao", "Aditi Rao"], ["rohan.mehta", "Rohan Mehta"], ["sneha.iyer", "Sneha Iyer"],
  ["kabir.shah", "Kabir Shah"], ["priya.nair", "Priya Nair"], ["arjun.reddy", "Arjun Reddy"],
  ["divya.krishnan", "Divya Krishnan"], ["vihaan.gupta", "Vihaan Gupta"], ["ananya.pillai", "Ananya Pillai"],
  ["karthik.subra", "Karthik Subramaniam"], ["meera.das", "Meera Das"], ["yash.agarwal", "Yash Agarwal"],
  ["ishita.bose", "Ishita Bose"], ["dev.patel", "Dev Patel"], ["nisha.menon", "Nisha Menon"],
  ["rahul.verma", "Rahul Verma"],
];

const BIOS = [
  "3rd year, CSE core. Coffee-powered debugger.",
  "Design minor, tech major. Always down to jam on side projects.",
  "Weekend musician, weekday engineer.",
  "Competitive programmer trying to become a decent speaker.",
  "Loves teaching as much as learning — swap me anything.",
  "Hostel block C. Usually free between classes.",
  "Trying to get better at the things I'm bad at.",
  "Here for the free time, staying for the free skills.",
];

function rand(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function randInt(a, b) { return a + Math.floor(Math.random() * (b - a + 1)); }
function pad(n) { return String(n).padStart(2, "0"); }

async function main() {
  console.log(`Seeding (${backend}) ...`);

  for (const [name, category, emoji] of SKILLS) {
    const existing = await get(`SELECT id FROM skills WHERE name = $1`, [name]);
    if (!existing) await run(`INSERT INTO skills (name, category, emoji) VALUES ($1,$2,$3)`, [name, category, emoji]);
  }
  const skills = await all(`SELECT * FROM skills`);
  const skillId = (name) => skills.find((s) => s.name === name).id;

  for (const [username, fullName] of NAMES) {
    const email = `${username}@vitstudent.ac.in`;
    const existing = await get(`SELECT id FROM users WHERE email = $1`, [email]);
    if (existing) continue;

    const avatar_url = `https://api.dicebear.com/9.x/notionists/svg?seed=${encodeURIComponent(fullName)}`;
    const bio = rand(BIOS);
    const result = await run(
      `INSERT INTO users (google_id, email, username, avatar_url, bio, onboarded) VALUES ($1,$2,$3,$4,$5,1) RETURNING *`,
      [`seed_${username}`, email, username, avatar_url, bio]
    );
    const user = result.rows[0] || (await get(`SELECT * FROM users WHERE email = $1`, [email]));

    // Each student teaches 2-3 skills, wants to learn 2-3 different skills.
    const shuffled = [...skills].sort(() => Math.random() - 0.5);
    const teach = shuffled.slice(0, randInt(2, 3));
    const learn = shuffled.slice(3, 3 + randInt(2, 3)).filter((s) => !teach.includes(s));

    for (const s of teach) {
      await run(`INSERT INTO user_skills (user_id, skill_id, type, level) VALUES ($1,$2,'teach',$3)`,
        [user.id, s.id, rand(["Intermediate", "Advanced", "Expert"])]);
    }
    for (const s of learn) {
      await run(`INSERT INTO user_skills (user_id, skill_id, type, level) VALUES ($1,$2,'learn',$3)`,
        [user.id, s.id, "Beginner"]);
    }

    // 3-5 availability windows across the week, 30-90 min each, campus hours.
    const numSlots = randInt(3, 5);
    for (let i = 0; i < numSlots; i++) {
      const day = randInt(0, 6);
      const startHour = randInt(9, 20);
      const startMin = rand([0, 30]);
      const durMin = rand([30, 60, 90]);
      const totalStart = startHour * 60 + startMin;
      const totalEnd = Math.min(totalStart + durMin, 21 * 60);
      const start_time = `${pad(Math.floor(totalStart / 60))}:${pad(totalStart % 60)}`;
      const end_time = `${pad(Math.floor(totalEnd / 60))}:${pad(totalEnd % 60)}`;
      await run(`INSERT INTO availability (user_id, day_of_week, start_time, end_time) VALUES ($1,$2,$3,$4)`,
        [user.id, day, start_time, end_time]);
    }
  }

  console.log(`Done. ${SKILLS.length} skills, ${NAMES.length} demo students seeded.`);
  console.log(`Try logging in as any of them via POST /api/auth/dev-login, e.g. { "email": "aditi.rao@vitstudent.ac.in" }`);
  process.exit(0);
}

main().catch((err) => { console.error(err); process.exit(1); });
