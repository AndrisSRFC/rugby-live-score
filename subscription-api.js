const crypto=require('crypto');
const PLANS=[{months:1,pence:200},{months:2,pence:400},{months:3,pence:500},{months:6,pence:900},{months:12,pence:1500}];
function addMonths(date,months){
 const d=new Date(date),day=d.getUTCDate();d.setUTCDate(1);d.setUTCMonth(d.getUTCMonth()+months);
 const end=new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,0)).getUTCDate();d.setUTCDate(Math.min(day,end));return d;
}
async function init(pool){await pool.query(`
 CREATE TABLE IF NOT EXISTS app_subscription_requests(
 id UUID PRIMARY KEY,install_id TEXT NOT NULL REFERENCES app_access(install_id),
 email TEXT NOT NULL,months INTEGER NOT NULL CHECK(months IN(1,2,3,6,12)),
 amount_pence INTEGER NOT NULL,club_pence INTEGER NOT NULL,
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN('pending','approved','activated','declined')),
 code_hash TEXT UNIQUE,code_expires_at TIMESTAMPTZ,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 approved_at TIMESTAMPTZ,activated_at TIMESTAMPTZ,subscription_until TIMESTAMPTZ);
 CREATE UNIQUE INDEX IF NOT EXISTS app_subscription_open_install ON app_subscription_requests(install_id) WHERE status IN('pending','approved');
`);}
function register(app,pool,adminPin){
 const valid=id=>/^[a-zA-Z0-9_-]{16,100}$/.test(id);
 const hash=value=>crypto.createHash('sha256').update(value).digest('hex');
 const wrap=fn=>async(req,res)=>{res.set('Cache-Control','no-store');try{await fn(req,res);}catch(e){console.error('Subscription request failed',e.code||e.name);if(!res.headersSent)res.status(500).json({error:'Could not complete request. Please try again.'});}};
 const admin=(req,res)=>{if(String(req.body?.pin||'')!==String(adminPin)){res.status(401).json({error:'Incorrect Admin PIN'});return false;}return true;};
 app.get('/api/subscription/plans',wrap(async(req,res)=>res.json({plans:PLANS,paymentInstructions:process.env.SUBSCRIPTION_PAYMENT_INSTRUCTIONS||'',paymentReady:!!process.env.SUBSCRIPTION_PAYMENT_INSTRUCTIONS})));
 app.post('/api/subscription/request',wrap(async(req,res)=>{
  const installId=String(req.body?.installId||''),email=String(req.body?.email||'').trim().toLowerCase(),plan=PLANS.find(p=>p.months===Number(req.body?.months));
  if(!valid(installId)||email.length>254||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||!plan)return res.status(400).json({error:'Select a period and enter a valid email.'});
  const exists=await pool.query('SELECT install_id FROM app_access WHERE install_id=$1',[installId]);if(!exists.rowCount)return res.status(400).json({error:'Register this app installation first.'});
  const inserted=await pool.query("INSERT INTO app_subscription_requests(id,install_id,email,months,amount_pence,club_pence) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING RETURNING id,status",[crypto.randomUUID(),installId,email,plan.months,plan.pence,plan.pence/2]);
  if(!inserted.rowCount)return res.status(409).json({error:'This installation already has an open request. Contact the administrator if it needs changing.'});
  res.json({ok:true,...inserted.rows[0]});
 }));
 app.post('/api/subscription/admin/list',wrap(async(req,res)=>{
  if(!admin(req,res))return;
  const rows=await pool.query('SELECT id,email,months,amount_pence,club_pence,status,created_at,approved_at,activated_at,subscription_until FROM app_subscription_requests ORDER BY created_at DESC LIMIT 200');
  res.json({requests:rows.rows});
 }));
 app.post('/api/subscription/admin/approve',wrap(async(req,res)=>{
  if(!admin(req,res))return;const id=String(req.body?.id||'');if(!/^[a-f0-9-]{36}$/i.test(id))return res.status(400).json({error:'Invalid request'});
  const code=crypto.randomBytes(16).toString('hex').toUpperCase();
  const r=await pool.query("UPDATE app_subscription_requests SET status='approved',code_hash=$2,code_expires_at=NOW()+INTERVAL '30 days',approved_at=COALESCE(approved_at,NOW()) WHERE id=$1 AND status IN('pending','approved') RETURNING email,months",[id,hash(code)]);
  if(!r.rowCount)return res.status(409).json({error:'Request is no longer awaiting activation.'});
  res.json({ok:true,code,...r.rows[0]});
 }));
 app.post('/api/subscription/admin/decline',wrap(async(req,res)=>{
  if(!admin(req,res))return;const id=String(req.body?.id||'');if(!/^[a-f0-9-]{36}$/i.test(id))return res.status(400).json({error:'Invalid request'});
  const r=await pool.query("UPDATE app_subscription_requests SET status='declined',code_hash=NULL WHERE id=$1 AND status IN('pending','approved') RETURNING id",[id]);
  if(!r.rowCount)return res.status(409).json({error:'Request cannot be declined.'});res.json({ok:true});
 }));
 const attempts=new Map();
 app.post('/api/subscription/activate',wrap(async(req,res)=>{
  const installId=String(req.body?.installId||''),code=String(req.body?.code||'').trim().toUpperCase().replace(/[\s-]/g,'');
  if(!valid(installId)||!/^[A-F0-9]{32}$/.test(code))return res.status(400).json({error:'Enter your activation code.'});
  const key=req.ip+':'+installId,now=Date.now();for(const [k,v]of attempts)if(v.until<now)attempts.delete(k);
  const limit=attempts.get(key)||{count:0,until:now+600000};if(limit.count>=10)return res.status(429).json({error:'Too many attempts. Try again in 10 minutes.'});limit.count++;attempts.set(key,limit);
  const client=await pool.connect();try{
   await client.query('BEGIN');
   const access=await client.query('SELECT access_status,subscription_until FROM app_access WHERE install_id=$1 FOR UPDATE',[installId]);
   if(!access.rowCount){await client.query('ROLLBACK');return res.status(400).json({error:'App installation not registered.'});}
   const r=await client.query("SELECT * FROM app_subscription_requests WHERE install_id=$1 AND code_hash=$2 AND status='approved' AND code_expires_at>NOW() FOR UPDATE",[installId,hash(code)]);
   if(!r.rowCount){await client.query('ROLLBACK');return res.status(400).json({error:'Code is invalid, expired, used, or belongs to another installation.'});}
   if(access.rows[0].access_status==='owner'){await client.query('ROLLBACK');return res.status(409).json({error:'Owner access does not require a subscription.'});}
   const current=access.rows[0].subscription_until,base=access.rows[0].access_status==='subscriber'&&current&&new Date(current)>new Date()?new Date(current):new Date();
   const until=addMonths(base,r.rows[0].months);
   await client.query("UPDATE app_access SET access_status='subscriber',subscription_until=$2,updated_at=NOW() WHERE install_id=$1",[installId,until]);
   await client.query("UPDATE app_subscription_requests SET status='activated',activated_at=NOW(),subscription_until=$2,code_hash=NULL WHERE id=$1",[r.rows[0].id,until]);
   await client.query('COMMIT');attempts.delete(key);res.json({ok:true,status:'subscriber',subscriptionUntil:until});
  }catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
 }));
}
module.exports={init,register,PLANS,addMonths};
