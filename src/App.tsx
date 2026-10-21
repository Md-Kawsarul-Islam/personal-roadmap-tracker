import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { supabase, isSupabaseConfigured } from './supabase';
import seedData from './seedData.json';
import type { Task, Track } from './types';
import { Activity, ArrowDownRight, ArrowUpRight, BookOpen, CalendarDays, Check, CheckCheck, ChevronDown, CircleHelp, Clock3, Code2, FileText, Flame, LayoutDashboard, LogOut, Menu, Plus, Search, Settings2, Sparkles, Target, TrendingUp, X } from 'lucide-react';

const tracks: {name:Track; icon:any; tint:string; description:string}[] = [
  {name:'IELTS',icon:BookOpen,tint:'violet',description:'English skills · 60-day plan'},
  {name:'Full Stack',icon:Code2,tint:'blue',description:'Build projects · 302-day plan'},
  {name:'Thesis',icon:FileText,tint:'orange',description:'Privacy-preserving document Q&A'},
  {name:'Routine',icon:CalendarDays,tint:'green',description:'Daily habits and responsibilities'},
];
const todayISO = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; };
const datePlus = (n:number) => { const d = new Date(); d.setDate(d.getDate()+n); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; };
const fmtDate = (d:string) => new Date(`${d}T12:00:00`).toLocaleDateString('en-US',{month:'short',day:'numeric'});
const id = () => crypto.randomUUID();
const taskCacheKey = (userId:string) => `daymark-tasks:${userId}`;
const pendingCacheKey = (userId:string) => `daymark-pending:${userId}`;
type PendingUpdate = { id:string; is_completed:boolean; completed_at:string|null };
function readCachedTasks(userId:string): Task[] {
  try { return JSON.parse(localStorage.getItem(taskCacheKey(userId)) || '[]') as Task[]; } catch { return []; }
}
function writeCachedTasks(userId:string, tasks:Task[]) {
  try { localStorage.setItem(taskCacheKey(userId), JSON.stringify(tasks)); } catch { /* browser storage may be full or unavailable */ }
}
function readPendingUpdates(userId:string): PendingUpdate[] {
  try { return JSON.parse(localStorage.getItem(pendingCacheKey(userId)) || '[]') as PendingUpdate[]; } catch { return []; }
}
function writePendingUpdates(userId:string, updates:PendingUpdate[]) {
  try { localStorage.setItem(pendingCacheKey(userId), JSON.stringify(updates)); } catch { /* best-effort offline queue */ }
}

export default function App() {
  const [session, setSession] = useState<any>(null);
  const [authLoading,setAuthLoading] = useState(true);
  const [email,setEmail] = useState(''); const [password,setPassword] = useState(''); const [authMode,setAuthMode] = useState<'signin'|'signup'>('signin'); const [authMessage,setAuthMessage] = useState('');
  const [tasks,setTasks] = useState<Task[]>([]); const [loading,setLoading] = useState(false); const [activeTrack,setActiveTrack] = useState<Track|'All'>('All'); const [page,setPage] = useState<'Overview'|'My Roadmaps'|'Calendar'|'Insights'>('Overview');
  const [selectedDate,setSelectedDate] = useState(todayISO()); const [query,setQuery] = useState(''); const [showAdd,setShowAdd] = useState(false); const [newTitle,setNewTitle] = useState(''); const [newTrack,setNewTrack] = useState<Track>('Routine'); const [newDate,setNewDate] = useState(todayISO()); const [newMinutes,setNewMinutes] = useState(25); const [saving,setSaving] = useState(false); const [toast,setToast] = useState(''); const [mobileNav,setMobileNav] = useState(false); const [selectedRoadmapDayKey,setSelectedRoadmapDayKey] = useState<string|null>(null); const [isOnline,setIsOnline] = useState(navigator.onLine); const [pendingCount,setPendingCount] = useState(0);

  useEffect(()=>{
    if (!supabase) { setAuthLoading(false); return; }
    supabase.auth.getSession().then(({data})=>{setSession(data.session);setAuthLoading(false);});
    const {data:{subscription}} = supabase.auth.onAuthStateChange((_event,s)=>{setSession(s);setAuthLoading(false);});
    return ()=>subscription.unsubscribe();
  },[]);

  const loadTasks = useCallback(async()=>{
    const userId = session?.user?.id as string | undefined;
    if (!userId) return;
    const cached = readCachedTasks(userId);
    if (cached.length) setTasks(cached);
    setPendingCount(readPendingUpdates(userId).length);
    if (!supabase || !navigator.onLine) { setLoading(false); return; }
    setLoading(true);
    // Supabase projects commonly cap a response at 1,000 rows; page through all roadmap tasks.
    const fetched: Task[] = [];
    let fetchError: {message:string} | null = null;
    for (let offset = 0; ; offset += 1000) {
      const {data, error} = await supabase.from('tasks').select('*').order('due_date').order('created_at').order('id').range(offset, offset + 999);
      if (error) { fetchError = error; break; }
      const batch = (data || []) as Task[];
      fetched.push(...batch);
      if (batch.length < 1000) break;
    }
    if (fetchError) {
      setToast(cached.length ? 'Offline mode: showing saved tasks. Changes will sync when you reconnect.' : `Could not load tasks: ${fetchError.message}`);
      setLoading(false);
      return;
    }
    const existing = fetched;
    // Restore any missing starter tasks so an interrupted first seed cannot stop at Day 47.
    const firstDayDate = existing.find(t => t.day_number === 1)?.due_date || cached.find(t => t.day_number === 1)?.due_date || todayISO();
    const seed = buildSeed(userId, firstDayDate);
    const taskKey = (t: { track: string; day_number: number | null; title: string }) => `${t.track}::${t.day_number ?? ''}::${t.title}`;
    const existingKeys = new Set(existing.map(taskKey));
    const missing = seed.filter(t => !existingKeys.has(taskKey(t)));
    const inserted: Task[] = [];
    let seedError: { message: string } | null = null;
    for (let i = 0; i < missing.length; i += 100) {
      const { data: batch, error: insertError } = await supabase.from('tasks').insert(missing.slice(i, i + 100)).select('*');
      if (insertError) { seedError = insertError; break; }
      inserted.push(...((batch as Task[]) || []));
    }
    if (seedError) setToast(`Some roadmap tasks could not be restored: ${seedError.message}`);
    const all = [...existing, ...inserted];
    // Keep locally queued completions visible until the server accepts them.
    const pending = readPendingUpdates(userId);
    const pendingById = new Map(pending.map(item => [item.id, item]));
    const merged = all.map(task => {
      const update = pendingById.get(task.id);
      return update ? {...task, is_completed:update.is_completed, completed_at:update.completed_at} : task;
    });
    setTasks(merged);
    writeCachedTasks(userId, merged);
    setPendingCount(pending.length);
    setLoading(false);
  },[session?.user?.id]);
  useEffect(()=>{ if(session?.user?.id) void loadTasks(); else setTasks([]); },[session?.user?.id,loadTasks]);

  const flushPendingUpdates = useCallback(async()=>{
    const userId = session?.user?.id as string | undefined;
    if (!userId || !supabase || !navigator.onLine) return;
    const pending = readPendingUpdates(userId);
    if (!pending.length) { setPendingCount(0); return; }
    const remaining: PendingUpdate[] = [];
    for (const item of pending) {
      const {error} = await supabase.from('tasks').update({is_completed:item.is_completed,completed_at:item.completed_at}).eq('id',item.id).eq('user_id',userId);
      if (error) remaining.push(item);
    }
    writePendingUpdates(userId, remaining);
    setPendingCount(remaining.length);
    if (remaining.length === 0) setToast('Offline progress synced to Supabase.');
  },[session?.user?.id]);

  useEffect(()=>{
    if (isOnline && session?.user?.id) void flushPendingUpdates();
  },[isOnline,session?.user?.id,flushPendingUpdates]);

  useEffect(()=>{
    const handleOnline = () => { setIsOnline(true); void flushPendingUpdates().then(()=>loadTasks()); };
    const handleOffline = () => { setIsOnline(false); };
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return ()=>{window.removeEventListener('online',handleOnline);window.removeEventListener('offline',handleOffline);};
  },[flushPendingUpdates,loadTasks]);

  useEffect(()=>{
    if (session?.user?.id && tasks.length) writeCachedTasks(session.user.id, tasks);
  },[tasks,session?.user?.id]);
  function buildSeed(userId:string, startDate=todayISO()): Omit<Task,'id'|'created_at'>[] {
    const out: Omit<Task,'id'|'created_at'>[]=[];
    const dueAt=(n:number)=>{const d=new Date(`${startDate}T12:00:00`);d.setDate(d.getDate()+n);return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;};
    (seedData.ielts as any[]).forEach((day)=>{
      const due=dueAt(day.day-1);
      day.tasks.forEach((task:string,i:number)=>out.push({user_id:userId,track:'IELTS',title:task,description:`Day ${day.day}: ${day.title}${day.note?` — ${day.note}`:''}`,due_date:due,day_number:day.day,is_completed:false,completed_at:null,estimated_minutes:25}));
    });
    (seedData.roadmap302 as any[]).forEach((day)=>{
      const due=dueAt(day.day-1);
      if(day.target) out.push({user_id:userId,track:'Full Stack',title:day.target,description:`${day.phase} · Day ${day.day} of your 302-day roadmap`,due_date:due,day_number:day.day,is_completed:false,completed_at:null,estimated_minutes:45});
      if(day.thesis) out.push({user_id:userId,track:'Thesis',title:day.thesis,description:`Thesis milestone · Day ${day.day} · ${day.phase}`,due_date:due,day_number:day.day,is_completed:false,completed_at:null,estimated_minutes:30});
    });
    const routines=[['Plan today','Choose the 3 most important outcomes for today.',10],['Focused study block','Complete one distraction-free study or project session.',45],['Daily review','Record what went well and choose tomorrow’s first task.',10]] as const;
    for(let day=1;day<=302;day++) for(const [title,description,minutes] of routines) out.push({user_id:userId,track:'Routine',title,description,due_date:dueAt(day-1),day_number:day,is_completed:false,completed_at:null,estimated_minutes:minutes});
    return out;
  }

  async function authenticate(e:FormEvent){e.preventDefault();setAuthMessage('');if(!supabase){setAuthMessage('Add your Supabase URL and anon/publishable key to .env.local first.');return;}setSaving(true);
    const result=authMode==='signup'?await supabase.auth.signUp({email,password}):await supabase.auth.signInWithPassword({email,password});
    if(result.error)setAuthMessage(result.error.message);else if(authMode==='signup'&&!result.data.session)setAuthMessage('Check your email to confirm your account, then sign in.');
    setSaving(false);
  }
  async function signOut(){if(supabase) await supabase.auth.signOut();setSession(null);setTasks([]);}
  async function toggleTask(task:Task){
    if(!session?.user?.id)return;
    const userId = session.user.id as string;
    const next = !task.is_completed;
    const completedAt = next ? new Date().toISOString() : null;
    const updatedTasks = tasks.map(t=>t.id===task.id?{...t,is_completed:next,completed_at:completedAt}:t);
    setTasks(updatedTasks);
    writeCachedTasks(userId, updatedTasks);
    if (!supabase || !navigator.onLine) {
      const pending = readPendingUpdates(userId).filter(item=>item.id!==task.id);
      pending.push({id:task.id,is_completed:next,completed_at:completedAt});
      writePendingUpdates(userId,pending);
      setPendingCount(pending.length);
      setToast('Saved on this phone. It will sync when internet returns.');
      return;
    }
    const {error}=await supabase.from('tasks').update({is_completed:next,completed_at:completedAt}).eq('id',task.id).eq('user_id',userId);
    if(error){
      const pending = readPendingUpdates(userId).filter(item=>item.id!==task.id);
      pending.push({id:task.id,is_completed:next,completed_at:completedAt});
      writePendingUpdates(userId,pending);
      setPendingCount(pending.length);
      setToast('Saved on this phone. Cloud sync will retry when connection is available.');
    } else {
      const pending = readPendingUpdates(userId).filter(item=>item.id!==task.id);
      writePendingUpdates(userId,pending); setPendingCount(pending.length);
    }
  }
  async function addTask(e:FormEvent){e.preventDefault();if(!supabase||!session?.user?.id||!newTitle.trim())return;setSaving(true);const row={user_id:session.user.id,track:newTrack,title:newTitle.trim(),description:'',due_date:newDate,day_number:null,is_completed:false,completed_at:null,estimated_minutes:newMinutes};const {data,error}=await supabase.from('tasks').insert(row).select('*').single();if(error)setToast(error.message);else{setTasks(old=>[...old,data as Task].sort((a,b)=>a.due_date.localeCompare(b.due_date)));setShowAdd(false);setNewTitle('');setToast('Task added and synced.');}setSaving(false);}

  const today=todayISO();
  const visibleTasks=useMemo(()=>tasks.filter(t=>(activeTrack==='All'||t.track===activeTrack)&&(page==='Calendar'?t.due_date===selectedDate:page==='My Roadmaps'?true:t.due_date<=today)&&(!query||`${t.title} ${t.description} ${t.track}`.toLowerCase().includes(query.toLowerCase()))),[tasks,activeTrack,page,selectedDate,today,query]);
  const roadmapDays=useMemo(()=>{const source=tasks.filter(t=>(activeTrack==='All'||t.track===activeTrack)&&(!query||`${t.title} ${t.description} ${t.track}`.toLowerCase().includes(query.toLowerCase())));const groups=new Map<string,{key:string;track:Track;day:number|null;date:string;items:Task[]}>();for(const task of source){const key=`${task.track}-${task.day_number??task.due_date}`;if(!groups.has(key))groups.set(key,{key,track:task.track,day:task.day_number,date:task.due_date,items:[]});groups.get(key)!.items.push(task);}return [...groups.values()].sort((a,b)=>a.date.localeCompare(b.date)||a.track.localeCompare(b.track)||(a.day??0)-(b.day??0));},[tasks,activeTrack,query]);
  const selectedRoadmapDay=roadmapDays.find(d=>d.key===selectedRoadmapDayKey)??null;
  const todayTasks=tasks.filter(t=>t.due_date===today);const completedToday=todayTasks.filter(t=>t.is_completed).length;const totalCompleted=tasks.filter(t=>t.is_completed).length;const overall=tasks.length?Math.round(totalCompleted/tasks.length*100):0;
  const trackStats=tracks.map(t=>{const list=tasks.filter(x=>x.track===t.name);return {...t,total:list.length,done:list.filter(x=>x.is_completed).length,today:list.filter(x=>x.due_date===today).length};});
  const upcoming=tasks.filter(t=>!t.is_completed&&t.due_date>today).sort((a,b)=>a.due_date.localeCompare(b.due_date)).slice(0,5);
  const dayLabel=new Date(`${today}T12:00:00`).toLocaleDateString('en-US',{weekday:'long',month:'long',day:'numeric'});
  const greeting=(()=>{const h=new Date().getHours();return h<12?'Good morning':h<17?'Good afternoon':'Good evening';})();

  if(authLoading)return <div className="center-screen"><div className="loader"/><p>Preparing your workspace…</p></div>;
  if(!session)return <div className="auth-shell"><div className="auth-art"><div className="brand light"><span className="brand-mark"><Sparkles size={20}/></span><span>daymark</span></div><div className="auth-copy"><span className="eyebrow">YOUR PERSONAL PROGRESS SYSTEM</span><h1>Small steps.<br/><em>Big direction.</em></h1><p>One calm place for your IELTS preparation, developer journey, thesis milestones, and everyday routine.</p><div className="auth-pills"><span><BookOpen size={15}/> IELTS</span><span><Code2 size={15}/> Full Stack</span><span><FileText size={15}/> Thesis</span></div></div><div className="art-bottom">Designed for progress, not perfection. <span>✳</span></div></div><div className="auth-panel"><div className="auth-mobile-brand"><span className="brand-mark"><Sparkles size={19}/></span> daymark</div><div className="auth-card"><span className="eyebrow">WELCOME TO DAYMARK</span><h2>{authMode==='signin'?'Welcome back':'Create your workspace'}</h2><p className="muted">{authMode==='signin'?'Sign in to continue your journey.':'Your roadmap progress will sync across your devices.'}</p><form onSubmit={authenticate} className="auth-form"><label>Email address<input type="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="you@example.com" required autoComplete="email"/></label><label>Password<input type="password" value={password} onChange={e=>setPassword(e.target.value)} placeholder="At least 6 characters" required minLength={6} autoComplete={authMode==='signin'?'current-password':'new-password'}/></label>{authMessage&&<div className="form-message">{authMessage}</div>}<button className="primary-btn full" disabled={saving}>{saving?'Please wait…':authMode==='signin'?'Sign in':'Create account'}</button></form><div className="auth-switch">{authMode==='signin'?"Don't have an account?":"Already have an account?"} <button onClick={()=>{setAuthMode(authMode==='signin'?'signup':'signin');setAuthMessage('');}}>{authMode==='signin'?'Create one':'Sign in'}</button></div>{!isSupabaseConfigured&&<div className="setup-note"><CircleHelp size={17}/><div><b>One-time setup needed</b><br/>Connect Supabase by following <code>README.md</code>. Authentication and cloud storage are intentionally not simulated.</div></div>}</div><p className="auth-footer">Private by default · Your tasks belong to your account</p></div></div>;

  return <div className="app-shell"><aside className={`sidebar ${mobileNav?'open':''}`}><div className="brand"><span className="brand-mark"><Sparkles size={19}/></span><span>daymark</span><button className="close-nav" onClick={()=>setMobileNav(false)}><X size={18}/></button></div><div className="workspace-label">WORKSPACE</div><nav className="main-nav">{[{name:'Overview',icon:LayoutDashboard},{name:'My Roadmaps',icon:Target},{name:'Calendar',icon:CalendarDays},{name:'Insights',icon:TrendingUp}].map(n=><button key={n.name} className={`nav-item ${page===n.name?'active':''}`} onClick={()=>{setPage(n.name as any);setMobileNav(false);}}><n.icon size={18}/><span>{n.name}</span>{n.name==='My Roadmaps'&&<span className="nav-count">4</span>}</button>)}</nav><div className="sidebar-label">YOUR TRACKS</div><div className="track-nav">{tracks.map(t=><button key={t.name} className={`track-nav-item ${activeTrack===t.name?'selected':''}`} onClick={()=>{setActiveTrack(activeTrack===t.name?'All':t.name);setPage('My Roadmaps');setMobileNav(false);}}><span className={`track-dot ${t.tint}`}/><span>{t.name}</span><span className="track-num">{tasks.filter(x=>x.track===t.name&&!x.is_completed).length}</span></button>)}</div><div className="sidebar-bottom"><div className="focus-card"><div className="focus-icon"><Flame size={17}/></div><b>Keep your streak alive</b><p>Consistency beats intensity. One task at a time.</p><div className="focus-progress"><span style={{width:`${todayTasks.length?completedToday/todayTasks.length*100:0}%`}}/></div><small>{completedToday} of {todayTasks.length} tasks done today</small></div><button className="user-row" onClick={signOut}><div className="avatar">{session.user.email?.[0]?.toUpperCase()||'U'}</div><div className="user-details"><b>{session.user.email?.split('@')[0]}</b><small>{session.user.email}</small></div><LogOut size={16}/></button></div></aside>
    {mobileNav&&<button className="nav-backdrop" onClick={()=>setMobileNav(false)} aria-label="Close navigation"/>}
    <main className="main-area"><header className="topbar"><div className="top-left"><button className="menu-btn" onClick={()=>setMobileNav(true)}><Menu size={21}/></button><div className="breadcrumbs"><span>Workspace</span><span className="crumb-slash">/</span><b>{page}</b></div></div><div className="top-actions"><span className={`sync-status ${isOnline ? 'online' : 'offline'}`} title={pendingCount ? `${pendingCount} change(s) waiting to sync` : isOnline ? 'Connected' : 'Offline mode'}><i/>{isOnline ? (pendingCount ? `${pendingCount} pending` : 'Synced') : 'Offline'}</span><div className="searchbox"><Search size={16}/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search tasks…"/><kbd>⌘ K</kbd></div><button className="icon-btn" title="Settings"><Settings2 size={18}/></button><div className="avatar top-avatar">{session.user.email?.[0]?.toUpperCase()||'U'}</div></div></header>
      <div className="content-wrap"><div className="page-heading"><div><div className="date-kicker"><span className="date-dot"/>{dayLabel}</div><h1>{page==='Overview'?`${greeting}, let's make today count.`:page==='My Roadmaps'?'Your roadmaps':page==='Calendar'?'Your calendar':'Progress insights'}</h1><p>{page==='Overview'?'A clear plan makes progress easier. Here’s your day at a glance.':page==='My Roadmaps'?'Every goal, broken into manageable daily actions.':page==='Calendar'?'Review what you planned and completed on each day.':'Look back at your consistency and keep moving forward.'}</p></div><button className="primary-btn" onClick={()=>{setNewTrack(activeTrack==='All'?'Routine':activeTrack);setNewDate(page==='Calendar'?selectedDate:today);setShowAdd(true);}}><Plus size={17}/> Add task</button></div>
      {page==='Overview'&&<><section className="welcome-banner"><div className="banner-copy"><span className="banner-label"><Sparkles size={14}/> YOUR DAILY RESET</span><h2>Progress is built one day at a time.</h2><p>Focus on the next right action. Your bigger goals will follow.</p><button className="banner-link" onClick={()=>{setPage('My Roadmaps');setActiveTrack('All');}}>View all roadmaps <ArrowUpRight size={15}/></button></div><div className="banner-illustration"><div className="orbit orbit-one"/><div className="orbit orbit-two"/><div className="banner-sun"><Target size={32}/></div><div className="float-card float-card-one"><CheckCheck size={15}/> Daily goals</div><div className="float-card float-card-two"><TrendingUp size={15}/> Keep growing</div></div></section>
      <section className="stat-grid"><div className="stat-card"><div className="stat-top"><span>Today's progress</span><span className="stat-icon purple"><CheckCheck size={17}/></span></div><div className="stat-value">{completedToday}<small> / {todayTasks.length}</small></div><div className="stat-bottom"><div className="mini-progress"><span style={{width:`${todayTasks.length?completedToday/todayTasks.length*100:0}%`}}/></div><span>{todayTasks.length?Math.round(completedToday/todayTasks.length*100):0}%</span></div></div><div className="stat-card"><div className="stat-top"><span>Overall completion</span><span className="stat-icon blue"><Activity size={17}/></span></div><div className="stat-value">{overall}<small>%</small></div><div className="stat-caption"><span className="positive"><ArrowUpRight size={14}/>{totalCompleted} completed</span><span>across all tracks</span></div></div><div className="stat-card"><div className="stat-top"><span>Planned focus</span><span className="stat-icon orange"><Clock3 size={17}/></span></div><div className="stat-value">{Math.round(todayTasks.filter(t=>!t.is_completed).reduce((n,t)=>n+t.estimated_minutes,0)/60*10)/10}<small> hrs</small></div><div className="stat-caption"><span>Estimated remaining time</span></div></div><div className="stat-card"><div className="stat-top"><span>Tasks remaining</span><span className="stat-icon green"><Target size={17}/></span></div><div className="stat-value">{tasks.length-totalCompleted}</div><div className="stat-caption"><span>{tasks.length} total tasks seeded</span></div></div></section>
      <div className="section-row"><div><h2>Your tracks</h2><p>Four areas, one place to keep moving.</p></div><button className="text-link" onClick={()=>{setPage('My Roadmaps');setActiveTrack('All');}}>See all <ArrowUpRight size={14}/></button></div><section className="track-grid">{trackStats.map(t=><button className="roadmap-card" key={t.name} onClick={()=>{setActiveTrack(t.name);setPage('My Roadmaps');}}><div className="roadmap-card-top"><span className={`roadmap-icon ${t.tint}`}><t.icon size={20}/></span><span className="card-arrow"><ArrowUpRight size={16}/></span></div><h3>{t.name}</h3><p>{t.description}</p><div className="roadmap-progress-row"><span>{t.done} of {t.total} tasks</span><b>{t.total?Math.round(t.done/t.total*100):0}%</b></div><div className="roadmap-progress"><span className={t.tint} style={{width:`${t.total?t.done/t.total*100:0}%`}}/></div><div className="roadmap-card-foot"><span>{t.today} planned today</span><span className={`status-pill ${t.tint}`}>{t.name==='IELTS'?'60 days':t.name==='Routine'?'Daily':'302 days'}</span></div></button>)}</section>
      <div className="lower-grid"><section className="panel today-panel"><div className="panel-heading"><div><h2>Today's checklist</h2><p>{completedToday} completed · {todayTasks.length-completedToday} to go</p></div><button className="circle-action" onClick={()=>{setPage('Calendar');setSelectedDate(today);}}><ArrowUpRight size={17}/></button></div><div className="filter-tabs"><button className={activeTrack==='All'?'on':''} onClick={()=>setActiveTrack('All')}>All tasks</button>{tracks.map(t=><button key={t.name} className={activeTrack===t.name?'on':''} onClick={()=>setActiveTrack(t.name)}>{t.name}</button>)}</div><div className="task-list">{todayTasks.filter(t=>activeTrack==='All'||t.track===activeTrack).slice(0,7).map(t=><TaskRow key={t.id} task={t} onToggle={toggleTask}/>)}{todayTasks.filter(t=>activeTrack==='All'||t.track===activeTrack).length===0&&<EmptyState text="No tasks for this filter today."/>}</div><button className="panel-footer-link" onClick={()=>{setPage('Calendar');setSelectedDate(today);}}>Open today's plan <ArrowUpRight size={15}/></button></section><section className="panel upcoming-panel"><div className="panel-heading"><div><h2>Coming up next</h2><p>Your next planned actions</p></div><CalendarDays size={19} className="muted-icon"/></div><div className="upcoming-list">{upcoming.map(t=><div className="upcoming-row" key={t.id}><div className={`upcoming-date ${t.track==='IELTS'?'violet':t.track==='Full Stack'?'blue':t.track==='Thesis'?'orange':'green'}`}><b>{new Date(`${t.due_date}T12:00:00`).getDate()}</b><small>{new Date(`${t.due_date}T12:00:00`).toLocaleDateString('en-US',{month:'short'}).toUpperCase()}</small></div><div className="upcoming-info"><b>{t.title}</b><small>{t.track} · {t.estimated_minutes} min</small></div></div>)}{upcoming.length===0&&<EmptyState text="You're all caught up. Add a task for a future day."/>}</div><button className="panel-footer-link" onClick={()=>setPage('Calendar')}>View calendar <ArrowUpRight size={15}/></button></section></div></>}
      {page === 'My Roadmaps' && <>
        <div className="roadmap-summary">
          <div><span className="eyebrow">ACTIVE TRACK</span><h2>{activeTrack === 'All' ? 'All of your goals' : activeTrack}</h2><p>{activeTrack === 'All' ? 'Choose a track or use the filters below to focus your next action.' : tracks.find(t => t.name === activeTrack)?.description}</p></div>
          <div className="summary-number"><b>{visibleTasks.filter(t => t.is_completed).length}</b><span>completed in view</span></div>
        </div>
        <div className="roadmap-filter-row"><div className="pill-tabs"><button className={activeTrack === 'All' ? 'active' : ''} onClick={() => setActiveTrack('All')}>All tracks</button>{tracks.map(t => <button key={t.name} className={activeTrack === t.name ? 'active' : ''} onClick={() => setActiveTrack(t.name)}>{t.name}</button>)}</div><span className="muted small-text">{visibleTasks.length} tasks shown</span></div>
        <section className="roadmap-day-grid">{roadmapDays.map(day=>{const done=day.items.filter(t=>t.is_completed).length;const tint=tracks.find(t=>t.name===day.track)?.tint??'violet';return <button key={day.key} className={`roadmap-day-card ${tint} ${day.items.length&&done===day.items.length?'completed':''}`} onClick={()=>setSelectedRoadmapDayKey(day.key)}><span className="roadmap-day-top"><span className="roadmap-day-track">{day.track}</span><span className="roadmap-day-arrow"><ArrowUpRight size={15}/></span></span><strong>{day.day?`Day ${day.day}`:fmtDate(day.date)}</strong><span className="roadmap-day-date">{new Date(`${day.date}T12:00:00`).toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric'})}</span><span className="roadmap-day-task-count">{done}/{day.items.length} tasks complete</span><span className="roadmap-day-progress"><i style={{width:`${day.items.length?done/day.items.length*100:0}%`}}/></span></button>})}{roadmapDays.length===0&&<section className="panel roadmap-task-panel"><EmptyState text={loading?'Loading your tasks…':'No matching days. Try another track or add your own.'}/></section>}</section>
      </>}
      {page==='Calendar'&&<><section className="panel calendar-panel"><div className="calendar-head"><div><h2>Daily plan</h2><p>Select a date to see the checklist for that day.</p></div><label className="date-input-label">Selected date<input type="date" value={selectedDate} onChange={e=>setSelectedDate(e.target.value)}/></label></div><div className="week-strip">{Array.from({length:7},(_,i)=>{const d=new Date(`${selectedDate}T12:00:00`);d.setDate(d.getDate()-3+i);const iso=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;const dayTasks=tasks.filter(t=>t.due_date===iso);return <button key={iso} className={`week-day ${iso===selectedDate?'chosen':''}`} onClick={()=>setSelectedDate(iso)}><small>{d.toLocaleDateString('en-US',{weekday:'short'})}</small><b>{d.getDate()}</b><span className="day-markers">{dayTasks.slice(0,3).map(t=><i key={t.id} className={t.is_completed?'done-marker':t.track==='IELTS'?'violet-marker':t.track==='Full Stack'?'blue-marker':t.track==='Thesis'?'orange-marker':'green-marker'}/>)}</span></button>})}</div><div className="calendar-date-title"><h3>{new Date(`${selectedDate}T12:00:00`).toLocaleDateString('en-US',{weekday:'long',month:'long',day:'numeric',year:'numeric'})}</h3><span>{tasks.filter(t=>t.due_date===selectedDate&&t.is_completed).length} / {tasks.filter(t=>t.due_date===selectedDate).length} done</span></div><div className="task-list roomy">{tasks.filter(t=>t.due_date===selectedDate&&(activeTrack==='All'||t.track===activeTrack)).filter(t=>!query||t.title.toLowerCase().includes(query.toLowerCase())).map(t=><TaskRow key={t.id} task={t} onToggle={toggleTask}/>)}{tasks.filter(t=>t.due_date===selectedDate&&(activeTrack==='All'||t.track===activeTrack)).length===0&&<EmptyState text="No tasks planned for this date."/>}</div></section></>}
      {page==='Insights'&&<><section className="insight-hero"><div><span className="eyebrow">YOUR PROGRESS, AT A GLANCE</span><h2>Every checked box counts.</h2><p>Measure consistency without expecting every day to be perfect.</p></div><div className="insight-total"><span>All-time completion</span><b>{overall}%</b><div className="roadmap-progress"><span className="violet" style={{width:`${overall}%`}}/></div></div></section><div className="section-row"><div><h2>Track breakdown</h2><p>Progress across your four focus areas.</p></div></div><section className="insight-track-list">{trackStats.map(t=><div className="insight-track" key={t.name}><span className={`roadmap-icon ${t.tint}`}><t.icon size={19}/></span><div className="insight-track-info"><div><b>{t.name}</b><span>{t.done} / {t.total} completed</span></div><div className="roadmap-progress"><span className={t.tint} style={{width:`${t.total?t.done/t.total*100:0}%`}}/></div></div><strong>{t.total?Math.round(t.done/t.total*100):0}%</strong></div>)}</section><div className="section-row"><div><h2>Recently completed</h2><p>Small wins worth noticing.</p></div></div><section className="panel"><div className="task-list roomy">{tasks.filter(t=>t.is_completed).sort((a,b)=>(b.completed_at||'').localeCompare(a.completed_at||'')).slice(0,10).map(t=><TaskRow key={t.id} task={t} onToggle={toggleTask} showDate/>)}{totalCompleted===0&&<EmptyState text="Your completed tasks will appear here. Start with one small action today."/>}</div></section></>}
      <footer className="page-footer"><span>Made for steady progress <span className="footer-star">✳</span></span><span>Daymark · Your goals, one day at a time</span></footer></div></main>
    {selectedRoadmapDay&&<div className="modal-backdrop roadmap-day-backdrop" onClick={()=>setSelectedRoadmapDayKey(null)}><div className="modal roadmap-day-modal" onClick={e=>e.stopPropagation()}><div className="modal-head"><div><span className="eyebrow">{selectedRoadmapDay.track.toUpperCase()} ROADMAP</span><h2>{selectedRoadmapDay.day?`Day ${selectedRoadmapDay.day}`:'Daily tasks'}</h2><p className="modal-day-subtitle">{new Date(`${selectedRoadmapDay.date}T12:00:00`).toLocaleDateString('en-US',{weekday:'long',month:'long',day:'numeric',year:'numeric'})} · {selectedRoadmapDay.items.filter(t=>t.is_completed).length}/{selectedRoadmapDay.items.length} completed</p></div><button className="icon-btn" onClick={()=>setSelectedRoadmapDayKey(null)} aria-label="Close day tasks"><X size={19}/></button></div><div className="task-list roomy roadmap-modal-tasks">{selectedRoadmapDay.items.map(t=><TaskRow key={t.id} task={t} onToggle={toggleTask}/>)}</div><div className="modal-actions"><button className="primary-btn" onClick={()=>setSelectedRoadmapDayKey(null)}>Done</button></div></div></div>}
    {showAdd&&<div className="modal-backdrop" onClick={()=>setShowAdd(false)}><div className="modal" onClick={e=>e.stopPropagation()}><div className="modal-head"><div><span className="eyebrow">MAKE IT ACTIONABLE</span><h2>Add a task</h2></div><button className="icon-btn" onClick={()=>setShowAdd(false)}><X size={19}/></button></div><form onSubmit={addTask} className="add-form"><label>Task name<input value={newTitle} onChange={e=>setNewTitle(e.target.value)} placeholder="e.g. Write thesis methodology outline" required autoFocus/></label><label>Track<select value={newTrack} onChange={e=>setNewTrack(e.target.value as Track)}>{tracks.map(t=><option key={t.name}>{t.name}</option>)}</select></label><div className="form-two"><label>Due date<input type="date" value={newDate} onChange={e=>setNewDate(e.target.value)} required/></label><label>Estimate (minutes)<input type="number" min="5" max="600" step="5" value={newMinutes} onChange={e=>setNewMinutes(Number(e.target.value))}/></label></div><div className="modal-actions"><button type="button" className="secondary-btn" onClick={()=>setShowAdd(false)}>Cancel</button><button className="primary-btn" disabled={saving}><Plus size={16}/>{saving?'Saving…':'Save task'}</button></div></form></div></div>}
    {toast&&<div className="toast"><span>{toast}</span><button onClick={()=>setToast('')}><X size={15}/></button></div>}
  </div>;
}

function TaskRow({task,onToggle,showDate=false}:{task:Task;onToggle:(t:Task)=>void;showDate?:boolean}){const t=tracks.find(x=>x.name===task.track)!;return <div className={`task-row ${task.is_completed?'is-done':''}`}><button className={`task-check ${task.is_completed?'checked':''}`} onClick={()=>onToggle(task)} aria-label={task.is_completed?'Mark incomplete':'Mark complete'}>{task.is_completed&&<Check size={14}/>}</button><div className="task-main"><div className="task-title-line"><b>{task.title}</b>{task.day_number&&<span className="day-tag">Day {task.day_number}</span>}</div>{task.description&&<p>{task.description}</p>}<div className="task-meta"><span className={`track-chip ${t.tint}`}><span className={`track-dot ${t.tint}`}/>{task.track}</span><span><Clock3 size={12}/>{task.estimated_minutes} min</span>{showDate&&<span><CalendarDays size={12}/>{fmtDate(task.due_date)}</span>}</div></div>{task.is_completed&&<span className="done-label">Done</span>}</div>}
function EmptyState({text}:{text:string}){return <div className="empty-state"><div className="empty-icon"><CheckCheck size={19}/></div><p>{text}</p></div>}
