const crypto=require('crypto');
module.exports=function({pool,app,adminPin}){
 const keyFor=r=>crypto.createHash('sha256').update(JSON.stringify([r.name,r.email||null,r.team])).digest('hex');
 async function init(){
  await pool.query("ALTER TABLE match_control_requests ADD COLUMN IF NOT EXISTS operator_name TEXT; ALTER TABLE match_control_requests ADD COLUMN IF NOT EXISTS operator_email TEXT; ALTER TABLE match_control_requests ADD COLUMN IF NOT EXISTS heroes_consent BOOLEAN NOT NULL DEFAULT FALSE; ALTER TABLE match_control_access ADD COLUMN IF NOT EXISTS request_id INTEGER REFERENCES match_control_requests(id)");
  await pool.query("CREATE TABLE IF NOT EXISTS rugby_operator_coverage(request_id INTEGER NOT NULL REFERENCES match_control_requests(id),match_id UUID NOT NULL,team_key TEXT NOT NULL,first_action_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),last_action_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),PRIMARY KEY(request_id,match_id))");
  await pool.query("CREATE TABLE IF NOT EXISTS rugby_operator_record_flags(record_key TEXT PRIMARY KEY,archived BOOLEAN NOT NULL DEFAULT FALSE,deleted BOOLEAN NOT NULL DEFAULT FALSE,updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())");

 }
 function validate(body){
  if((body?.operatorName!==undefined&&typeof body.operatorName!=='string')||(body?.operatorEmail!==undefined&&typeof body.operatorEmail!=='string'))return {error:'Please enter your name and email address.'};
  const name=String(body?.operatorName||'').trim(),email=String(body?.operatorEmail||'').trim().toLowerCase();
  if(name.length>80||/[\u0000-\u001f]/.test(name))return {error:'Please enter your name (up to 80 characters).'};
  if(email && (email.length>254||! /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)))return {error:'Please enter a valid email address.'};
  if(body?.heroesConsent!==undefined&&typeof body.heroesConsent!=='boolean')return {error:'Invalid publication consent.'};
  return {name:name||null,email:email||null,consent:!!name&&body?.heroesConsent===true};
 }
 async function record(team,hash,matchId){
  await pool.query(`INSERT INTO rugby_operator_coverage(request_id,match_id,team_key)
   SELECT request_id,$3,$1 FROM match_control_access WHERE team_key=$1 AND session_hash=$2 AND pin_used=TRUE AND revoked=FALSE AND request_id IS NOT NULL AND EXISTS (SELECT 1 FROM match_control_requests r WHERE r.id=request_id AND r.operator_name IS NOT NULL)
   ON CONFLICT(request_id,match_id) DO UPDATE SET last_action_at=NOW()`,[team,hash,matchId]);
 }
 async function records(){
  const r=await pool.query(`SELECT r.operator_name AS name,r.operator_email AS email,r.team_key AS team,
   bool_and(r.heroes_consent) AS consent,COUNT(DISTINCT c.match_id)::int AS matches,MAX(c.last_action_at) AS last_covered
   FROM match_control_requests r LEFT JOIN rugby_operator_coverage c ON c.request_id=r.id
   WHERE r.status='approved' AND r.operator_name IS NOT NULL
   GROUP BY r.operator_name,r.operator_email,r.team_key ORDER BY MAX(r.decided_at) DESC`);
  const rewards=await pool.query('SELECT id,record_key,covered_through,created_at,activated_at,subscription_until,code_expires_at FROM rugby_operator_rewards ORDER BY created_at DESC');
  const flags=await pool.query('SELECT record_key,archived,deleted FROM rugby_operator_record_flags');
  const map=new Map(flags.rows.map(f=>[f.record_key,f]));
  return r.rows.map(row=>{const key=keyFor(row),flag=map.get(key);return {...row,key,archived:!!flag?.archived,deleted:!!flag?.deleted,rewards:rewards.rows.filter(r=>r.record_key===key)};});
 }
 const admin=(req,res)=>{res.set('Cache-Control','no-store');if(String(req.body?.pin||'')!==String(adminPin)){res.status(401).json({error:'Incorrect Admin PIN'});return false;}return true;};
 app.post('/api/match-control/operators',async(req,res)=>{
  if(!admin(req,res))return;
  try{res.json(await records());}catch(e){console.error('Operator records error',e.name);res.status(500).json({error:'Could not load operators.'});}
 });
 app.post('/api/match-control/operators/update',async(req,res)=>{
  if(!admin(req,res))return;
  const {key,action}=req.body||{};
  if(typeof key!=='string'||! /^[a-f0-9]{64}$/.test(key)||!['archive','restore','delete_test'].includes(action))return res.status(400).json({error:'Invalid operator action.'});
  try{
   const row=(await records()).find(r=>r.key===key);
   if(!row)return res.status(404).json({error:'Operator record not found.'});
   if(action==='delete_test'&&Number(row.matches)!==0)return res.status(409).json({error:'This operator has covered matches. Use Archive to retain their record.'});
   await pool.query(`INSERT INTO rugby_operator_record_flags(record_key,archived,deleted) VALUES($1,$2,$3)
    ON CONFLICT(record_key) DO UPDATE SET archived=EXCLUDED.archived,deleted=EXCLUDED.deleted,updated_at=NOW()`,[key,action==='archive',action==='delete_test']);
   res.json({ok:true});
  }catch(e){console.error('Operator record update error',e.name);res.status(500).json({error:'Could not update operator record.'});}
 });

 app.post('/api/match-control/operators/reward',async(req,res)=>{
  if(!admin(req,res))return;
  const key=req.body?.key;
  if(typeof key!=='string'||!/^[a-f0-9]{64}$/.test(key)||req.body?.confirmed!==true)return res.status(400).json({error:'Confirm that the operator has satisfactorily covered the matches.'});
  let client;
  try{
   client=await pool.connect();await client.query('BEGIN');
   await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',[key]);
   const row=(await records()).find(r=>r.key===key);
   if(!row||row.archived||row.deleted||!row.email){await client.query('ROLLBACK');return res.status(409).json({error:'An active operator record with an email is required.'});}
   const history=await client.query('SELECT * FROM rugby_operator_rewards WHERE record_key=$1 ORDER BY covered_through DESC FOR UPDATE',[key]);
   const pending=history.rows.find(r=>!r.activated_at);
   const through=history.rows.reduce((n,r)=>Math.max(n,r.covered_through),0);
   if(!pending&&Number(row.matches)<through+2){await client.query('ROLLBACK');return res.status(409).json({error:'Two additional covered matches are required for the next free month.'});}
   const code=crypto.randomBytes(16).toString('hex').toUpperCase(),hash=crypto.createHash('sha256').update(code).digest('hex');
   let reward;
   if(pending){reward=await client.query("UPDATE rugby_operator_rewards SET code_hash=$2,code_expires_at=NOW()+INTERVAL '30 days' WHERE id=$1 RETURNING id,created_at,covered_through,code_expires_at",[pending.id,hash]);}
   else{reward=await client.query("INSERT INTO rugby_operator_rewards(id,record_key,email,covered_through,code_hash,code_expires_at) VALUES($1,$2,$3,$4,$5,NOW()+INTERVAL '30 days') RETURNING id,created_at,covered_through,code_expires_at",[crypto.randomUUID(),key,row.email,through+2,hash]);}
   await client.query('COMMIT');res.json({ok:true,code,email:row.email,reissued:!!pending,reward:reward.rows[0]});
  }catch(e){if(client)await client.query('ROLLBACK');console.error('Operator reward error',e.name);res.status(500).json({error:'Could not issue reward.'});}finally{client?.release();}
 });
 return {init,validate,record};
};
