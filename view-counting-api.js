const crypto=require('crypto');
module.exports=function({pool,app,io,adminPin,teamKeys}){
 const keys=['HOME',...teamKeys];
 async function init(){
  await pool.query(`
   CREATE TABLE IF NOT EXISTS rugby_view_settings(id INTEGER PRIMARY KEY CHECK(id=1),enabled BOOLEAN NOT NULL DEFAULT FALSE,started_at TIMESTAMPTZ);
   INSERT INTO rugby_view_settings(id) VALUES(1) ON CONFLICT DO NOTHING;
   CREATE TABLE IF NOT EXISTS rugby_view_totals(page_key TEXT PRIMARY KEY,total BIGINT NOT NULL DEFAULT 0);
   CREATE TABLE IF NOT EXISTS rugby_counted_visits(page_key TEXT NOT NULL,visit_hash TEXT NOT NULL,PRIMARY KEY(page_key,visit_hash));
  `);
  for(const key of keys)await pool.query('INSERT INTO rugby_view_totals(page_key) VALUES($1) ON CONFLICT DO NOTHING',[key]);
 }
 async function totals(){
  const config=(await pool.query('SELECT enabled,started_at FROM rugby_view_settings WHERE id=1')).rows[0];
  const rows=(await pool.query('SELECT page_key,total FROM rugby_view_totals')).rows;
  const counts=Object.fromEntries(keys.map(k=>[k,0]));for(const r of rows)if(keys.includes(r.page_key))counts[r.page_key]=Number(r.total);
  const groups=Object.fromEntries(teamKeys.map(k=>[k,counts[k]]));
  return {enabled:!!config?.enabled,startedAt:config?.started_at||null,home:counts.HOME,groups,total:Object.values(counts).reduce((a,b)=>a+b,0)};
 }
 async function count(key,visitId,excluded){
  if(excluded||!keys.includes(key)||typeof visitId!=='string'||!/^[a-zA-Z0-9_-]{16,100}$/.test(visitId))return false;
  const client=await pool.connect();
  try{
   await client.query('BEGIN');
   const config=await client.query('SELECT enabled FROM rugby_view_settings WHERE id=1 FOR SHARE');
   if(!config.rows[0]?.enabled){await client.query('COMMIT');return false;}
   const hash=crypto.createHash('sha256').update(visitId).digest('hex');
   const added=await client.query('INSERT INTO rugby_counted_visits(page_key,visit_hash) VALUES($1,$2) ON CONFLICT DO NOTHING RETURNING page_key',[key,hash]);
   if(added.rowCount)await client.query('UPDATE rugby_view_totals SET total=total+1 WHERE page_key=$1',[key]);
   await client.query('COMMIT');return !!added.rowCount;
  }catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
 }
 async function send(socket,key,visitId,excluded){
  try{const changed=await count(key,visitId,excluded);const data=await totals();if(changed)io.emit('visitTotals',data);else socket.emit('visitTotals',data);}catch(e){console.error('View counting failed',e.name);}
 }
 app.get('/api/view-totals',async(req,res)=>{res.set('Cache-Control','no-store');try{res.json(await totals());}catch(e){res.status(503).json({error:'View totals temporarily unavailable.'});}});
 app.post('/api/view-counting/start',async(req,res)=>{
  res.set('Cache-Control','no-store');if(String(req.body?.pin||'')!==String(adminPin))return res.status(401).json({error:'Incorrect Admin PIN'});
  try{
   await pool.query('UPDATE rugby_view_settings SET enabled=TRUE,started_at=NOW() WHERE id=1 AND started_at IS NULL AND enabled=FALSE');
   const data=await totals();io.emit('visitTotals',data);res.json(data);
  }catch(e){res.status(500).json({error:'Could not start view counting.'});}
 });
 return {init,totals,count,send};
};