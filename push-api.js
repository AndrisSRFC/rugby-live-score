
const crypto=require('crypto');
module.exports=function({app,pool,teams,webpush=require('web-push')}){
 let keys,working=false;
 const hash=v=>crypto.createHash('sha256').update(v).digest('hex');
 const validId=v=>typeof v==='string'&&/^[a-zA-Z0-9_-]{16,100}$/.test(v);
 const wrap=fn=>async(req,res)=>{res.set('Cache-Control','no-store');try{await fn(req,res);}catch(e){console.error('Push operation failed',e.name);if(!res.headersSent)res.status(500).json({error:'Could not complete notification setup.'});}};
 const mobile=(req,res)=>{if(!/Android|iPhone|iPad|iPod/i.test(req.get('user-agent')||'')){res.status(403).json({error:'Notifications are available in the phone app.'});return false;}return true;};
 const active=async id=>(await pool.query("SELECT 1 FROM app_access WHERE install_id=$1 AND (access_status='owner' OR (access_status='subscriber' AND subscription_until>NOW()) OR (access_status='trial' AND trial_started_at+INTERVAL '30 days'>NOW()))",[id])).rowCount>0;
 function validSubscription(s){
  try{const u=new URL(s?.endpoint);return u.protocol==='https:'&&!u.username&&!u.password&&!u.port&&s.endpoint.length<=2048&&(u.hostname==='fcm.googleapis.com'||u.hostname==='updates.push.services.mozilla.com'||u.hostname==='web.push.apple.com'||u.hostname.endsWith('.push.apple.com'))&&typeof s.keys?.p256dh==='string'&&/^[A-Za-z0-9_-]{87,88}$/.test(s.keys.p256dh)&&typeof s.keys?.auth==='string'&&/^[A-Za-z0-9_-]{22,24}$/.test(s.keys.auth);}catch{return false;}
 }
 async function init(){
  await pool.query(`CREATE TABLE IF NOT EXISTS rugby_push_keys(id INTEGER PRIMARY KEY CHECK(id=1),public_key TEXT NOT NULL,private_key TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS rugby_push_subscriptions(endpoint_hash TEXT PRIMARY KEY,install_id TEXT NOT NULL REFERENCES app_access(install_id),subscription JSONB NOT NULL,updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
   CREATE TABLE IF NOT EXISTS rugby_push_events(id UUID PRIMARY KEY,match_id UUID NOT NULL,kind TEXT NOT NULL,payload JSONB NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),UNIQUE(match_id,kind));
   CREATE TABLE IF NOT EXISTS rugby_push_outbox(event_id UUID REFERENCES rugby_push_events(id),endpoint_hash TEXT NOT NULL,attempts INTEGER NOT NULL DEFAULT 0,done BOOLEAN NOT NULL DEFAULT FALSE,PRIMARY KEY(event_id,endpoint_hash));`);
  let r=await pool.query('SELECT public_key,private_key FROM rugby_push_keys WHERE id=1');
  if(!r.rowCount){const generated=webpush.generateVAPIDKeys();await pool.query('INSERT INTO rugby_push_keys(id,public_key,private_key) VALUES(1,$1,$2) ON CONFLICT DO NOTHING',[generated.publicKey,generated.privateKey]);r=await pool.query('SELECT public_key,private_key FROM rugby_push_keys WHERE id=1');}
  keys=r.rows[0];webpush.setVapidDetails(process.env.PUSH_VAPID_SUBJECT||'https://rugby-live-score-test.onrender.com',keys.public_key,keys.private_key);
 }
 app.get('/api/push/config',wrap(async(req,res)=>res.json({publicKey:keys?.public_key||null,ready:!!keys})));
 app.post('/api/push/subscribe',wrap(async(req,res)=>{
  if(!mobile(req,res))return;const {installId,subscription}=req.body||{};
  if(!validId(installId)||!validSubscription(subscription))return res.status(400).json({error:'Invalid notification subscription.'});
  if(!await active(installId))return res.status(403).json({error:'Active Trial or app access is required for match alerts.'});
  await pool.query("INSERT INTO rugby_push_subscriptions(endpoint_hash,install_id,subscription) VALUES($1,$2,$3::jsonb) ON CONFLICT(endpoint_hash) DO UPDATE SET install_id=EXCLUDED.install_id,subscription=EXCLUDED.subscription,updated_at=NOW()",[hash(subscription.endpoint),installId,JSON.stringify(subscription)]);
  res.json({ok:true});
 }));
 app.post('/api/push/unsubscribe',wrap(async(req,res)=>{
  if(!mobile(req,res))return;const {installId,endpoint}=req.body||{};if(!validId(installId)||typeof endpoint!=='string')return res.status(400).json({error:'Invalid installation.'});
  await pool.query('DELETE FROM rugby_push_subscriptions WHERE install_id=$1 AND endpoint_hash=$2',[installId,hash(endpoint)]);res.json({ok:true});
 }));
 const tests=new Map();
 app.post('/api/push/test',wrap(async(req,res)=>{
  if(!mobile(req,res))return;const id=req.body?.installId;if(!validId(id)||!await active(id))return res.status(403).json({error:'Active app access required.'});
  const now=Date.now();for(const [k,v]of tests)if(now-v>60000)tests.delete(k);if(tests.has(id))return res.status(429).json({error:'Wait one minute before another test.'});
  tests.set(id,now);const r=await pool.query('SELECT endpoint_hash,subscription FROM rugby_push_subscriptions WHERE install_id=$1',[id]);if(!r.rowCount)return res.status(400).json({error:'Enable notifications first.'});
  const results=await Promise.all(r.rows.map(s=>send(s,{title:'RUGBY LIVE',body:'Test notification — your phone is ready for match alerts.',url:'/',tag:'rugby-push-test'})));
  if(!results.some(Boolean))return res.status(502).json({error:'The push service did not accept the test. Enable notifications again.'});res.json({ok:true});
 }));
 async function send(s,payload){
  try{await webpush.sendNotification(s.subscription,JSON.stringify(payload),{TTL:600,urgency:'normal',timeout:10000});return true;}
  catch(e){if(e.statusCode===404||e.statusCode===410)await pool.query('DELETE FROM rugby_push_subscriptions WHERE endpoint_hash=$1',[s.endpoint_hash]);console.error('Push delivery failed',e.statusCode||e.name);return false;}
 }
 async function enqueue(team,kind,state){
  if(!keys||!teams.includes(team)||!['coverage','started','fulltime'].includes(kind))return;
  const title=team.match(/^U[0-9]+$/)?team+"'s":team;
  const body=kind==='fulltime'?'FULL TIME · '+state.homeName+' '+state.homeScore+' – '+state.awayScore+' '+state.awayName:(kind==='coverage'?'LIVE coverage started':'Match started')+' · '+state.homeName+' vs '+state.awayName;
  const payload={title:'RUGBY LIVE · '+title,body,url:'/live.html?team='+encodeURIComponent(team),tag:'rugby-'+state.matchId+'-'+kind};
  const client=await pool.connect();
  try{await client.query('BEGIN');const e=await client.query("INSERT INTO rugby_push_events(id,match_id,kind,payload) VALUES($1,$2,$3,$4::jsonb) ON CONFLICT(match_id,kind) DO NOTHING RETURNING id",[crypto.randomUUID(),state.matchId,kind,JSON.stringify(payload)]);
   if(e.rowCount)await client.query(`INSERT INTO rugby_push_outbox(event_id,endpoint_hash)
    SELECT $1,s.endpoint_hash FROM rugby_push_subscriptions s JOIN rugby_alert_preferences p ON p.install_id=s.install_id JOIN app_access a ON a.install_id=s.install_id
    WHERE p.groups ? $2 AND (a.access_status='owner' OR (a.access_status='subscriber' AND a.subscription_until>NOW()) OR (a.access_status='trial' AND a.trial_started_at+INTERVAL '30 days'>NOW()))
    ON CONFLICT DO NOTHING`,[e.rows[0].id,team]);
   await client.query('COMMIT');
  }catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
 }
 async function drain(){
  if(working||!keys)return;working=true;
  try{
   const r=await pool.query(`SELECT o.event_id,o.endpoint_hash,s.subscription,e.payload FROM rugby_push_outbox o JOIN rugby_push_events e ON e.id=o.event_id JOIN rugby_push_subscriptions s ON s.endpoint_hash=o.endpoint_hash JOIN app_access a ON a.install_id=s.install_id
    WHERE NOT o.done AND o.attempts<3 AND e.created_at>NOW()-INTERVAL '10 minutes'
    AND (a.access_status='owner' OR (a.access_status='subscriber' AND a.subscription_until>NOW()) OR (a.access_status='trial' AND a.trial_started_at+INTERVAL '30 days'>NOW())) ORDER BY e.created_at LIMIT 4`);
   await Promise.all(r.rows.map(async s=>{const ok=await send(s,s.payload);await pool.query('UPDATE rugby_push_outbox SET attempts=attempts+1,done=$3 WHERE event_id=$1 AND endpoint_hash=$2',[s.event_id,s.endpoint_hash,ok]);}));
  }catch(e){console.error('Push queue error',e.name);}finally{working=false;}
 }
 return {init,enqueue,drain,validSubscription};
};

