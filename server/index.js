import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.PORT || 4000);
const DATA_DIR = path.join(ROOT, 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });
const db = new DatabaseSync(path.join(DATA_DIR, 'trainstreak.db'));
db.exec(`
PRAGMA journal_mode=WAL;
CREATE TABLE IF NOT EXISTS settings(id INTEGER PRIMARY KEY CHECK(id=1),name TEXT NOT NULL DEFAULT '',weeklyGoal INTEGER NOT NULL DEFAULT 4,monthlyGoal INTEGER NOT NULL DEFAULT 18,reminderEnabled INTEGER NOT NULL DEFAULT 0,reminderTime TEXT NOT NULL DEFAULT '18:00',weekStartDay INTEGER NOT NULL DEFAULT 1,theme TEXT NOT NULL DEFAULT 'dark',onboardingDone INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS workouts(date TEXT PRIMARY KEY,completed INTEGER NOT NULL DEFAULT 1,workoutType TEXT,note TEXT,createdAt TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS rest_days(date TEXT PRIMARY KEY,reason TEXT);
CREATE TABLE IF NOT EXISTS achievements(achievementId TEXT PRIMARY KEY,unlocked INTEGER NOT NULL DEFAULT 0,unlockedAt TEXT);
CREATE TABLE IF NOT EXISTS schedule(day INTEGER PRIMARY KEY,isWorkout INTEGER NOT NULL DEFAULT 1);
`);
db.prepare('INSERT OR IGNORE INTO settings(id) VALUES(1)').run();
const defaults=[1,1,0,1,1,1,0]; for(let i=0;i<7;i++) db.prepare('INSERT OR IGNORE INTO schedule(day,isWorkout) VALUES(?,?)').run(i,defaults[i]);

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
for(const a of achievementDefs) db.prepare('INSERT OR IGNORE INTO achievements(achievementId) VALUES(?)').run(a.id);
const motivation=[
'🔥 Keep the streak alive.','Show up. That’s the hardest part.','Consistency beats motivation.','One workout closer.','You’re becoming more consistent.','Don’t break the chain.','Future you will thank you.','Keep stacking wins.','Small action. Big momentum.','You showed up again.','Discipline looks good on you.','Another day, another win.','Your streak is getting stronger.','Make today count.','The habit is working.','One day at a time.','You’re building something that lasts.','Keep going. You’re closer.','Momentum favors consistency.','You kept your promise to yourself.','No perfect days required. Just keep showing up.','Your future self is cheering.','Progress loves repetition.','That’s how habits are built.','Strong habits, stronger you.','You’re making consistency automatic.','Keep the chain unbroken.','A little effort adds up.','Today’s win becomes tomorrow’s confidence.','One check-in. One step forward.','Your streak has momentum.','Another workout in the books.','You’re proving it to yourself.','Keep putting points on the board.','Consistency compounds.','You came through for yourself.','That’s another rep for your habit.','You’re not starting over—you’re continuing.','Stay in motion.','The streak is yours to protect.','Keep your promise today.','You are becoming the person who shows up.','Habits are built one ordinary day at a time.','Another brick in the foundation.','This is what discipline looks like.','You’re making future workouts easier.','Stay consistent, stay unstoppable.','Your streak tells a story. Keep writing it.','One more day. One more win.','Don’t wait for motivation. Create momentum.','You’re building proof that you can do this.'
];

const dateFormatter=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata'});
const today=()=>dateFormatter.format(new Date());
const isValidDate=s=>typeof s==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(s)&&!Number.isNaN(Date.parse(`${s}T00:00:00Z`));
const toDate=k=>new Date(`${k}T00:00:00`);
const addDays=(k,n)=>{const d=toDate(k);d.setDate(d.getDate()+n);return d.toISOString().slice(0,10)};
const mondayIndex=k=>(toDate(k).getDay()+6)%7;
const weekIndex=(k,startDay)=>((toDate(k).getDay()-startDay)+7)%7;
const monthRange=k=>{const [y,m]=k.slice(0,7).split('-').map(Number);return {start:`${y}-${String(m).padStart(2,'0')}-01`,end:new Date(y,m,0).toISOString().slice(0,10)}};
function settings(){return db.prepare('SELECT * FROM settings WHERE id=1').get()}
function schedule(){return db.prepare('SELECT day,isWorkout FROM schedule ORDER BY day').all().map(x=>!!x.isWorkout)}
function monthData(k){const {start,end}=monthRange(k);return {workouts:db.prepare('SELECT * FROM workouts WHERE date BETWEEN ? AND ? ORDER BY date').all(start,end).map(x=>({...x,completed:!!x.completed})),restDays:db.prepare('SELECT * FROM rest_days WHERE date BETWEEN ? AND ? ORDER BY date').all(start,end),start,end}}
function streaks(){
 const ws=new Set(db.prepare('SELECT date FROM workouts WHERE completed=1').all().map(x=>x.date));
 const rs=new Set(db.prepare('SELECT date FROM rest_days').all().map(x=>x.date));
 const sched=schedule(); const dates=new Set([...ws,...rs]); const t=today();
 const countable=k=>ws.has(k)||(rs.has(k)&&sched[mondayIndex(k)]===false);
 let cur=0,k=t; for(let i=0;i<4000;i++){const idx=mondayIndex(k); if(countable(k)){cur++;k=addDays(k,-1);continue;} if(sched[idx]===false&&!dates.has(k)){k=addDays(k,-1);continue;} break;}
 let longest=0,run=0; const start=[...dates].sort()[0]||t; let c=start; for(let i=0;i<5000;i++){const idx=mondayIndex(c); if(countable(c))run++; else if(sched[idx]===false&&!dates.has(c)){} else run=0; longest=Math.max(longest,run); if(c>=t)break; c=addDays(c,1)}
 return {current:cur,longest};
}
function stats(){
 const st=streaks(),t=today(),set=schedule(),month=t.slice(0,7),{start:ms,end:me}=monthRange(month),cfg=settings(); const wkStart=addDays(t,-weekIndex(t,cfg.weekStartDay)),wkEnd=addDays(wkStart,6);
 const total=db.prepare('SELECT COUNT(*) c FROM workouts WHERE completed=1').get().c;
 const week=db.prepare('SELECT COUNT(*) c FROM workouts WHERE date BETWEEN ? AND ? AND completed=1').get(wkStart,wkEnd).c;
 const mon=db.prepare('SELECT COUNT(*) c FROM workouts WHERE date BETWEEN ? AND ? AND completed=1').get(ms,me).c;
 let eligible=0,done=0; for(let d=new Date(`${ms}T00:00:00`),e=new Date(`${me}T00:00:00`);d<=e;d.setDate(d.getDate()+1)){const k=d.toISOString().slice(0,10);if(k<=t&&set[mondayIndex(k)]!==false){eligible++;if(db.prepare('SELECT 1 FROM workouts WHERE date=?').get(k))done++;}}
 return {currentStreak:st.current,longestStreak:st.longest,totalWorkouts:total,workoutsWeek:week,workoutsMonth:mon,consistency:eligible?Math.round(done/eligible*100):0,weeklyGoal:cfg.weeklyGoal,monthlyGoal:cfg.monthlyGoal};
}
function achievements(){const rows=db.prepare('SELECT * FROM achievements').all();return achievementDefs.map(a=>{const r=rows.find(x=>x.achievementId===a.id);return {...a,unlocked:!!r?.unlocked,unlockedAt:r?.unlockedAt||null}})}
function checkAchievements(){const st=stats(),rows=db.prepare('SELECT * FROM achievements').all(),out=[];for(const a of achievementDefs){const v=a.type==='streak'?st.currentStreak:st.totalWorkouts;const r=rows.find(x=>x.achievementId===a.id);if(v>=a.target&&!r.unlocked){const at=new Date().toISOString();db.prepare('UPDATE achievements SET unlocked=1,unlockedAt=? WHERE achievementId=?').run(at,a.id);out.push({...a,unlocked:true,unlockedAt:at})}}return out}
function monthlyCounts(){const rows=db.prepare(`SELECT substr(date,1,7) month,COUNT(*) count FROM workouts WHERE completed=1 GROUP BY substr(date,1,7)`).all();const map=new Map(rows.map(r=>[r.month,r.count]));const t=today(),[y,m]=t.slice(0,7).split('-').map(Number);const out=[];for(let i=11;i>=0;i--){const d=new Date(y,m-1-i,1);const k=d.toISOString().slice(0,7);out.push({month:k,count:map.get(k)||0})}return out}
function weeklyCounts(){const t=today(),cfg=settings(),o=[];for(let i=7;i>=0;i--){const end=addDays(t,-i*7),start=addDays(end,-weekIndex(end,cfg.weekStartDay));const weekEnd=addDays(start,6);o.push({week:start,count:db.prepare('SELECT COUNT(*) c FROM workouts WHERE date BETWEEN ? AND ? AND completed=1').get(start,weekEnd).c})}return o}
function types(){return db.prepare(`SELECT COALESCE(workoutType,'Other') type,COUNT(*) count FROM workouts WHERE completed=1 GROUP BY COALESCE(workoutType,'Other') ORDER BY count DESC`).all()}
function heatmap(){const t=today(),start=addDays(t,-364),s=new Set(db.prepare('SELECT date FROM workouts WHERE date BETWEEN ? AND ? AND completed=1').all(start,t).map(x=>x.date));return Array.from({length:365},(_,i)=>{const k=addDays(start,i);return {date:k,completed:s.has(k)}})}
function bootstrap(){const t=today(),month=t.slice(0,7);return {today:t,settings:{...settings(),reminderEnabled:!!settings().reminderEnabled,onboardingDone:!!settings().onboardingDone},schedule:schedule(),stats:stats(),month:monthData(month),achievements:achievements(),monthlyCounts:monthlyCounts(),weeklyCounts:weeklyCounts(),typeDistribution:types(),heatmap:heatmap(),motivation:motivation[0]}}

function body(req){return new Promise((resolve,reject)=>{let s='';req.on('data',c=>{s+=c});req.on('end',()=>{try{resolve(s?JSON.parse(s):{})}catch{reject(new Error('Invalid JSON'))}});req.on('error',reject)})}
function send(res,status,payload,headers={}){const isText=typeof payload==='string';const b=isText?payload:JSON.stringify(payload);res.writeHead(status,{'Content-Type':isText?'text/plain; charset=utf-8':'application/json; charset=utf-8',...headers});res.end(b)}
function staticFile(res,url){const rel=url==='/'?'/index.html':url;const safe=path.normalize(rel).replace(/^\.\.[/\\]/,'');const fp=path.join(ROOT,safe);if(!fp.startsWith(ROOT)||!fs.existsSync(fp)||!fs.statSync(fp).isFile())return false;const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.json':'application/json'};res.writeHead(200,{'Content-Type':types[path.extname(fp)]||'application/octet-stream','Cache-Control':rel.endsWith('app.js')||rel.endsWith('styles.css')?'no-cache':'public,max-age=3600'});res.end(fs.readFileSync(fp));return true}

const server=http.createServer(async(req,res)=>{
 const url=new URL(req.url,`http://${req.headers.host||'localhost'}`); try{
  if(req.method==='GET'&&url.pathname==='/api/bootstrap')return send(res,200,bootstrap());
  if(req.method==='GET'&&/^\/api\/month\/\d{4}-\d{2}$/.test(url.pathname)){return send(res,200,monthData(url.pathname.slice(-7)))}
  if(req.method==='GET'&&url.pathname==='/api/export'){const payload={exportedAt:new Date().toISOString(),settings:settings(),schedule:schedule(),workouts:db.prepare('SELECT * FROM workouts ORDER BY date').all(),restDays:db.prepare('SELECT * FROM rest_days ORDER BY date').all(),achievements:achievements()};return send(res,200,payload,{'Content-Disposition':'attachment; filename="trainstreak-export.json"'})}
  if(req.method==='PUT'&&url.pathname==='/api/settings'){const b=await body(req),c=settings();const weeklyGoal=Number(b.weeklyGoal??c.weeklyGoal),monthlyGoal=Number(b.monthlyGoal??c.monthlyGoal);if(!Number.isInteger(weeklyGoal)||weeklyGoal<1||weeklyGoal>7||!Number.isInteger(monthlyGoal)||monthlyGoal<1||monthlyGoal>31)return send(res,400,{error:'Goals must be whole numbers: weekly 1–7, monthly 1–31.'});const reminderTime=String(b.reminderTime??c.reminderTime);if(!/^\d{2}:\d{2}$/.test(reminderTime))return send(res,400,{error:'Invalid reminder time.'});db.prepare('UPDATE settings SET name=?,weeklyGoal=?,monthlyGoal=?,reminderEnabled=?,reminderTime=?,weekStartDay=?,theme=?,onboardingDone=? WHERE id=1').run(String(b.name??c.name).slice(0,80),weeklyGoal,monthlyGoal,b.reminderEnabled==null?c.reminderEnabled:(b.reminderEnabled?1:0),reminderTime,Number.isInteger(b.weekStartDay)?Math.max(0,Math.min(6,b.weekStartDay)):c.weekStartDay,b.theme==='light'?'light':'dark',b.onboardingDone==null?c.onboardingDone:(b.onboardingDone?1:0));return send(res,200,{settings:{...settings(),reminderEnabled:!!settings().reminderEnabled,onboardingDone:!!settings().onboardingDone},stats:stats()})}
  if(req.method==='PUT'&&url.pathname==='/api/schedule'){const b=await body(req),s=b.schedule;if(!Array.isArray(s)||s.length!==7)return send(res,400,{error:'Schedule must contain 7 days.'});for(let i=0;i<7;i++)db.prepare('UPDATE schedule SET isWorkout=? WHERE day=?').run(s[i]?1:0,i);return send(res,200,{schedule:schedule(),stats:stats()})}
  if(req.method==='POST'&&url.pathname==='/api/workouts'){const b=await body(req),date=b.date||today();if(!isValidDate(date)||date>today())return send(res,400,{error:'Choose a valid past or current date.'});if(db.prepare('SELECT 1 FROM workouts WHERE date=?').get(date))return send(res,409,{error:'Workout already logged for this day.'});db.prepare('INSERT INTO workouts(date,completed,workoutType,note,createdAt) VALUES(?,?,?,?,?)').run(date,1,b.workoutType||null,String(b.note||'').slice(0,500),new Date().toISOString());db.prepare('DELETE FROM rest_days WHERE date=?').run(date);const newAchievements=checkAchievements();const st=stats();return send(res,201,{stats:st,newAchievements,motivation:motivation[Math.floor(Math.random()*motivation.length)]})}
  if(req.method==='PUT'&&url.pathname==='/api/workouts'){const b=await body(req),date=b.date;if(!isValidDate(date)||date>today())return send(res,400,{error:'Invalid workout date.'});if(!db.prepare('SELECT 1 FROM workouts WHERE date=?').get(date))return send(res,404,{error:'Workout not found.'});db.prepare('UPDATE workouts SET workoutType=?,note=? WHERE date=?').run(b.workoutType||null,String(b.note||'').slice(0,500),date);const newAchievements=checkAchievements();return send(res,200,{stats:stats(),newAchievements})}
  if(req.method==='DELETE'&&url.pathname.startsWith('/api/workouts/')){const date=url.pathname.slice('/api/workouts/'.length);if(!isValidDate(date))return send(res,400,{error:'Invalid date.'});db.prepare('DELETE FROM workouts WHERE date=?').run(date);return send(res,200,{stats:stats(),achievements:achievements()})}
  if(req.method==='PUT'&&url.pathname==='/api/rest-days'){const b=await body(req),date=b.date;if(!isValidDate(date)||date>today())return send(res,400,{error:'Invalid rest day date.'});db.prepare('DELETE FROM workouts WHERE date=?').run(date);db.prepare('INSERT INTO rest_days(date,reason) VALUES(?,?) ON CONFLICT(date) DO UPDATE SET reason=excluded.reason').run(date,String(b.reason||'').slice(0,300));return send(res,200,{stats:stats()})}
  if(req.method==='DELETE'&&url.pathname.startsWith('/api/rest-days/')){const date=url.pathname.slice('/api/rest-days/'.length);db.prepare('DELETE FROM rest_days WHERE date=?').run(date);return send(res,200,{stats:stats()})}
  if(req.method==='POST'&&url.pathname==='/api/reset'){db.exec(`DELETE FROM workouts;DELETE FROM rest_days;UPDATE achievements SET unlocked=0,unlockedAt=NULL;UPDATE settings SET name='',weeklyGoal=4,monthlyGoal=18,reminderEnabled=0,reminderTime='18:00',weekStartDay=1,theme='dark',onboardingDone=0;`);for(let i=0;i<7;i++)db.prepare('UPDATE schedule SET isWorkout=? WHERE day=?').run(defaults[i],i);return send(res,200,{ok:true})}
  if(req.method==='GET'&&!url.pathname.startsWith('/api/')&&staticFile(res,url.pathname))return;
  if(req.method==='GET'&&!url.pathname.startsWith('/api/'))return staticFile(res,'/index.html')?undefined:send(res,404,'Not found');
  send(res,404,{error:'Not found'});
 }catch(e){console.error(e);send(res,500,{error:'Something went wrong. Please try again.'})}
});

server.listen(PORT,()=>console.log(`TrainStreak running at http://localhost:${PORT}`));
