const crypto=require('crypto');
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
async function init(pool){
  await pool.query(`CREATE TABLE IF NOT EXISTS rugby_nld_polls (
    match_id INTEGER PRIMARY KEY REFERENCES season_matches(id) ON DELETE CASCADE,
    state TEXT NOT NULL DEFAULT 'open' CHECK(state IN ('open','closed','published')),
    candidates JSONB NOT NULL, winner_id UUID REFERENCES rugby_players(id),
    opened_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),closed_at TIMESTAMPTZ,published_at TIMESTAMPTZ
  )`);
  await pool.query(`CREATE TABLE IF NOT EXISTS rugby_nld_votes (
    match_id INTEGER NOT NULL REFERENCES rugby_nld_polls(match_id) ON DELETE CASCADE,
    voter_hash TEXT NOT NULL, player_id UUID NOT NULL REFERENCES rugby_players(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),PRIMARY KEY(match_id,voter_hash)
  )`);
}
function register({app,pool,adminPin,teamIds}){
  const secret=process.env.VOTING_SECRET || String(adminPin);
  const sign=value=>crypto.createHmac('sha256',secret).update(value).digest('hex');
  const limits=new Map();
  function publicHeaders(res){res.set('Cache-Control','no-store');}
  function auth(req,res){
    publicHeaders(res);
    if(String(req.body?.pin)!==String(adminPin)){res.status(401).json({error:'Incorrect Admin PIN'});return false;}
    if(!Object.hasOwn(teamIds,req.body?.team)){res.status(400).json({error:'Invalid age group'});return false;}
    return true;
  }
  function fail(res,e){console.error('NLD voting error:',e);res.status(500).json({error:'Voting is temporarily unavailable. Please try again.'});}
  function voter(req,res,existingOnly=false){
    const raw=String(req.headers.cookie || '').split(';').map(s=>s.trim()).find(s=>s.startsWith('rugbyVote='))?.slice(10) || '';
    const parts=raw.split('.');
    let token=parts[0];
    const signature=parts[1];
    if(!/^[a-f0-9]{48}$/.test(token || '') || !/^[a-f0-9]{64}$/.test(signature || '') || !crypto.timingSafeEqual(Buffer.from(sign(token)),Buffer.from(signature))){
      if(existingOnly)return null;
      token=crypto.randomBytes(24).toString('hex');
      res.cookie('rugbyVote',token+'.'+sign(token),{httpOnly:true,sameSite:'lax',secure:req.secure || req.headers['x-forwarded-proto']==='https',maxAge:365*24*60*60*1000,path:'/'});
    }
    return sign('voter:'+token);
  }
  function limited(hash,res){
    const key=hash,now=Date.now();
    if(limits.size>5000)for(const [k,v] of limits)if(v.until<now)limits.delete(k);
    let v=limits.get(key);if(!v || v.until<now){v={count:0,until:now+60000};limits.set(key,v);}
    if(++v.count>30){res.status(429).json({error:'Please wait a minute before trying again.'});return true;}return false;
  }
  function publicMatch(r){return {id:r.id,team:r.team_key,season:r.season_id,date:r.played_at,home:r.home_name,away:r.away_name,homeScore:r.home_score,awayScore:r.away_score,state:r.state};}
  async function photos(client,ids){if(!ids.length)return new Map();const r=await client.query('SELECT id,photo_data FROM rugby_players WHERE id=ANY($1::uuid[])',[ids]);return new Map(r.rows.map(p=>[p.id,p.photo_data || null]));}
  app.get('/api/nld-voting/groups',async(req,res)=>{
    publicHeaders(res);
    try{
      const r=await pool.query(`SELECT DISTINCT ON(m.team_key) m.team_key,p.state FROM rugby_nld_polls p JOIN season_matches m ON m.id=p.match_id WHERE m.status='confirmed' AND m.match_type='NLD' ORDER BY m.team_key,m.played_at DESC,m.id DESC`);
      res.json({groups:Object.keys(teamIds).map(team=>({team,state:r.rows.find(r=>r.team_key===team)?.state || 'none'}))});
    }catch(e){fail(res,e);}
  });
  app.get('/api/nld-voting/poll',async(req,res)=>{
    publicHeaders(res);
    const team=req.query.team;
    if(!Object.hasOwn(teamIds,team))return res.status(400).json({error:'Invalid age group'});
    try{
      const r=await pool.query(`SELECT m.*,p.state,p.candidates,p.winner_id FROM rugby_nld_polls p JOIN season_matches m ON m.id=p.match_id WHERE m.team_key=$1 AND m.status='confirmed' AND m.match_type='NLD' ORDER BY m.played_at DESC,m.id DESC LIMIT 1`,[team]);
      if(!r.rowCount)return res.json({poll:null});
      const m=r.rows[0],hash=voter(req,res);
      const existing=await pool.query('SELECT player_id FROM rugby_nld_votes WHERE match_id=$1 AND voter_hash=$2',[m.id,hash]);
      const payload={...publicMatch(m),voted:!!existing.rowCount};
      if(m.state==='open'){
        const pics=await photos(pool,m.candidates.map(p=>p.id));
        payload.players=m.candidates.map(p=>({id:p.id,name:p.name,shirtNumber:p.shirt_number,photo:pics.get(p.id)}));
      }else if(m.state==='published'){
        const w=m.candidates.find(p=>p.id===m.winner_id);
        const pics=await photos(pool,w?[w.id]:[]);
        payload.winner=w?{id:w.id,name:w.name,photo:pics.get(w.id)}:null;
      }
      // Recheck eligibility and state after loading photos.
      const check=await pool.query(`SELECT p.state FROM rugby_nld_polls p JOIN season_matches m ON m.id=p.match_id WHERE m.id=$1 AND m.status='confirmed' AND m.match_type='NLD'`,[m.id]);
      if(check.rows[0]?.state!==m.state)return res.status(409).json({error:'Voting changed. Reopen this group.'});
      res.json({poll:payload});
    }catch(e){fail(res,e);}
  });
  app.post('/api/nld-voting/vote',async(req,res)=>{
    publicHeaders(res);
    const {matchId,playerId,team}=req.body || {};
    if(!Number.isSafeInteger(matchId)||matchId<1||!UUID.test(playerId || '')||!Object.hasOwn(teamIds,team))return res.status(400).json({error:'Choose a player and match.'});
    const hash=voter(req,res,true);if(!hash)return res.status(400).json({error:'Please allow cookies and reopen the voting group before voting.'});if(limited(hash,res))return;let client;
    try{
      client=await pool.connect();await client.query('BEGIN');
      const r=await client.query(`SELECT p.*,m.status,m.match_type,m.team_key FROM rugby_nld_polls p JOIN season_matches m ON m.id=p.match_id WHERE p.match_id=$1 FOR UPDATE OF p,m`,[matchId]);
      const poll=r.rows[0];
      if(!poll || poll.state!=='open'||poll.status!=='confirmed'||poll.match_type!=='NLD'||poll.team_key!==team){await client.query('ROLLBACK');return res.status(409).json({error:'Voting is not open for this match.'});}
      if(!poll.candidates.some(p=>p.id===playerId)){await client.query('ROLLBACK');return res.status(400).json({error:'This player is not in the match squad.'});}
      const inserted=await client.query('INSERT INTO rugby_nld_votes (match_id,voter_hash,player_id) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING RETURNING player_id',[matchId,hash,playerId]);
      await client.query('COMMIT');
      if(!inserted.rowCount)return res.status(409).json({error:'Your vote for this match has already been recorded.',voted:true});
      res.json({ok:true});
    }catch(e){if(client)await client.query('ROLLBACK');fail(res,e);}finally{client?.release();}
  });
  app.post('/api/admin-voting/list',async(req,res)=>{
    if(!auth(req,res))return;
    try{
      const r=await pool.query(`SELECT m.id,m.team_key,m.season_id,m.played_at,m.home_name,m.away_name,m.home_score,m.away_score,m.status,p.state,p.candidates,p.winner_id FROM season_matches m LEFT JOIN rugby_nld_polls p ON p.match_id=m.id WHERE m.team_key=$1 AND m.match_type='NLD' AND (m.status='confirmed' OR p.match_id IS NOT NULL) ORDER BY m.played_at DESC,m.id DESC`,[req.body.team]);
      const counts=await pool.query(`SELECT v.match_id,v.player_id,COUNT(*)::int AS votes FROM rugby_nld_votes v JOIN season_matches m ON m.id=v.match_id WHERE m.team_key=$1 GROUP BY v.match_id,v.player_id`,[req.body.team]);
      res.json({matches:r.rows.map(m=>({...m,counts:counts.rows.filter(c=>c.match_id===m.id)}))});
    }catch(e){fail(res,e);}
  });
  app.post('/api/admin-voting/action',async(req,res)=>{
    if(!auth(req,res))return;
    const {matchId,action,winnerId}=req.body;
    if(!Number.isSafeInteger(matchId)||matchId<1||!['open','close','publish'].includes(action))return res.status(400).json({error:'Choose a match and action.'});
    let client;
    try{
      client=await pool.connect();await client.query('BEGIN');
      const r=await client.query('SELECT * FROM season_matches WHERE id=$1 AND team_key=$2 FOR UPDATE',[matchId,req.body.team]);const match=r.rows[0];
      if(!match || match.status!=='confirmed'||match.match_type!=='NLD'){await client.query('ROLLBACK');return res.status(409).json({error:'Voting requires a confirmed NLD result.'});}
      const old=await client.query('SELECT * FROM rugby_nld_polls WHERE match_id=$1 FOR UPDATE',[matchId]);const poll=old.rows[0];
      if(action==='open'){
        if(poll?.state==='published'){await client.query('ROLLBACK');return res.status(409).json({error:'The winner has already been published.'});}
        if(poll)await client.query("UPDATE rugby_nld_polls SET state='open',closed_at=NULL WHERE match_id=$1",[matchId]);
        else{
          const squad=match.lineup_match_id?await client.query('SELECT players FROM rugby_match_squads WHERE match_id=$1',[match.lineup_match_id]):{rows:[]};
          const picks=squad.rows[0]?.players || [];
          if(!picks.length){await client.query('ROLLBACK');return res.status(409).json({error:'This match has no saved squad. A match squad is needed before voting can open.'});}
          await client.query('INSERT INTO rugby_nld_polls (match_id,candidates) VALUES ($1,$2::jsonb)',[matchId,JSON.stringify(picks.map(p=>({id:p.id,name:p.name,shirt_number:p.shirt_number})))]);
        }
      }else if(action==='close'){
        if(!poll || poll.state==='published'){await client.query('ROLLBACK');return res.status(409).json({error:'There is no open voting to close.'});}
        await client.query("UPDATE rugby_nld_polls SET state='closed',closed_at=NOW() WHERE match_id=$1",[matchId]);
      }else{
        if(!poll || poll.state!=='closed'||!UUID.test(winnerId || '')){await client.query('ROLLBACK');return res.status(409).json({error:'Close voting and select the winner first.'});}
        const counts=await client.query('SELECT player_id,COUNT(*)::int AS votes FROM rugby_nld_votes WHERE match_id=$1 GROUP BY player_id ORDER BY votes DESC',[matchId]);
        const max=Math.max(0,...counts.rows.map(c=>Number(c.votes)));
        if(!max || !counts.rows.some(c=>c.player_id===winnerId && c.votes===max)){await client.query('ROLLBACK');return res.status(400).json({error:'Select a player with the highest vote count. A match with no votes has no winner.'});}
        await client.query("UPDATE rugby_nld_polls SET state='published',winner_id=$2,published_at=NOW() WHERE match_id=$1",[matchId,winnerId]);
      }
      await client.query('COMMIT');res.json({ok:true});
    }catch(e){if(client)await client.query('ROLLBACK');fail(res,e);}finally{client?.release();}
  });
  app.get('/api/nld-voting/winners',async(req,res)=>{
    publicHeaders(res);const team=req.query.team;
    if(!Object.hasOwn(teamIds,team))return res.status(400).json({error:'Invalid age group'});
    try{
      const r=await pool.query(`SELECT m.id,m.season_id,m.played_at,m.home_name,m.away_name,p.winner_id,p.candidates FROM rugby_nld_polls p JOIN season_matches m ON m.id=p.match_id WHERE m.team_key=$1 AND m.status='confirmed' AND m.match_type='NLD' AND p.state='published' ORDER BY m.played_at DESC,m.id DESC`,[team]);
      res.json({winners:r.rows.map(m=>({matchId:m.id,season:m.season_id,date:m.played_at,name:m.candidates.find(p=>p.id===m.winner_id)?.name || 'Player',playerId:m.winner_id}))});
    }catch(e){fail(res,e);}
  });
}
module.exports=register;module.exports.init=init;

module.exports.awards=async function(pool,playerId){
 const r=await pool.query(`SELECT m.id AS match_id,m.season_id,m.team_key,m.played_at,m.home_name,m.away_name FROM rugby_nld_polls p JOIN season_matches m ON m.id=p.match_id WHERE p.winner_id=$1 AND p.state='published' AND m.status='confirmed' AND m.match_type='NLD' ORDER BY m.played_at DESC,m.id DESC`,[playerId]);return r.rows;
};
