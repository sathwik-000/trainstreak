import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const { Pool } = pg;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.PORT || 4000);
const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error('DATABASE_URL is required.');
  process.exit(1);
}

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 5,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});

pool.on('error', (err) => console.error('PostgreSQL pool error:', err));

const defaults = [true, true, false, true, true, true, false];
const achievementDefs = [
  { id: 'first-workout', title: 'First Workout', icon: '🌱', desc: 'Log your first workout.', type: 'workouts', target: 1 },
  { id: 'streak-7', title: '7-Day Streak', icon: '🔥', desc: 'Reach a 7-day streak.', type: 'streak', target: 7 },
  { id: 'streak-14', title: '14-Day Streak', icon: '🔥', desc: 'Reach a 14-day streak.', type: 'streak', target: 14 },
  { id: 'streak-30', title: '30-Day Streak', icon: '🏆', desc: 'Reach a 30-day streak.', type: 'streak', target: 30 },
  { id: 'workouts-50', title: '50 Workouts', icon: '💪', desc: 'Log 50 workouts.', type: 'workouts', target: 50 },
  { id: 'workouts-100', title: '100 Workouts', icon: '👑', desc: 'Log 100 workouts.', type: 'workouts', target: 100 },
  { id: 'streak-100', title: '100-Day Streak', icon: '👑', desc: 'Reach a 100-day streak.', type: 'streak', target: 100 },
  { id: 'workouts-200', title: '200 Workouts', icon: '💪', desc: 'Log 200 workouts.', type: 'workouts', target: 200 }
];
const motivation = [
  '🔥 Keep the streak alive.', 'Show up. That’s the hardest part.', 'Consistency beats motivation.', 'One workout closer.', 'You’re becoming more consistent.', 'Don’t break the chain.', 'Future you will thank you.', 'Keep stacking wins.', 'Small action. Big momentum.', 'You showed up again.', 'Discipline looks good on you.', 'Another day, another win.', 'Your streak is getting stronger.', 'Make today count.', 'The habit is working.', 'One day at a time.', 'You’re building something that lasts.', 'Keep going. You’re closer.', 'Momentum favors consistency.', 'You kept your promise to yourself.', 'No perfect days required. Just keep showing up.', 'Your future self is cheering.', 'Progress loves repetition.', 'That’s how habits are built.', 'Strong habits, stronger you.', 'You’re making consistency automatic.', 'Keep the chain unbroken.', 'A little effort adds up.', 'Today’s win becomes tomorrow’s confidence.', 'One check-in. One step forward.', 'Your streak has momentum.', 'Another workout in the books.', 'You’re proving it to yourself.', 'Keep putting points on the board.', 'Consistency compounds.', 'You came through for yourself.', 'That’s another rep for your habit.', 'You’re not starting over—you’re continuing.', 'Stay in motion.', 'The streak is yours to protect.', 'Keep your promise today.', 'You are becoming the person who shows up.', 'Habits are built one ordinary day at a time.', 'Another brick in the foundation.', 'This is what discipline looks like.', 'You’re making future workouts easier.', 'Stay consistent, stay unstoppable.', 'Your streak tells a story. Keep writing it.', 'One more day. One more win.', 'Don’t wait for motivation. Create momentum.', 'You’re building proof that you can do this.'
];

function parseCookies(req) {
  const out = {};
  for (const part of String(req.headers.cookie || '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k) out[k] = decodeURIComponent(v.join('='));
  }
  return out;
}

async function ensureUser(req, res) {
  const cookies = parseCookies(req);
  let id = cookies.ts_user;
  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) {
    id = crypto.randomUUID();
    res.setHeader('Set-Cookie', `ts_user=${encodeURIComponent(id)}; Max-Age=31536000; Path=/; HttpOnly; SameSite=Lax`);
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const exists = await client.query('SELECT 1 FROM users WHERE id = $1', [id]);
    if (exists.rowCount === 0) {
      await client.query('INSERT INTO users (id) VALUES ($1)', [id]);
      await client.query('INSERT INTO user_settings (user_id) VALUES ($1)', [id]);
      for (let i = 0; i < 7; i++) {
        await client.query('INSERT INTO schedule (user_id, day, is_workout) VALUES ($1,$2,$3)', [id, i, defaults[i]]);
      }
      for (const a of achievementDefs) {
        await client.query('INSERT INTO achievements (user_id, achievement_id) VALUES ($1,$2)', [id, a.id]);
      }
    }
    await client.query('COMMIT');
    return id;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

const dateFormatter = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' });
const today = () => dateFormatter.format(new Date());
const isValidDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));
const toDate = (k) => new Date(`${k}T00:00:00`);
const addDays = (k, n) => { const d = toDate(k); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
const mondayIndex = (k) => (toDate(k).getDay() + 6) % 7;
const weekIndex = (k, startDay) => ((toDate(k).getDay() - startDay) + 7) % 7;
const monthRange = (k) => { const [y, m] = k.slice(0, 7).split('-').map(Number); return { start: `${y}-${String(m).padStart(2, '0')}-01`, end: new Date(y, m, 0).toISOString().slice(0, 10) }; };

async function settings(uid) {
  const r = await pool.query('SELECT * FROM user_settings WHERE user_id = $1', [uid]);
  return r.rows[0];
}
async function userSchedule(uid) {
  const r = await pool.query('SELECT day, is_workout FROM schedule WHERE user_id = $1 ORDER BY day', [uid]);
  return r.rows.map(x => !!x.is_workout);
}
async function monthData(uid, k) {
  const { start, end } = monthRange(k);
  const [w, r] = await Promise.all([
    pool.query('SELECT date, completed, workout_type AS "workoutType", note, created_at AS "createdAt" FROM workouts WHERE user_id=$1 AND date BETWEEN $2 AND $3 ORDER BY date', [uid, start, end]),
    pool.query('SELECT date, reason FROM rest_days WHERE user_id=$1 AND date BETWEEN $2 AND $3 ORDER BY date', [uid, start, end])
  ]);
  return { workouts: w.rows.map(x => ({ ...x, date: x.date instanceof Date ? x.date.toISOString().slice(0,10) : String(x.date).slice(0,10), completed: !!x.completed })), restDays: r.rows.map(x => ({ date: x.date instanceof Date ? x.date.toISOString().slice(0,10) : String(x.date).slice(0,10), reason: x.reason })), start, end };
}

async function streaks(uid) {
  const [wr, rr, sr] = await Promise.all([
    pool.query('SELECT date FROM workouts WHERE user_id=$1 AND completed=true', [uid]),
    pool.query('SELECT date FROM rest_days WHERE user_id=$1', [uid]),
    userSchedule(uid)
  ]);
  const ws = new Set(wr.rows.map(x => String(x.date).slice(0, 10)));
  const rs = new Set(rr.rows.map(x => String(x.date).slice(0, 10)));
  const dates = new Set([...ws, ...rs]);
  const t = today();
  const countable = (k) => ws.has(k) || (rs.has(k) && sr[mondayIndex(k)] === false);
  let cur = 0, k = t;
  for (let i = 0; i < 4000; i++) {
    const idx = mondayIndex(k);
    if (countable(k)) { cur++; k = addDays(k, -1); continue; }
    if (sr[idx] === false && !dates.has(k)) { k = addDays(k, -1); continue; }
    break;
  }
  let longest = 0, run = 0;
  const all = [...dates].sort();
  if (all.length) {
    let c = all[0];
    for (let i = 0; i < 5000; i++) {
      const idx = mondayIndex(c);
      if (countable(c)) run++;
      else if (sr[idx] === false && !dates.has(c)) { /* planned schedule rest */ }
      else run = 0;
      longest = Math.max(longest, run);
      if (c >= t) break;
      c = addDays(c, 1);
    }
  }
  return { current: cur, longest };
}

async function stats(uid) {
  const cfg = await settings(uid);
  const [st, sched, t] = await Promise.all([streaks(uid), userSchedule(uid), Promise.resolve(today())]);
  const month = t.slice(0, 7), { start: ms, end: me } = monthRange(month);
  const wkStart = addDays(t, -weekIndex(t, cfg.week_start_day));
  const wkEnd = addDays(wkStart, 6);
  const [total, week, mon] = await Promise.all([
    pool.query('SELECT COUNT(*)::int AS c FROM workouts WHERE user_id=$1 AND completed=true', [uid]),
    pool.query('SELECT COUNT(*)::int AS c FROM workouts WHERE user_id=$1 AND date BETWEEN $2 AND $3 AND completed=true', [uid, wkStart, wkEnd]),
    pool.query('SELECT COUNT(*)::int AS c FROM workouts WHERE user_id=$1 AND date BETWEEN $2 AND $3 AND completed=true', [uid, ms, me])
  ]);
  const [doneRows] = await Promise.all([
    pool.query('SELECT date FROM workouts WHERE user_id=$1 AND date BETWEEN $2 AND $3 AND completed=true', [uid, ms, me])
  ]);
  const doneSet = new Set(doneRows.rows.map(x => String(x.date).slice(0,10)));
  let eligible = 0, done = 0;
  for (let d = new Date(`${ms}T00:00:00`), e = new Date(`${me}T00:00:00`); d <= e; d.setDate(d.getDate() + 1)) {
    const k = d.toISOString().slice(0, 10);
    if (k <= t && sched[mondayIndex(k)] !== false) { eligible++; if (doneSet.has(k)) done++; }
  }
  return { currentStreak: st.current, longestStreak: st.longest, totalWorkouts: total.rows[0].c, workoutsWeek: week.rows[0].c, workoutsMonth: mon.rows[0].c, consistency: eligible ? Math.round(done / eligible * 100) : 0, weeklyGoal: cfg.weekly_goal, monthlyGoal: cfg.monthly_goal };
}

async function achievements(uid) {
  const r = await pool.query('SELECT achievement_id, unlocked, unlocked_at FROM achievements WHERE user_id=$1', [uid]);
  return achievementDefs.map(a => {
    const x = r.rows.find(row => row.achievement_id === a.id);
    return { ...a, unlocked: !!x?.unlocked, unlockedAt: x?.unlocked_at || null };
  });
}
async function checkAchievements(uid) {
  const [st, rows] = await Promise.all([stats(uid), pool.query('SELECT achievement_id, unlocked FROM achievements WHERE user_id=$1', [uid])]);
  const out = [];
  for (const a of achievementDefs) {
    const value = a.type === 'streak' ? st.currentStreak : st.totalWorkouts;
    const row = rows.rows.find(x => x.achievement_id === a.id);
    if (value >= a.target && !row?.unlocked) {
      const at = new Date().toISOString();
      await pool.query('UPDATE achievements SET unlocked=true, unlocked_at=$1 WHERE user_id=$2 AND achievement_id=$3', [at, uid, a.id]);
      out.push({ ...a, unlocked: true, unlockedAt: at });
    }
  }
  return out;
}
async function monthlyCounts(uid) {
  const rows = await pool.query(`SELECT to_char(date,'YYYY-MM') AS month, COUNT(*)::int AS count FROM workouts WHERE user_id=$1 AND completed=true GROUP BY 1`, [uid]);
  const map = new Map(rows.rows.map(r => [r.month, r.count]));
  const t = today(), [y, m] = t.slice(0, 7).split('-').map(Number), out = [];
  for (let i = 11; i >= 0; i--) { const d = new Date(y, m - 1 - i, 1); const key = d.toISOString().slice(0, 7); out.push({ month: key, count: map.get(key) || 0 }); }
  return out;
}
async function weeklyCounts(uid) {
  const t = today(), cfg = await settings(uid), o = [];
  for (let i = 7; i >= 0; i--) {
    const end = addDays(t, -i * 7), start = addDays(end, -weekIndex(end, cfg.week_start_day)), weekEnd = addDays(start, 6);
    const r = await pool.query('SELECT COUNT(*)::int AS c FROM workouts WHERE user_id=$1 AND date BETWEEN $2 AND $3 AND completed=true', [uid, start, weekEnd]);
    o.push({ week: start, count: r.rows[0].c });
  }
  return o;
}
async function types(uid) {
  const r = await pool.query(`SELECT COALESCE(workout_type,'Other') AS type, COUNT(*)::int AS count FROM workouts WHERE user_id=$1 AND completed=true GROUP BY 1 ORDER BY count DESC`, [uid]);
  return r.rows;
}
async function heatmap(uid) {
  const t = today(), start = addDays(t, -364);
  const r = await pool.query('SELECT date FROM workouts WHERE user_id=$1 AND date BETWEEN $2 AND $3 AND completed=true', [uid, start, t]);
  const set = new Set(r.rows.map(x => String(x.date).slice(0,10)));
  return Array.from({ length: 365 }, (_, i) => { const k = addDays(start, i); return { date: k, completed: set.has(k) }; });
}
async function bootstrap(uid) {
  const t = today(), month = t.slice(0, 7), c = await settings(uid);
  const [sched, st, md, ach, mc, wc, td, hm] = await Promise.all([
    userSchedule(uid), stats(uid), monthData(uid, month), achievements(uid), monthlyCounts(uid), weeklyCounts(uid), types(uid), heatmap(uid)
  ]);
  return {
    today: t,
    settings: { ...c, reminderEnabled: !!c.reminder_enabled, onboardingDone: !!c.onboarding_done, weeklyGoal: c.weekly_goal, monthlyGoal: c.monthly_goal, reminderTime: c.reminder_time, weekStartDay: c.week_start_day },
    schedule: sched,
    stats: st,
    month: md,
    achievements: ach,
    monthlyCounts: mc,
    weeklyCounts: wc,
    typeDistribution: td,
    heatmap: hm,
    motivation: motivation[0]
  };
}

function body(req) { return new Promise((resolve, reject) => { let s = ''; req.on('data', c => { s += c; if (s.length > 1_000_000) req.destroy(); }); req.on('end', () => { try { resolve(s ? JSON.parse(s) : {}); } catch { reject(new Error('Invalid JSON')); } }); req.on('error', reject); }); }
function send(res, status, payload, headers = {}) { const isText = typeof payload === 'string'; const b = isText ? payload : JSON.stringify(payload); res.writeHead(status, { 'Content-Type': isText ? 'text/plain; charset=utf-8' : 'application/json; charset=utf-8', ...headers }); res.end(b); }
function staticFile(res, url) { const rel = url === '/' ? '/index.html' : url; const safe = path.normalize(rel).replace(/^\.\.[/\\]/, ''); const fp = path.join(ROOT, safe); if (!fp.startsWith(ROOT) || !fs.existsSync(fp) || !fs.statSync(fp).isFile()) return false; const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json', '.webmanifest': 'application/manifest+json' }; res.writeHead(200, { 'Content-Type': types[path.extname(fp)] || 'application/octet-stream', 'Cache-Control': rel.endsWith('app.js') || rel.endsWith('styles.css') ? 'no-cache' : 'public,max-age=3600' }); res.end(fs.readFileSync(fp)); return true; }

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  try {
    if (req.method === 'GET' && url.pathname === '/health') {
      await pool.query('SELECT 1');
      return send(res, 200, { ok: true, database: 'postgresql' });
    }
    const uid = await ensureUser(req, res);
    if (req.method === 'GET' && url.pathname === '/api/bootstrap') return send(res, 200, await bootstrap(uid));
    if (req.method === 'GET' && /^\/api\/month\/\d{4}-\d{2}$/.test(url.pathname)) return send(res, 200, await monthData(uid, url.pathname.slice(-7)));
    if (req.method === 'GET' && url.pathname === '/api/export') {
      const [cfg, sched, workouts, rests, ach] = await Promise.all([
        settings(uid), userSchedule(uid), pool.query('SELECT date, completed, workout_type AS "workoutType", note, created_at AS "createdAt" FROM workouts WHERE user_id=$1 ORDER BY date', [uid]), pool.query('SELECT date,reason FROM rest_days WHERE user_id=$1 ORDER BY date', [uid]), achievements(uid)
      ]);
      return send(res, 200, { exportedAt: new Date().toISOString(), settings: cfg, schedule: sched, workouts: workouts.rows, restDays: rests.rows, achievements: ach }, { 'Content-Disposition': 'attachment; filename="trainstreak-export.json"' });
    }
    if (req.method === 'PUT' && url.pathname === '/api/settings') {
      const b = await body(req), c = await settings(uid);
      const weeklyGoal = Number(b.weeklyGoal ?? c.weekly_goal), monthlyGoal = Number(b.monthlyGoal ?? c.monthly_goal);
      if (!Number.isInteger(weeklyGoal) || weeklyGoal < 1 || weeklyGoal > 7 || !Number.isInteger(monthlyGoal) || monthlyGoal < 1 || monthlyGoal > 31) return send(res, 400, { error: 'Goals must be whole numbers: weekly 1–7, monthly 1–31.' });
      const reminderTime = String(b.reminderTime ?? c.reminder_time);
      if (!/^\d{2}:\d{2}$/.test(reminderTime)) return send(res, 400, { error: 'Invalid reminder time.' });
      const weekStartDay = Number.isInteger(b.weekStartDay) ? Math.max(0, Math.min(6, b.weekStartDay)) : c.week_start_day;
      const theme = b.theme === 'light' ? 'light' : 'dark';
      const reminderEnabled = b.reminderEnabled == null ? c.reminder_enabled : !!b.reminderEnabled;
      const onboardingDone = b.onboardingDone == null ? c.onboarding_done : !!b.onboardingDone;
      await pool.query(`UPDATE user_settings SET name=$1,weekly_goal=$2,monthly_goal=$3,reminder_enabled=$4,reminder_time=$5,week_start_day=$6,theme=$7,onboarding_done=$8 WHERE user_id=$9`, [String(b.name ?? c.name).slice(0,80), weeklyGoal, monthlyGoal, reminderEnabled, reminderTime, weekStartDay, theme, onboardingDone, uid]);
      const s = await settings(uid); return send(res, 200, { settings: { ...s, reminderEnabled: !!s.reminder_enabled, onboardingDone: !!s.onboarding_done, weeklyGoal: s.weekly_goal, monthlyGoal: s.monthly_goal }, stats: await stats(uid) });
    }
    if (req.method === 'PUT' && url.pathname === '/api/schedule') {
      const b = await body(req), s = b.schedule;
      if (!Array.isArray(s) || s.length !== 7) return send(res, 400, { error: 'Schedule must contain 7 days.' });
      for (let i = 0; i < 7; i++) await pool.query('UPDATE schedule SET is_workout=$1 WHERE user_id=$2 AND day=$3', [!!s[i], uid, i]);
      return send(res, 200, { schedule: await userSchedule(uid), stats: await stats(uid) });
    }
    if (req.method === 'POST' && url.pathname === '/api/workouts') {
      const b = await body(req), date = b.date || today();
      if (!isValidDate(date) || date > today()) return send(res, 400, { error: 'Choose a valid past or current date.' });
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const exists = await client.query('SELECT 1 FROM workouts WHERE user_id=$1 AND date=$2', [uid, date]);
        if (exists.rowCount) { await client.query('ROLLBACK'); return send(res, 409, { error: 'Workout already logged for this day.' }); }
        await client.query('INSERT INTO workouts(user_id,date,completed,workout_type,note) VALUES($1,$2,true,$3,$4)', [uid, date, b.workoutType || null, String(b.note || '').slice(0,500)]);
        await client.query('DELETE FROM rest_days WHERE user_id=$1 AND date=$2', [uid, date]);
        await client.query('COMMIT');
      } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
      const newAchievements = await checkAchievements(uid); return send(res, 201, { stats: await stats(uid), newAchievements, motivation: motivation[Math.floor(Math.random() * motivation.length)] });
    }
    if (req.method === 'PUT' && url.pathname === '/api/workouts') {
      const b = await body(req), date = b.date;
      if (!isValidDate(date) || date > today()) return send(res, 400, { error: 'Invalid workout date.' });
      const r = await pool.query('UPDATE workouts SET workout_type=$1,note=$2 WHERE user_id=$3 AND date=$4', [b.workoutType || null, String(b.note || '').slice(0,500), uid, date]);
      if (!r.rowCount) return send(res, 404, { error: 'Workout not found.' });
      return send(res, 200, { stats: await stats(uid), newAchievements: await checkAchievements(uid) });
    }
    if (req.method === 'DELETE' && url.pathname.startsWith('/api/workouts/')) {
      const date = url.pathname.slice('/api/workouts/'.length); if (!isValidDate(date)) return send(res, 400, { error: 'Invalid date.' });
      await pool.query('DELETE FROM workouts WHERE user_id=$1 AND date=$2', [uid, date]); return send(res, 200, { stats: await stats(uid), achievements: await achievements(uid) });
    }
    if (req.method === 'PUT' && url.pathname === '/api/rest-days') {
      const b = await body(req), date = b.date; if (!isValidDate(date) || date > today()) return send(res, 400, { error: 'Invalid rest day date.' });
      await pool.query('DELETE FROM workouts WHERE user_id=$1 AND date=$2', [uid, date]);
      await pool.query('INSERT INTO rest_days(user_id,date,reason) VALUES($1,$2,$3) ON CONFLICT(user_id,date) DO UPDATE SET reason=EXCLUDED.reason', [uid, date, String(b.reason || '').slice(0,300)]);
      return send(res, 200, { stats: await stats(uid) });
    }
    if (req.method === 'DELETE' && url.pathname.startsWith('/api/rest-days/')) {
      const date = url.pathname.slice('/api/rest-days/'.length); if (!isValidDate(date)) return send(res, 400, { error: 'Invalid date.' });
      await pool.query('DELETE FROM rest_days WHERE user_id=$1 AND date=$2', [uid, date]); return send(res, 200, { stats: await stats(uid) });
    }
    if (req.method === 'POST' && url.pathname === '/api/reset') {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query('DELETE FROM workouts WHERE user_id=$1', [uid]);
        await client.query('DELETE FROM rest_days WHERE user_id=$1', [uid]);
        await client.query('UPDATE achievements SET unlocked=false,unlocked_at=NULL WHERE user_id=$1', [uid]);
        await client.query(`UPDATE user_settings SET name='',weekly_goal=4,monthly_goal=18,reminder_enabled=false,reminder_time='18:00',week_start_day=1,theme='dark',onboarding_done=false WHERE user_id=$1`, [uid]);
        for (let i = 0; i < 7; i++) await client.query('UPDATE schedule SET is_workout=$1 WHERE user_id=$2 AND day=$3', [defaults[i], uid, i]);
        await client.query('COMMIT');
      } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
      return send(res, 200, { ok: true });
    }
    if (req.method === 'GET' && !url.pathname.startsWith('/api/') && staticFile(res, url.pathname)) return;
    if (req.method === 'GET' && !url.pathname.startsWith('/api/')) return staticFile(res, '/index.html') ? undefined : send(res, 404, 'Not found');
    return send(res, 404, { error: 'Not found' });
  } catch (e) {
    console.error(e);
    return send(res, 500, { error: 'Something went wrong. Please try again.' });
  }
});

server.listen(PORT, '0.0.0.0', () => console.log(`TrainStreak running on port ${PORT}`));
