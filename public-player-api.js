module.exports=function({app,pool,teamIds,getState,requireAppAccess}){
  const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  app.get('/api/player-profile',requireAppAccess,async(req,res)=>{
    res.set('Cache-Control','no-store');
    const team=req.query.team,id=req.query.playerId;
    if(!Object.hasOwn(teamIds,team) || typeof id!=='string' || !uuid.test(id))return res.status(400).json({error:'Invalid player or age group.'});
    const published=()=>{const s=getState(team);return s.showSquad && Array.isArray(s.matchSquad) && s.matchSquad.find(p=>p.id===id);};
    const pick=published();
    if(!pick)return res.status(404).json({error:'This player is not in the published match squad.'});
    try{
      const player=await pool.query('SELECT id,team_key,photo_data,club_history FROM rugby_players WHERE id=$1',[id]);
      if(!player.rowCount)return res.status(404).json({error:'Player not found.'});
      const result=await pool.query(`SELECT m.id,m.season_id,m.team_key,m.played_at,m.home_name,m.away_name,m.home_score,m.away_score,s.played,s.tries,s.conversions
        FROM rugby_player_match_stats s JOIN season_matches m ON m.id=s.match_result_id
        WHERE s.player_id=$1 AND m.status='confirmed' ORDER BY m.played_at DESC,m.id DESC`,[id]);
      const season=await pool.query('SELECT current_season FROM season_config WHERE id=1');
      const awards=await require('./nld-voting-api').awards(pool,id);
      if(!published())return res.status(404).json({error:'This player is no longer in the published match squad.'});
      const totals={appearances:0,tries:0,conversions:0},groups=new Map();
      for(const m of result.rows){
        const key=JSON.stringify([m.season_id,m.team_key]);
        if(!groups.has(key))groups.set(key,{season:m.season_id,team:m.team_key,appearances:0,tries:0,conversions:0});
        if(m.played){const g=groups.get(key);g.appearances++;totals.appearances++;g.tries+=Number(m.tries);g.conversions+=Number(m.conversions);totals.tries+=Number(m.tries);totals.conversions+=Number(m.conversions);}
      }
      res.json({player:{id,name:pick.name,team:player.rows[0].team_key,photo:player.rows[0].photo_data || null,clubs:player.rows[0].club_history || []},currentSeason:season.rows[0]?.current_season,seasons:[...groups.values()],totals,awards,matches:result.rows});
    }catch(e){console.error('Public player profile error:',e);res.status(500).json({error:'Player statistics are temporarily unavailable. Please try again.'});}
  });
};

