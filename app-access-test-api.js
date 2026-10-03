module.exports=function({pool,app,adminPin}){
 async function init(){await pool.query("CREATE TABLE IF NOT EXISTS rugby_app_access_tests(install_id TEXT PRIMARY KEY REFERENCES app_access(install_id),snapshot JSONB NOT NULL,started_at TIMESTAMPTZ NOT NULL DEFAULT NOW())");}
 app.post('/api/app-access/admin/test',async(req,res)=>{
  res.set('Cache-Control','no-store');
  const {pin,installId,action}=req.body||{};
  if(String(pin||'')!==String(adminPin))return res.status(401).json({error:'Incorrect Admin PIN'});
  if(typeof installId!=='string'||installId.length<10||installId.length>128||!['start','subscriber_2min','subscriber_expired','restore'].includes(action))return res.status(400).json({error:'Invalid access test.'});
  const client=await pool.connect();
  try{
   await client.query('BEGIN');
   const row=(await client.query('SELECT access_status,trial_started_at,subscription_until FROM app_access WHERE install_id=$1 FOR UPDATE',[installId])).rows[0];
   if(!row){await client.query('ROLLBACK');return res.status(404).json({error:'Open the installed app first to register this installation.'});}
   if(row.access_status==='owner'){await client.query('ROLLBACK');return res.status(409).json({error:'Owner access cannot be tested here.'});}
   let subscriptionUntil=null;
   if(action!=='restore'){
    await client.query('INSERT INTO rugby_app_access_tests(install_id,snapshot) VALUES($1,$2::jsonb) ON CONFLICT(install_id) DO NOTHING',[installId,JSON.stringify(row)]);
    if(action==='start'){
     await client.query("UPDATE app_access SET access_status='expired',trial_started_at=NOW()-INTERVAL '31 days',subscription_until=NULL,updated_at=NOW() WHERE install_id=$1",[installId]);
    }else{
     const changed=await client.query("UPDATE app_access SET access_status='subscriber',trial_started_at=NOW()-INTERVAL '31 days',subscription_until=NOW()+($2::int * INTERVAL '1 second'),updated_at=NOW() WHERE install_id=$1 RETURNING subscription_until",[installId,action==='subscriber_2min'?120:-1]);
     subscriptionUntil=changed.rows[0].subscription_until;
    }
   }else{
    const saved=(await client.query('SELECT snapshot,started_at FROM rugby_app_access_tests WHERE install_id=$1',[installId])).rows[0];
    if(!saved){await client.query('ROLLBACK');return res.status(404).json({error:'No saved test state to restore.'});}
    const s=saved.snapshot;
    await client.query('UPDATE app_access SET access_status=$2,trial_started_at=$3,subscription_until=$4,updated_at=NOW() WHERE install_id=$1',[installId,s.access_status,s.trial_started_at,s.subscription_until]);
    await client.query("UPDATE app_subscription_requests SET status='declined',code_hash=NULL WHERE install_id=$1 AND created_at>=$2 AND status IN ('pending','approved','activated')",[installId,saved.started_at]);
    await client.query('DELETE FROM rugby_app_access_tests WHERE install_id=$1',[installId]);
   }
   await client.query('COMMIT');res.json({ok:true,action,subscriptionUntil});
  }catch(e){await client.query('ROLLBACK');console.error('App access test error',e.name);res.status(500).json({error:'Could not change test access. Please try again.'});}finally{client.release();}
 });
 return {init};
};