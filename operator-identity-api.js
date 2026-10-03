module.exports=function({pool,app,adminPin}){
 async function init(){
  await pool.query("ALTER TABLE match_control_requests ADD COLUMN IF NOT EXISTS operator_name TEXT; ALTER TABLE match_control_requests ADD COLUMN IF NOT EXISTS operator_email TEXT; ALTER TABLE match_control_requests ADD COLUMN IF NOT EXISTS heroes_consent BOOLEAN NOT NULL DEFAULT FALSE; ALTER TABLE match_control_access ADD COLUMN IF NOT EXISTS request_id INTEGER REFERENCES match_control_requests(id)");
  await pool.query("CREATE TABLE IF NOT EXISTS rugby_operator_coverage(request_id INTEGER NOT NULL REFERENCES match_control_requests(id),match_id UUID NOT NULL,team_key TEXT NOT NULL,first_action_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),last_action_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),PRIMARY KEY(request_id,match_id))");
 }
 function validate(body){
  if(typeof body?.operatorName!=='string'||typeof body?.operatorEmail!=='string')return {error:'Please enter your name and email address.'};
  const name=String(body?.operatorName||'').trim(),email=String(body?.operatorEmail||'').trim().toLowerCase();
  if(!name||name.length>80||/[\u0000-\u001f]/.test(name))return {error:'Please enter your name (up to 80 characters).'};
  if(email.length>254||! /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))return {error:'Please enter a valid email address.'};
  if(body?.heroesConsent!==undefined&&typeof body.heroesConsent!=='boolean')return {error:'Invalid publication consent.'};
  return {name,email,consent:body?.heroesConsent===true};
 }
 async function record(team,hash,matchId){
  await pool.query(`INSERT INTO rugby_operator_coverage(request_id,match_id,team_key)
   SELECT request_id,$3,$1 FROM match_control_access WHERE team_key=$1 AND session_hash=$2 AND pin_used=TRUE AND revoked=FALSE AND request_id IS NOT NULL
   ON CONFLICT(request_id,match_id) DO UPDATE SET last_action_at=NOW()`,[team,hash,matchId]);
 }
 app.post('/api/match-control/operators',async(req,res)=>{
  res.set('Cache-Control','no-store');
  if(String(req.body?.pin||'')!==String(adminPin))return res.status(401).json({error:'Incorrect Admin PIN'});
  try{const r=await pool.query(`SELECT r.operator_name AS name,r.operator_email AS email,r.team_key AS team,
   bool_and(r.heroes_consent) AS consent,COUNT(DISTINCT c.match_id)::int AS matches,MAX(c.last_action_at) AS last_covered
   FROM match_control_requests r LEFT JOIN rugby_operator_coverage c ON c.request_id=r.id
   WHERE r.status='approved' AND r.operator_email IS NOT NULL
   GROUP BY r.operator_name,r.operator_email,r.team_key ORDER BY MAX(r.decided_at) DESC LIMIT 200`);
   res.json(r.rows);
  }catch(e){console.error('Operator records error',e.name);res.status(500).json({error:'Could not load operators.'});}
 });
 return {init,validate,record};
};
