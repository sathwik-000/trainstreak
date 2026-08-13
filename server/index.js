import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.PORT || 4000);
const DATA_DIR = path.join(ROOT, 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });
const db = new DatabaseSync(path.join(DATA_DIR, 'trainstreak.db'));

db.exec('PRAGMA journal_mode=WAL;');

// v2 changes the old single-user schema into an anonymous multi-user schema.
// Each browser gets an opaque, random HttpOnly cookie. No account creation is required.
function hasColumn(table, column) {
  try { return db.prepare(`PRAGMA table_info(${table})`).all().some(r => r.name === column); }
  catch { return false; }
}
if (hasColumn('workouts', 'date') && !hasColumn('workouts', 'userId')) {
  for (const t of ['settings','workouts','rest_days','achievements','schedule']) {
    try { db.exec(`ALTER TABLE ${t} RENAME TO ${t}_legacy`); } catch {}
  }
}

db.exec(`
CREATE TABLE IF NOT EXISTS users(
  id TEXT PRIMARY KEY,
  createdAt TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS settings(
  userId TEXT PRIMARY KEY,
  name TEXT NOT NULL DEFAULT '',
  weeklyGoal INTEGER NOT NULL DEFAULT 4,
  monthlyGoal INTEGER NOT NULL DEFAULT 18,
  reminderEnabled INTEGER NOT NULL DEFAULT 0,
  reminderTime TEXT NOT NULL DEFAULT '18:00',
  weekStartDay INTEGER NOT NULL DEFAULT 1,
  theme TEXT NOT NULL DEFAULT 'dark',
  onboardingDone INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS workouts(
  userId TEXT NOT NULL,
  date TEXT NOT NULL,
  completed INTEGER NOT NULL DEFAULT 1,
  workoutType TEXT,
  note TEXT,
  createdAt TEXT NOT NULL,
  PRIMARY KEY(userId,date)
);
CREATE TABLE IF NOT EXISTS rest_days(
  userId TEXT NOT NULL,
  date TEXT NOT NULL,
  reason TEXT,
  PRIMARY KEY(userId,date)
);
CREATE TABLE IF NOT EXISTS achievements(
  userId TEXT NOT NULL,
  achievementId TEXT NOT NULL,
  unlocked INTEGER NOT NULL DEFAULT 0,
  unlockedAt TEXT,
  PRIMARY KEY(userId,achievementId)
);
CREATE TABLE IF NOT EXISTS schedule(
  userId TEXT NOT NULL,
  day INTEGER NOT NULL,
  isWorkout INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY(userId,day)
);
`);

const defaults=[1,1,0,1,1,1,0];
const achievementDefs=[
  {id:'first-workout',title:'First Workout',icon:'🌱',desc:'Log your first workout.',type:'workouts',target:1},
  {id:'streak-7',title:'7-Day Streak',icon:'🔥',desc:'Reach a 7-day streak.',type:'streak',target:7},
  {id:'streak-14',title:'14-Day Streak',icon:'🔥',desc:'Reach a 14-day streak.',type:'streak',target:14},
  {id:'streak-30',title:'30-Day Streak',icon:'🏆',desc:'Reach a 30-day streak.',type:'streak',target:30},
  {id:'workouts-50',title:'50 Workouts',icon:'💪',desc:'Log 50 workouts.',type:'workouts',target:50},
  {id:'workouts-100',title:'100 Workouts',icon:'👑',desc:'Log 100 workouts.',type:'workouts',target:100},
  {id:'streak-100',title:'100-Day Streak',icon:'👑',desc:'Reach a 100-day streak.',type:'streak',target:100},
  {id:'workouts-200',title:'200 Workouts',icon:'💪',desc:'Log 200 workouts.',type:'workouts',target:200}
];
const motivation=[
'🔥 Keep the streak alive.','Show up. That’s the hardest part.','Consistency beats motivation.','One workout closer.','You’re becoming more consistent.','Don’t break the chain.','Future you will thank you.','Keep stacking wins.','Small action. Big momentum.','You showed up again.','Discipline looks good on you.','Another day, another win.','Your streak is getting stronger.','Make today count.','The habit is working.','One day at a time.','You’re building something that lasts.','Keep going. You’re closer.','Momentum favors consistency.','You kept your promise to yourself.','No perfect days required. Just keep showing up.','Your future self is cheering.','Progress loves repetition.','That’s how habits are built.','Strong habits, stronger you.','You’re making consistency automatic.','Keep the chain unbroken.','A little effort adds up.','Today’s win becomes tomorrow’s confidence.','One check-in. One step forward.','Your streak has momentum.','Another workout in the books.','You’re proving it to yourself.','Keep putting points on the board.','Consistency compounds.','You came through for yourself.','That’s another rep for your habit.','You’re not starting over—you’re continuing.','Stay in motion.','The streak is yours to protect.','Keep your promise today.','You are becoming the person who shows up.','Habits are built one ordinary day at a time.','Another brick in the foundation.','This is what discipline looks like.','You’re making future workouts easier.','Stay consistent, stay unstoppable.','Your streak tells a story. Keep writing it.','One more day. One more win.','Don’t wait for motivation. Create momentum.','You’re building proof that you can do this.'
];

function parseCookies(req){
  const out={};
  for(const part of String(req.headers.cookie||'').split(';')){
    const [k,...v]=part.trim().split('='); if(k) out[k]=decodeURIComponent(v.join('='));
  }
  return out;
}
function ensureUser(req,res){
  const cookies=parseCookies(req);
  let id=cookies.ts_user;
  if(!id || !/^[0-9a-f-]{36}$/i.test(id)){
    id=crypto.randomUUID();
    res.setHeader('Set-Cookie',`ts_user=${encodeURIComponent(id)}; Max-Age=31536000; Path=/; HttpOnly; SameSite=Lax`);
  }
  const exists=db.prepare('SELECT 1 FROM users WHERE id=?').get(id);
  if(!exists){
    db.prepare('INSERT INTO users(id,createdAt) VALUES(?,?)').run(id,new Date().toISOString());
    db.prepare('INSERT INTO settings(userId) VALUES(?)').run(id);
    for(let i=0;i<7;i++) db.prepare('INSERT INTO schedule(userId,day,isWorkout) VALUES(?,?,?)').run(id,i,defaults[i]);
    for(const a of achievementDefs) db.prepare('INSERT INTO achievements(userId,achievementId) VALUES(?,?)').run(id,a.id);
  }
  return id;
}

const dateFormatter=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata'});
const today=()=>dateFormatter.format(new Date());
const isValidDate=s=>typeof s==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(s)&&!Number.isNaN(Date.parse(`${s}T00:00:00Z`));
const toDate=k=>new Date(`${k}T00:00:00`);
const addDays=(k,n)=>{const d=toDate(k);d.setDate(d.getDate()+n);return d.toISOString().slice(0,10)};
const mondayIndex=k=>(toDate(k).getDay()+6)%7;
const weekIndex=(k,startDay)=>((toDate(k).getDay()-startDay)+7)%7;
const monthRange=k=>{const [y,m]=k.slice(0,7).split('-').map(Number);return {start:`${y}-${String(m).padStart(2,'0')}-01`,end:new Date(y,m,0).toISOString().slice(0,10)}};
function settings(uid){ return db.prepare('SELECT * FROM settings WHERE userId=?').get(uid); }
function schedule(uid){ return db.prepare('SELECT day,isWorkout FROM schedule WHERE userId=? ORDER BY day').all(uid).map(x=>!!x.isWorkout); }
function monthData(uid,k){ const {start,end}=monthRange(k); return {workouts:db.prepare('SELECT * FROM workouts WHERE userId=? AND date BETWEEN ? AND ? ORDER BY date').all(uid,start,end).map(x=>({...x,completed:!!x.completed})),restDays:db.prepare('SELECT date,reason FROM rest_days WHERE userId=? AND date BETWEEN ? AND ? ORDER BY date').all(uid,start,end),start,end}; }
function streaks(uid){
  const ws=new Set(db.prepare('SELECT date FROM workouts WHERE userId=? AND completed=1').all(uid).map(x=>x.date));
  const rs=new Set(db.prepare('SELECT date FROM rest_days WHERE userId=?').all(uid).map(x=>x.date));
  const sched=schedule(uid),dates=new Set([...ws,...rs]),t=today();
  const countable=k=>ws.has(k)||(rs.has(k)&&sched[mondayIndex(k)]===false);
  let cur=0,k=t;
  for(let i=0;i<4000;i++){
    const idx=mondayIndex(k);
    if(countable(k)){cur++;k=addDays(k,-1);continue;}
    if(sched[idx]===false&&!dates.has(k)){k=addDays(k,-1);continue;}
    break;
  }
  let longest=0,run=0;
  const all=[...dates].sort();
  if(all.length){
    let c=all[0];
    for(let i=0;i<5000;i++){
      const idx=mondayIndex(c);
      if(countable(c)) run++;
      else if(sched[idx]===false&&!dates.has(c)) {}
      else run=0;
      longest=Math.max(longest,run);
      if(c>=t) break;
      c=addDays(c,1);
    }
  }
  return {current:cur,longest};
}
function stats(uid){
  const st=streaks(uid),t=today(),sched=schedule(uid),month=t.slice(0,7),{start:ms,end:me}=monthRange(month),cfg=settings(uid);
  const wkStart=addDays(t,-weekIndex(t,cfg.weekStartDay)),wkEnd=addDays(wkStart,6);
  const total=db.prepare('SELECT COUNT(*) c FROM workouts WHERE userId=? AND completed=1').get(uid).c;
  const week=db.prepare('SELECT COUNT(*) c FROM workouts WHERE userId=? AND date BETWEEN ? AND ? AND completed=1').get(uid,wkStart,wkEnd).c;
  const mon=db.prepare('SELECT COUNT(*) c FROM workouts WHERE userId=? AND date BETWEEN ? AND ? AND completed=1').get(uid,ms,me).c;
  let eligible=0,done=0;
  for(let d=new Date(`${ms}T00:00:00`),e=new Date(`${me}T00:00:00`);d<=e;d.setDate(d.getDate()+1)){
    const k=d.toISOString().slice(0,10);if(k<=t&&sched[mondayIndex(k)]!==false){eligible++;if(db.prepare('SELECT 1 FROM workouts WHERE userId=? AND date=?').get(uid,k))done++;}
  }
  return {currentStreak:st.current,longestStreak:st.longest,totalWorkouts:total,workoutsWeek:week,workoutsMonth:mon,consistency:eligible?Math.round(done/eligible*100):0,weeklyGoal:cfg.weeklyGoal,monthlyGoal:cfg.monthlyGoal};
}
function achievements(uid){
  const rows=db.prepare('SELECT * FROM achievements WHERE userId=?').all(uid);
  return achievementDefs.map(a=>{const r=rows.find(x=>x.achievementId===a.id);return {...a,unlocked:!!r?.unlocked,unlockedAt:r?.unlockedAt||null};});
}
function checkAchievements(uid){
  const st=stats(uid),rows=db.prepare('SELECT * FROM achievements WHERE userId=?').all(uid),out=[];
  for(const a of achievementDefs){
    const v=a.type==='streak'?st.currentStreak:st.totalWorkouts;
    const r=rows.find(x=>x.achievementId===a.id);
    if(v>=a.target && !r?.unlocked){
      const at=new Date().toISOString();
      db.prepare('UPDATE achievements SET unlocked=1,unlockedAt=? WHERE userId=? AND achievementId=?').run(at,uid,a.id);
      out.push({...a,unlocked:true,unlockedAt:at});
    }
  }
  return out;
}
function monthlyCounts(uid){
  const rows=db.prepare(`SELECT substr(date,1,7) month,COUNT(*) count FROM workouts WHERE userId=? AND completed=1 GROUP BY substr(date,1,7)`).all(uid);
  const map=new Map(rows.map(r=>[r.month,r.count]));const t=today(),[y,m]=t.slice(0,7).split('-').map(Number);const out=[];
  for(let i=11;i>=0;i--){const d=new Date(y,m-1-i,1);out.push({month:d.toISOString().slice(0,7),count:map.get(d.toISOString().slice(0,7))||0});}
  return out;
}
function weeklyCounts(uid){
  const t=today(),cfg=settings(uid),o=[];
  for(let i=7;i>=0;i--){const end=addDays(t,-i*7),start=addDays(end,-weekIndex(end,cfg.weekStartDay)),weekEnd=addDays(start,6);o.push({week:start,count:db.prepare('SELECT COUNT(*) c FROM workouts WHERE userId=? AND date BETWEEN ? AND ? AND completed=1').get(uid,start,weekEnd).c});}
  return o;
}
function types(uid){return db.prepare(`SELECT COALESCE(workoutType,'Other') type,COUNT(*) count FROM workouts WHERE userId=? AND completed=1 GROUP BY COALESCE(workoutType,'Other') ORDER BY count DESC`).all(uid);}
function heatmap(uid){
  const t=today(),start=addDays(t,-364),s=new Set(db.prepare('SELECT date FROM workouts WHERE userId=? AND date BETWEEN ? AND ? AND completed=1').all(uid,start,t).map(x=>x.date));
  return Array.from({length:365},(_,i)=>{const k=addDays(start,i);return {date:k,completed:s.has(k)};});
}
function bootstrap(uid){
  const t=today(),month=t.slice(0,7),c=settings(uid);
  return {today:t,settings:{...c,reminderEnabled:!!c.reminderEnabled,onboardingDone:!!c.onboardingDone},schedule:schedule(uid),stats:stats(uid),month:monthData(uid,month),achievements:achievements(uid),monthlyCounts:monthlyCounts(uid),weeklyCounts:weeklyCounts(uid),typeDistribution:types(uid),heatmap:heatmap(uid),motivation:motivation[0]};
}

function body(req){return new Promise((resolve,reject)=>{let s='';req.on('data',c=>{s+=c;if(s.length>1_000_000)req.destroy();});req.on('end',()=>{try{resolve(s?JSON.parse(s):{})}catch{reject(new Error('Invalid JSON'))}});req.on('error',reject)});}
function send(res,status,payload,headers={}){const isText=typeof payload==='string';const b=isText?payload:JSON.stringify(payload);res.writeHead(status,{'Content-Type':isText?'text/plain; charset=utf-8':'application/json; charset=utf-8',...headers});res.end(b)}
function staticFile(res,url){const rel=url==='/'?'/index.html':url;const safe=path.normalize(rel).replace(/^\.\.[/\\]/,'');const fp=path.join(ROOT,safe);if(!fp.startsWith(ROOT)||!fs.existsSync(fp)||!fs.statSync(fp).isFile())return false;const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.json':'application/json'};res.writeHead(200,{'Content-Type':types[path.extname(fp)]||'application/octet-stream','Cache-Control':rel.endsWith('app.js')||rel.endsWith('styles.css')?'no-cache':'public,max-age=3600'});res.end(fs.readFileSync(fp));return true}

const server=http.createServer(async(req,res)=>{
  const url=new URL(req.url,`http://${req.headers.host||'localhost'}`);
  const uid=ensureUser(req,res);
  try{
    if(req.method==='GET'&&url.pathname==='/api/bootstrap') return send(res,200,bootstrap(uid));
    if(req.method==='GET'&&/^\/api\/month\/\d{4}-\d{2}$/.test(url.pathname)) return send(res,200,monthData(uid,url.pathname.slice(-7)));
    if(req.method==='GET'&&url.pathname==='/api/export'){
      const payload={exportedAt:new Date().toISOString(),settings:settings(uid),schedule:schedule(uid),workouts:db.prepare('SELECT * FROM workouts WHERE userId=? ORDER BY date').all(uid),restDays:db.prepare('SELECT date,reason FROM rest_days WHERE userId=? ORDER BY date').all(uid),achievements:achievements(uid)};
      return send(res,200,payload,{'Content-Disposition':'attachment; filename="trainstreak-export.json"'});
    }
    if(req.method==='PUT'&&url.pathname==='/api/settings'){
      const b=await body(req),c=settings(uid);const weeklyGoal=Number(b.weeklyGoal??c.weeklyGoal),monthlyGoal=Number(b.monthlyGoal??c.monthlyGoal);
      if(!Number.isInteger(weeklyGoal)||weeklyGoal<1||weeklyGoal>7||!Number.isInteger(monthlyGoal)||monthlyGoal<1||monthlyGoal>31)return send(res,400,{error:'Goals must be whole numbers: weekly 1–7, monthly 1–31.'});
      const reminderTime=String(b.reminderTime??c.reminderTime);if(!/^\d{2}:\d{2}$/.test(reminderTime))return send(res,400,{error:'Invalid reminder time.'});
      db.prepare('UPDATE settings SET name=?,weeklyGoal=?,monthlyGoal=?,reminderEnabled=?,reminderTime=?,weekStartDay=?,theme=?,onboardingDone=? WHERE userId=?').run(String(b.name??c.name).slice(0,80),weeklyGoal,monthlyGoal,b.reminderEnabled==null?c.reminderEnabled:(b.reminderEnabled?1:0),reminderTime,Number.isInteger(b.weekStartDay)?Math.max(0,Math.min(6,b.weekStartDay)):c.weekStartDay,b.theme==='light'?'light':'dark',b.onboardingDone==null?c.onboardingDone:(b.onboardingDone?1:0),uid);
      const s=settings(uid);return send(res,200,{settings:{...s,reminderEnabled:!!s.reminderEnabled,onboardingDone:!!s.onboardingDone},stats:stats(uid)});
    }
    if(req.method==='PUT'&&url.pathname==='/api/schedule'){
      const b=await body(req),s=b.schedule;if(!Array.isArray(s)||s.length!==7)return send(res,400,{error:'Schedule must contain 7 days.'});
      for(let i=0;i<7;i++)db.prepare('UPDATE schedule SET isWorkout=? WHERE userId=? AND day=?').run(s[i]?1:0,uid,i);
      return send(res,200,{schedule:schedule(uid),stats:stats(uid)});
    }
    if(req.method==='POST'&&url.pathname==='/api/workouts'){
      const b=await body(req),date=b.date||today();if(!isValidDate(date)||date>today())return send(res,400,{error:'Choose a valid past or current date.'});
      if(db.prepare('SELECT 1 FROM workouts WHERE userId=? AND date=?').get(uid,date))return send(res,409,{error:'Workout already logged for this day.'});
      db.prepare('INSERT INTO workouts(userId,date,completed,workoutType,note,createdAt) VALUES(?,?,?,?,?,?)').run(uid,date,1,b.workoutType||null,String(b.note||'').slice(0,500),new Date().toISOString());
      db.prepare('DELETE FROM rest_days WHERE userId=? AND date=?').run(uid,date);const newAchievements=checkAchievements(uid),st=stats(uid);
      return send(res,201,{stats:st,newAchievements,motivation:motivation[Math.floor(Math.random()*motivation.length)]});
    }
    if(req.method==='PUT'&&url.pathname==='/api/workouts'){
      const b=await body(req),date=b.date;if(!isValidDate(date)||date>today())return send(res,400,{error:'Invalid workout date.'});
      if(!db.prepare('SELECT 1 FROM workouts WHERE userId=? AND date=?').get(uid,date))return send(res,404,{error:'Workout not found.'});
      db.prepare('UPDATE workouts SET workoutType=?,note=? WHERE userId=? AND date=?').run(b.workoutType||null,String(b.note||'').slice(0,500),uid,date);
      const newAchievements=checkAchievements(uid);return send(res,200,{stats:stats(uid),newAchievements});
    }
    if(req.method==='DELETE'&&url.pathname.startsWith('/api/workouts/')){
      const date=url.pathname.slice('/api/workouts/'.length);if(!isValidDate(date))return send(res,400,{error:'Invalid date.'});
      db.prepare('DELETE FROM workouts WHERE userId=? AND date=?').run(uid,date);return send(res,200,{stats:stats(uid),achievements:achievements(uid)});
    }
    if(req.method==='PUT'&&url.pathname==='/api/rest-days'){
      const b=await body(req),date=b.date;if(!isValidDate(date)||date>today())return send(res,400,{error:'Invalid rest day date.'});
      db.prepare('DELETE FROM workouts WHERE userId=? AND date=?').run(uid,date);
      db.prepare('INSERT INTO rest_days(userId,date,reason) VALUES(?,?,?) ON CONFLICT(userId,date) DO UPDATE SET reason=excluded.reason').run(uid,date,String(b.reason||'').slice(0,300));
      return send(res,200,{stats:stats(uid)});
    }
    if(req.method==='DELETE'&&url.pathname.startsWith('/api/rest-days/')){
      const date=url.pathname.slice('/api/rest-days/'.length);if(!isValidDate(date))return send(res,400,{error:'Invalid date.'});db.prepare('DELETE FROM rest_days WHERE userId=? AND date=?').run(uid,date);return send(res,200,{stats:stats(uid)});
    }
    if(req.method==='POST'&&url.pathname==='/api/reset'){
      db.prepare('DELETE FROM workouts WHERE userId=?').run(uid);db.prepare('DELETE FROM rest_days WHERE userId=?').run(uid);db.prepare('UPDATE achievements SET unlocked=0,unlockedAt=NULL WHERE userId=?').run(uid);
      db.prepare(`UPDATE settings SET name='',weeklyGoal=4,monthlyGoal=18,reminderEnabled=0,reminderTime='18:00',weekStartDay=1,theme='dark',onboardingDone=0 WHERE userId=?`).run(uid);
      for(let i=0;i<7;i++)db.prepare('UPDATE schedule SET isWorkout=? WHERE userId=? AND day=?').run(defaults[i],uid,i);
      return send(res,200,{ok:true});
    }
    if(req.method==='GET'&&!url.pathname.startsWith('/api/')&&staticFile(res,url.pathname))return;
    if(req.method==='GET'&&!url.pathname.startsWith('/api/'))return staticFile(res,'/index.html')?undefined:send(res,404,'Not found');
    return send(res,404,{error:'Not found'});
  }catch(e){console.error(e);return send(res,500,{error:'Something went wrong. Please try again.'});}
});
server.listen(PORT,()=>console.log(`TrainStreak running at http://localhost:${PORT}`));
