(()=>{
  const dialog=document.createElement('dialog');dialog.id='livePlayerProfile';dialog.className='live-player-profile';dialog.setAttribute('aria-labelledby','livePlayerTitle');
  dialog.innerHTML='<header><button type="button" id="playerBackLive">← BACK TO LIVE</button><span>RUGBY LIVE</span></header><main><h1 id="livePlayerTitle">Player Statistics</h1><p id="livePlayerGroup"></p><p id="livePlayerMessage" role="status" aria-live="polite"></p><div id="livePlayerContent"></div></main>';
  document.body.append(dialog);
  let serial=0,lastButton=null,request=null;
  const el=(tag,text,cls)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;};
  function statCard(label,stats){const card=el('section',undefined,'player-stat-card');card.append(el('h2',label));const row=el('div',undefined,'player-stat-values');for(const [value,name] of [[stats.appearances,'GAMES'],[stats.tries,'TRIES'],[stats.conversions,'CONVERSIONS']]){const cell=el('div');cell.append(el('strong',value),el('span',name));row.append(cell);}card.append(row);return card;}
  function draw(data){
    document.getElementById('livePlayerTitle').textContent=data.player.name;
    document.getElementById('livePlayerGroup').textContent=data.player.team+' · SLEAFORD';
    const content=document.getElementById('livePlayerContent');content.replaceChildren();
    const photoRow=data.player.photo ? el('div',undefined,'player-photo-history') : null;
    if(photoRow){content.append(photoRow);const photo=el('img',undefined,'player-profile-photo');photo.src=data.player.photo;photo.alt=data.player.name+' player photo';photo.width=180;photo.height=180;photoRow.append(photo);}
    const current=data.seasons.filter(s=>s.season===data.currentSeason).reduce((a,s)=>({appearances:a.appearances+s.appearances,tries:a.tries+s.tries,conversions:a.conversions+s.conversions}),{appearances:0,tries:0,conversions:0});
    const cards=el('div',undefined,'player-stat-cards');cards.append(statCard('THIS SEASON · '+(data.currentSeason || '—'),current),statCard('CAREER TOTAL',data.totals));content.append(cards,el('p','Only recorded statistics from confirmed matches are counted.','player-profile-note'));
    const awards=data.awards || [];
    if(awards.length){const summary=el('p','🏆 Fans’ Player of the Match · This season: '+awards.filter(a=>a.season_id===data.currentSeason).length+' · Career: '+awards.length,'player-awards');content.append(summary);}
    const label=el('label','SEASON','player-season-label');const select=el('select');select.setAttribute('aria-label','Player statistics season');select.append(new Option('All seasons',''));[...new Set(data.seasons.map(s=>s.season))].filter(Boolean).forEach(s=>select.append(new Option(s,s)));label.append(select);
    const history=el('section',undefined,'player-history-content');history.append(label);
    const detail=el('div');history.append(detail);
    (photoRow || content).append(history);
    function showSeason(){
      detail.replaceChildren();
      const groups=data.seasons.filter(s=>!select.value||s.season===select.value);
      if(groups.length){const wrap=el('div',undefined,'player-season-table');const table=el('table');const head=el('thead'),tr=el('tr');['Season','Group','Games','Tries','Conv.'].forEach(s=>tr.append(el('th',s)));head.append(tr);const body=el('tbody');groups.forEach(s=>{const r=el('tr');[s.season || '—',s.team,s.appearances,s.tries,s.conversions].forEach(v=>r.append(el('td',v)));body.append(r);});table.append(head,body);wrap.append(table);detail.append(wrap);}
      const awardsForSeason=awards.filter(a=>!select.value || a.season_id===select.value);
      if(awardsForSeason.length){detail.append(el('h2','FANS’ PLAYER OF THE MATCH'));for(const a of awardsForSeason)detail.append(el('p','🏆 '+new Date(a.played_at).toLocaleDateString('en-GB')+' · '+a.team_key+' · '+a.home_name+' v '+a.away_name,'player-awards'));}
      detail.append(el('h2','MATCH HISTORY'));
      const matches=data.matches.filter(m=>!select.value||m.season_id===select.value);
      if(!matches.length)detail.append(el('p','No recorded confirmed matches yet.','player-profile-note'));
      for(const m of matches){const item=el('article',undefined,'player-match');item.append(el('p',new Date(m.played_at).toLocaleDateString('en-GB')+' · '+m.team_key+' · '+(m.season_id || '—'),'player-profile-note'),el('h3',m.home_name+' '+m.home_score+' – '+m.away_score+' '+m.away_name),el('p',(m.played?'Played':'Did not play')+' · '+m.tries+' tries · '+m.conversions+' conversions'));detail.append(item);}
    }
    select.addEventListener('change',showSeason);showSeason();
  }
  function finish(){serial++;if(request)request.abort();request=null;if(lastButton?.isConnected)lastButton.focus();}
  document.getElementById('playerBackLive').addEventListener('click',()=>dialog.close());dialog.addEventListener('close',finish);
  document.getElementById('liveSquadList').addEventListener('click',async event=>{
    const button=event.target.closest('button[data-player-id]');if(!button)return;
    lastButton=button;const token=++serial;if(request)request.abort();request=new AbortController();
    document.getElementById('livePlayerTitle').textContent=button.textContent.trim();document.getElementById('livePlayerGroup').textContent='';document.getElementById('livePlayerContent').replaceChildren();document.getElementById('livePlayerMessage').textContent='Loading statistics…';
    if(!dialog.open)dialog.showModal();
    try{
      const response=await fetch('/api/player-profile?team='+encodeURIComponent(selectedTeam)+'&playerId='+encodeURIComponent(button.dataset.playerId),{cache:'no-store',signal:request.signal});const data=await response.json();if(!response.ok)throw new Error(data.error || 'Could not load statistics.');
      if(token!==serial||!dialog.open)return;draw(data);document.getElementById('livePlayerMessage').textContent='';
    }catch(e){if(e.name!=='AbortError'&&token===serial&&dialog.open)document.getElementById('livePlayerMessage').textContent=e.message;}
  });
})();

