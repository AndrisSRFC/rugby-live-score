let liveSquadSignature='';
function fitSquadTicker(){
  const section=document.getElementById('liveSquad');
  document.querySelectorAll('#squadTrack .live-squad-group').forEach(group=>group.style.minWidth=section.clientWidth+'px');
}
function renderMatchSquad(state){
  const players=Array.isArray(state.matchSquad) ? state.matchSquad : [];
  const section=document.getElementById('liveSquad');
  section.hidden=!state.showSquad || !players.length;
  const signature=JSON.stringify([state.matchId,players]);
  if(signature===liveSquadSignature)return;
  liveSquadSignature=signature;
  const track=document.getElementById('squadTrack'),list=document.getElementById('liveSquadList');
  track.replaceChildren();list.replaceChildren();
  players.forEach(player=>{
    const row=document.createElement('li');
    if(player.shirt_number){const number=document.createElement('b');number.textContent=player.shirt_number;row.append(number);}
    row.append(document.createTextNode(player.name));list.append(row);
  });
  for(let copy=0;copy<2;copy++){
    const group=document.createElement('span');group.className='live-squad-group';
    if(copy)group.setAttribute('aria-hidden','true');
    players.forEach(player=>{
      const item=document.createElement('span');item.className='live-squad-player';
      if(player.shirt_number){const number=document.createElement('b');number.textContent=player.shirt_number;item.append(number);}
      item.append(document.createTextNode(player.name));
      const dot=document.createElement('span');dot.className='live-squad-dot';dot.textContent='•';dot.setAttribute('aria-hidden','true');group.append(item,dot);
    });
    track.append(group);
  }
  track.style.setProperty('--squad-duration',Math.max(18,players.length*5)+'s');
  fitSquadTicker();
  list.hidden=true;document.getElementById('squadTicker').setAttribute('aria-expanded','false');
}
document.getElementById('squadPause').addEventListener('click',event=>{
  const paused=document.getElementById('liveSquad').classList.toggle('squad-paused');
  event.currentTarget.textContent=paused?'Play':'Pause';event.currentTarget.setAttribute('aria-pressed',String(paused));
});
document.getElementById('squadTicker').addEventListener('click',event=>{
  const list=document.getElementById('liveSquadList');list.hidden=!list.hidden;event.currentTarget.setAttribute('aria-expanded',String(!list.hidden));
});
if(currentState)renderMatchSquad(currentState);
new ResizeObserver(fitSquadTicker).observe(document.getElementById('liveSquad'));
