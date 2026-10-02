const crypto=require('crypto');
module.exports=function({pool,app,adminPin,teamKeys}){
 async function init(){await pool.query("CREATE TABLE IF NOT EXISTS rugby_touchline_heroes(id INTEGER PRIMARY KEY CHECK(id=1),revision INTEGER NOT NULL DEFAULT 0,heroes JSONB NOT NULL DEFAULT '[]'::jsonb); INSERT INTO rugby_touchline_heroes(id) VALUES(1) ON CONFLICT DO NOTHING");}
 const wrap=fn=>async(req,res)=>{res.set('Cache-Control','no-store');try{await fn(req,res);}catch(e){console.error('Touchline Heroes error',e.name);res.status(500).json({error:'Could not load or save heroes. Please try again.'});}};
 const admin=(req,res)=>{if(String(req.body?.pin||'')!==String(adminPin)){res.status(401).json({error:'Incorrect Admin PIN'});return false;}return true;};
 app.get('/api/touchline-heroes',wrap(async(req,res)=>{const r=await pool.query('SELECT heroes FROM rugby_touchline_heroes WHERE id=1');res.json((r.rows[0]?.heroes||[]).filter(h=>h.published).map(({name,group,matches})=>({name,group,matches})));}));
 app.post('/api/touchline-heroes/admin/read',wrap(async(req,res)=>{if(!admin(req,res))return;const r=await pool.query('SELECT heroes,revision FROM rugby_touchline_heroes WHERE id=1');res.json(r.rows[0]);}));
 app.post('/api/touchline-heroes/admin/save',wrap(async(req,res)=>{
  if(!admin(req,res))return;const data=req.body?.heroes,revision=req.body?.revision;
  if(!Array.isArray(data)||data.length>100||!Number.isInteger(revision)||revision<0)return res.status(400).json({error:'Invalid hero list.'});
  const heroes=[],ids=new Set();
  for(const h of data){
   if(!h||typeof h.name!=='string'||!h.name.trim()||h.name.trim().length>80||typeof h.published!=='boolean'||typeof h.group!=='string'||(h.group&&!teamKeys.includes(h.group))||(h.matches!==null&&(!Number.isInteger(h.matches)||h.matches<0||h.matches>10000)))return res.status(400).json({error:'Enter a name, valid group and a whole-number match count (or leave it blank).'});
   const id=h.id||crypto.randomUUID();if(!/^[a-f0-9-]{36}$/i.test(id)||ids.has(id))return res.status(400).json({error:'Invalid or duplicate hero.'});ids.add(id);
   heroes.push({id,name:h.name.trim(),group:h.group,matches:h.matches,published:h.published});
  }
  const r=await pool.query('UPDATE rugby_touchline_heroes SET heroes=$1::jsonb,revision=revision+1 WHERE id=1 AND revision=$2 RETURNING heroes,revision',[JSON.stringify(heroes),revision]);
  if(!r.rowCount)return res.status(409).json({error:'Another editor saved changes. Close and reopen this window to reload the latest list.'});res.json(r.rows[0]);
 }));
 return {init};
};