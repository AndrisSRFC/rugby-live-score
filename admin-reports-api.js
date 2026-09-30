const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
async function init(pool){
  await pool.query(`CREATE TABLE IF NOT EXISTS rugby_player_match_stats (
    match_result_id INTEGER NOT NULL REFERENCES season_matches(id) ON DELETE CASCADE,
    player_id UUID NOT NULL REFERENCES rugby_players(id),
    name_snapshot TEXT NOT NULL,
    played BOOLEAN NOT NULL DEFAULT FALSE,
    tries INTEGER NOT NULL DEFAULT 0 CHECK (tries>=0),
    conversions INTEGER NOT NULL DEFAULT 0 CHECK (conversions>=0),
    PRIMARY KEY(match_result_id,player_id)
  )`);
  await pool.query(`CREATE TABLE IF NOT EXISTS rugby_coach_reports (
    match_result_id INTEGER PRIMARY KEY REFERENCES season_matches(id) ON DELETE CASCADE,
    description TEXT NOT NULL DEFAULT '',updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
}
function register({app,pool,adminPin,teamIds}){
  function authorized(req,res,withTeam=false){
    if(String(req.body?.pin)!==String(adminPin)){res.status(401).json({error:'Incorrect Admin PIN'});return false;}
    if(withTeam && !Object.hasOwn(teamIds,req.body?.team)){res.status(400).json({error:'Invalid age group'});return false;}
    return true;
  }
  function error(res,e){console.error('Admin report error:',e);res.status(500).json({error:'Could not load or save the report. Please try again.'});}
  app.post('/api/admin-reports/matches',async(req,res)=>{
    if(!authorized(req,res,true))return;
    try{const r=await pool.query("SELECT id,team_key,season_id,home_name,away_name,home_score,away_score,match_type,status,played_at FROM season_matches WHERE team_key=$1 ORDER BY played_at DESC,id DESC",[req.body.team]);res.json(r.rows);}catch(e){error(res,e);}
  });
  app.post('/api/admin-reports/players',async(req,res)=>{
    if(!authorized(req,res))return;
    try{const r=await pool.query('SELECT id,name,team_key,active FROM rugby_players ORDER BY LOWER(name),team_key,id');res.json(r.rows);}catch(e){error(res,e);}
  });
  app.post('/api/admin-reports/report',async(req,res)=>{
    if(!authorized(req,res,true))return;
    if(!Number.isSafeInteger(req.body.matchId)||req.body.matchId<1)return res.status(400).json({error:'Select a completed match.'});
    try{
      const result=await pool.query('SELECT * FROM season_matches WHERE id=$1 AND team_key=$2',[req.body.matchId,req.body.team]);
      if(!result.rowCount)return res.status(404).json({error:'Match not found in this age group.'});
      const match=result.rows[0];
      const [squad,stats,note,roster]=await Promise.all([
        match.lineup_match_id?pool.query('SELECT players FROM rugby_match_squads WHERE match_id=$1',[match.lineup_match_id]):Promise.resolve({rows:[]}),
        pool.query('SELECT player_id,name_snapshot,played,tries,conversions FROM rugby_player_match_stats WHERE match_result_id=$1',[match.id]),
        pool.query('SELECT description FROM rugby_coach_reports WHERE match_result_id=$1',[match.id]),
        pool.query('SELECT id,name,shirt_number FROM rugby_players WHERE team_key=$1 AND active=TRUE ORDER BY shirt_number NULLS LAST,LOWER(name)',[req.body.team])
      ]);
      const picks=new Map((squad.rows[0]?.players || []).map(p=>[p.id,{id:p.id,name:p.name,shirt_number:p.shirt_number,played:false,tries:0,conversions:0}]));
      for(const p of stats.rows)picks.set(p.player_id,{...picks.get(p.player_id),id:p.player_id,name:p.name_snapshot,played:p.played,tries:p.tries,conversions:p.conversions});
      res.json({match,players:[...picks.values()],roster:roster.rows,description:note.rows[0]?.description || ''});
    }catch(e){error(res,e);}
  });
  app.post('/api/admin-reports/save',async(req,res)=>{
    if(!authorized(req,res,true))return;
    const {matchId,players,description}=req.body;
    if(!Number.isSafeInteger(matchId)||matchId<1||!Array.isArray(players)||players.length>60||new Set(players.map(p=>p?.id)).size!==players.length||typeof description!=='string'||description.length>20000||players.some(p=>!p||!UUID.test(p.id || '')||typeof p.played!=='boolean'||!Number.isInteger(p.tries)||p.tries<0||p.tries>100||!Number.isInteger(p.conversions)||p.conversions<0||p.conversions>100||(!p.played&&(p.tries||p.conversions))))return res.status(400).json({error:'Check player entries. A player with tries or conversions must be marked Played.'});
    let client;
    try{
      client=await pool.connect();await client.query('BEGIN');
      const result=await client.query('SELECT * FROM season_matches WHERE id=$1 AND team_key=$2 FOR UPDATE',[matchId,req.body.team]);
      if(!result.rowCount){await client.query('ROLLBACK');return res.status(404).json({error:'Match not found in this age group.'});}
      const match=result.rows[0];
      const squad=match.lineup_match_id?await client.query('SELECT players FROM rugby_match_squads WHERE match_id=$1',[match.lineup_match_id]):{rows:[]};
      const names=new Map((squad.rows[0]?.players || []).map(p=>[p.id,p.name]));
      const old=await client.query('SELECT player_id,name_snapshot FROM rugby_player_match_stats WHERE match_result_id=$1',[matchId]);
      old.rows.forEach(p=>names.set(p.player_id,p.name_snapshot));
      const roster=await client.query('SELECT id,name FROM rugby_players WHERE team_key=$1 AND active=TRUE AND id=ANY($2::uuid[])',[req.body.team,players.map(p=>p.id)]);
      roster.rows.forEach(p=>{if(!names.has(p.id))names.set(p.id,p.name);});
      if(players.some(p=>!names.has(p.id))){await client.query('ROLLBACK');return res.status(400).json({error:'A player does not belong to this match or age group.'});}
      await client.query('DELETE FROM rugby_player_match_stats WHERE match_result_id=$1',[matchId]);
      for(const p of players)await client.query('INSERT INTO rugby_player_match_stats (match_result_id,player_id,name_snapshot,played,tries,conversions) VALUES ($1,$2,$3,$4,$5,$6)',[matchId,p.id,names.get(p.id),p.played,p.tries,p.conversions]);
      await client.query('INSERT INTO rugby_coach_reports (match_result_id,description) VALUES ($1,$2) ON CONFLICT (match_result_id) DO UPDATE SET description=EXCLUDED.description,updated_at=NOW()',[matchId,description]);
      await client.query('COMMIT');res.json({ok:true});
    }catch(e){if(client)await client.query('ROLLBACK');error(res,e);}finally{if(client)client.release();}
  });
  app.post('/api/admin-reports/profile',async(req,res)=>{
    if(!authorized(req,res))return;
    if(!UUID.test(req.body.playerId || ''))return res.status(400).json({error:'Select a player.'});
    try{
      const player=await pool.query('SELECT id,name,team_key,active FROM rugby_players WHERE id=$1',[req.body.playerId]);
      if(!player.rowCount)return res.status(404).json({error:'Player not found.'});
      const result=await pool.query(`SELECT m.id,m.season_id,m.team_key,m.played_at,m.home_name,m.away_name,m.home_score,m.away_score,s.played,s.tries,s.conversions
        FROM rugby_player_match_stats s JOIN season_matches m ON m.id=s.match_result_id
        WHERE s.player_id=$1 AND m.status='confirmed' ORDER BY m.played_at DESC,m.id DESC`,[req.body.playerId]);
      const season=await pool.query('SELECT current_season FROM season_config WHERE id=1');
      const totals={appearances:0,tries:0,conversions:0},groups=new Map();
      for(const m of result.rows){const key=JSON.stringify([m.season_id,m.team_key]);if(!groups.has(key))groups.set(key,{season:m.season_id,team:m.team_key,appearances:0,tries:0,conversions:0});const g=groups.get(key);if(m.played){g.appearances++;totals.appearances++;g.tries+=Number(m.tries);g.conversions+=Number(m.conversions);totals.tries+=Number(m.tries);totals.conversions+=Number(m.conversions);}}
      res.json({player:player.rows[0],currentSeason:season.rows[0]?.current_season,seasons:[...groups.values()],totals,matches:result.rows});
    }catch(e){error(res,e);}
  });
}
module.exports=register;module.exports.init=init;
