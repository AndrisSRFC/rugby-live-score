module.exports=function(pool,adminPin){
 async function allowed(req){
  const pin=req.get('X-Admin-PIN');if(pin&&pin===String(adminPin))return true;
  const id=req.get('X-Rugby-Install');
  if(!id||!/^[a-zA-Z0-9_-]{16,100}$/.test(id))return false;
  const r=await pool.query('SELECT access_status,trial_started_at,subscription_until FROM app_access WHERE install_id=$1',[id]);
  if(!r.rowCount)return false;const row=r.rows[0],now=Date.now();
  if(row.access_status==='owner')return true;
  if(row.access_status==='subscriber'&&row.subscription_until&&new Date(row.subscription_until).getTime()>now)return true;
  return new Date(row.trial_started_at).getTime()+30*86400000>now;
 }
 async function requireAccess(req,res,next){
  res.set('Cache-Control','no-store');
  try{if(await allowed(req))return next();res.status(403).json({error:'Install Rugby LIVE and use an active trial or subscription to view this content.',code:'APP_ACCESS_REQUIRED'});}
  catch(e){console.error('App content access check failed',e.name);res.status(503).json({error:'Could not check app access. Please try again.'});}
 }
 return {allowed,requireAccess};
};