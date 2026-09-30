const crypto = require('crypto');

module.exports = function registerSquadApi({app, pool, adminPin, teamIds, getState, broadcast}) {
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  function authorize(req, res) {
    if (String(req.body?.pin) !== String(adminPin)) { res.status(401).json({error:'Incorrect Admin PIN'}); return false; }
    if (!Object.hasOwn(teamIds, req.body?.team)) { res.status(400).json({error:'Invalid age group'}); return false; }
    return true;
  }
  function fail(res, error) {
    console.error('Squad error:', error);
    res.status(500).json({error:'Could not save squad. Please try again.'});
  }
  async function storeSquad(client, team, state, players, visible) {
    const patch = {matchSquad:players, showSquad:visible && players.length > 0};
    const updated = await client.query(
      "UPDATE rugby_state SET data=data || $2::jsonb WHERE id=$1 AND data->>'matchId'=$3",
      [teamIds[team], JSON.stringify(patch), state.matchId]
    );
    if (!updated.rowCount) throw new Error('Match changed during squad update');
    await client.query(
      `INSERT INTO rugby_match_squads (match_id,team_key,players) VALUES ($1,$2,$3::jsonb)
       ON CONFLICT (match_id) DO UPDATE SET players=EXCLUDED.players,updated_at=NOW()`,
      [state.matchId,team,JSON.stringify(players)]
    );
    return patch;
  }
  app.post('/api/players/list', async (req,res) => {
    if (!authorize(req,res)) return;
    try {
      const team=req.body.team;
      const result=await pool.query('SELECT id,name,shirt_number FROM rugby_players WHERE team_key=$1 AND active=TRUE ORDER BY shirt_number NULLS LAST,LOWER(name),id',[team]);
      const state=getState(team);
      res.json({players:result.rows,matchId:state.matchId,selected:state.matchSquad || [],visible:!!state.showSquad,finished:state.message==='Full Time'});
    } catch(error) { fail(res,error); }
  });
  app.post('/api/players/add', async (req,res) => {
    if (!authorize(req,res)) return;
    const name=String(req.body.name || '').trim().replace(/\s+/g,' ');
    const raw=req.body.shirtNumber;
    const number=raw==='' || raw==null ? null : Number(raw);
    if (!name || name.length>80 || /[\u0000-\u001f\u007f]/.test(name) || (number!==null && (!Number.isInteger(number) || number<1 || number>99))) {
      return res.status(400).json({error:'Enter a name (up to 80 characters) and an optional shirt number from 1 to 99.'});
    }
    try {
      const duplicate=await pool.query('SELECT id FROM rugby_players WHERE team_key=$1 AND LOWER(name)=LOWER($2) AND active=TRUE',[req.body.team,name]);
      if (duplicate.rowCount) return res.status(409).json({error:'This player is already in this age group.'});
      const result=await pool.query('INSERT INTO rugby_players (id,team_key,name,shirt_number) VALUES ($1,$2,$3,$4) RETURNING id,name,shirt_number',[crypto.randomUUID(),req.body.team,name,number]);
      res.json({player:result.rows[0]});
    } catch(error) {
      if(error.code==='23505')return res.status(409).json({error:'This player is already in this age group.'});
      fail(res,error);
    }
  });
  app.post('/api/players/archive', async (req,res) => {
    if (!authorize(req,res)) return;
    if (!uuid.test(req.body.id || '')) return res.status(400).json({error:'Invalid player'});
    let client;
    try {
      client=await pool.connect(); await client.query('BEGIN');
      const removed=await client.query('UPDATE rugby_players SET active=FALSE WHERE id=$1 AND team_key=$2 AND active=TRUE RETURNING id',[req.body.id,req.body.team]);
      if (!removed.rowCount) { await client.query('ROLLBACK'); return res.status(404).json({error:'Player not found in this age group.'}); }
      const team=req.body.team, state=getState(team);
      let patch=null;
      if (state.message!=='Full Time' && (state.matchSquad || []).some(p=>p.id===req.body.id)) {
        patch=await storeSquad(client,team,state,state.matchSquad.filter(p=>p.id!==req.body.id),state.showSquad);
      }
      await client.query('COMMIT');
      if (patch && getState(team).matchId===state.matchId) { Object.assign(getState(team),patch); broadcast(team); }
      res.json({ok:true});
    } catch(error) { if(client)await client.query('ROLLBACK'); fail(res,error); }
    finally { if(client)client.release(); }
  });

  app.post('/api/players/transfer', async (req,res) => {
    if (!authorize(req,res)) return;
    const ids=req.body.playerIds, target=req.body.targetTeam, source=req.body.team;
    if (!Object.hasOwn(teamIds,target) || target===source || !Array.isArray(ids) || !ids.length || ids.length>60 || ids.some(id=>typeof id!=='string' || !uuid.test(id)) || new Set(ids).size!==ids.length) {
      return res.status(400).json({error:'Choose players and a different destination age group.'});
    }
    let client;
    try {
      client=await pool.connect();await client.query('BEGIN');
      const selected=await client.query('SELECT id,name FROM rugby_players WHERE team_key=$1 AND active=TRUE AND id=ANY($2::uuid[]) FOR UPDATE',[source,ids]);
      if(selected.rows.length!==ids.length){await client.query('ROLLBACK');return res.status(409).json({error:'The roster changed. Reopen the picker and select the players again.'});}
      const conflict=await client.query('SELECT name FROM rugby_players WHERE team_key=$1 AND active=TRUE AND LOWER(name)=ANY($2::text[])',[target,selected.rows.map(p=>p.name.toLowerCase())]);
      if(conflict.rowCount){await client.query('ROLLBACK');return res.status(409).json({error:'A player with the same name already exists in '+target+'. Check that roster before transferring.'});}
      await client.query(`CREATE TABLE IF NOT EXISTS rugby_player_transfers (
        id UUID PRIMARY KEY,player_id UUID NOT NULL REFERENCES rugby_players(id),
        from_team TEXT NOT NULL,to_team TEXT NOT NULL,season_id TEXT,
        transferred_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`);
      await client.query('UPDATE rugby_players SET team_key=$1 WHERE team_key=$2 AND active=TRUE AND id=ANY($3::uuid[])',[target,source,ids]);
      for(const id of ids)await client.query('INSERT INTO rugby_player_transfers (id,player_id,from_team,to_team,season_id) VALUES ($1,$2,$3,$4,(SELECT current_season FROM season_config WHERE id=1))',[crypto.randomUUID(),id,source,target]);
      const state=getState(source);
      let patch=null;
      if(state.message!=='Full Time' && (state.matchSquad || []).some(p=>ids.includes(p.id))){
        patch=await storeSquad(client,source,state,state.matchSquad.filter(p=>!ids.includes(p.id)),state.showSquad);
      }
      await client.query('COMMIT');
      if(patch && getState(source).matchId===state.matchId){Object.assign(getState(source),patch);broadcast(source);}
      res.json({ok:true,count:ids.length,targetTeam:target});
    } catch(error) {
      if(client)await client.query('ROLLBACK');
      if(error.code==='23505')return res.status(409).json({error:'A player with the same name already exists in the destination group.'});
      fail(res,error);
    } finally {if(client)client.release();}
  });

  app.post('/api/squad/save', async (req,res) => {
    if (!authorize(req,res)) return;
    const ids=req.body.playerIds;
    if (!Array.isArray(ids) || ids.length>60 || ids.some(id=>typeof id!=='string' || !uuid.test(id)) || new Set(ids).size!==ids.length || typeof req.body.visible!=='boolean') {
      return res.status(400).json({error:'Invalid squad selection'});
    }
    const team=req.body.team, state=getState(team);
    if (req.body.matchId!==state.matchId) return res.status(409).json({error:'A new match has started. Reopen the squad picker.'});
    if (state.message==='Full Time') return res.status(409).json({error:'This match is finished. Start New Match to select the next squad.'});
    let client;
    try {
      client=await pool.connect(); await client.query('BEGIN');
      const result=await client.query('SELECT id,name,shirt_number FROM rugby_players WHERE team_key=$1 AND active=TRUE AND id=ANY($2::uuid[]) ORDER BY shirt_number NULLS LAST,LOWER(name),id',[team,ids]);
      if (result.rows.length!==ids.length) { await client.query('ROLLBACK'); return res.status(400).json({error:'One of these players is no longer active in this age group. Reopen the squad picker.'}); }
      if (getState(team).matchId!==state.matchId || getState(team).message==='Full Time') { await client.query('ROLLBACK'); return res.status(409).json({error:'The match changed. Reopen the squad picker.'}); }
      const patch=await storeSquad(client,team,state,result.rows,req.body.visible);
      await client.query('COMMIT');
      if(getState(team).matchId===state.matchId) { Object.assign(getState(team),patch); broadcast(team); }
      res.json({ok:true,players:result.rows});
    } catch(error) { if(client)await client.query('ROLLBACK'); fail(res,error); }
    finally { if(client)client.release(); }
  });
};
