let liveSquadSignature='';
const squadHint=document.querySelector('#liveSquad .live-squad-hint');
const squadFullButton=document.createElement('button');
squadFullButton.type='button';
squadFullButton.className='live-squad-hint';
squadFullButton.textContent='TAP TO VIEW FULL SQUAD';
squadFullButton.setAttribute('aria-controls','liveSquadList');
squadFullButton.setAttribute('aria-expanded','false');
Object.assign(squadFullButton.style,{display:'block',width:'100%',minHeight:'44px',background:'transparent',border:'0',padding:'8px 0',cursor:'pointer'});
squadHint.replaceWith(squadFullButton);
const squadStatsHint=document.createElement('p');
squadStatsHint.className='live-squad-hint';
squadStatsHint.textContent="TAP A PLAYER’S NAME TO VIEW STATS";
squadStatsHint.hidden=true;
Object.assign(squadStatsHint.style,{textAlign:'center',margin:'4px 0 10px',fontSize:'12px'});
document.getElementById('liveSquadList').before(squadStatsHint);
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
    const button=document.createElement('button');button.type='button';button.dataset.playerId=player.id;button.setAttribute('aria-label','View '+player.name+' statistics');
    if(player.shirt_number){const number=document.createElement('b');number.textContent=player.shirt_number;button.append(number);}
    button.append(document.createTextNode(player.name));
    const statsIcon=document.createElement('span');statsIcon.textContent='📊';statsIcon.setAttribute('aria-hidden','true');statsIcon.style.marginLeft='8px';button.append(statsIcon);
    row.append(button);list.append(row);
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
  list.hidden=true;squadStatsHint.hidden=true;document.getElementById('squadTicker').setAttribute('aria-expanded','false');
  squadFullButton.setAttribute('aria-expanded','false');squadFullButton.textContent='TAP TO VIEW FULL SQUAD';
}
document.getElementById('squadPause').addEventListener('click',event=>{
  const paused=document.getElementById('liveSquad').classList.toggle('squad-paused');
  event.currentTarget.textContent=paused?'Play':'Pause';event.currentTarget.setAttribute('aria-pressed',String(paused));
});
function toggleFullSquad(){
  const list=document.getElementById('liveSquadList');list.hidden=!list.hidden;
  squadStatsHint.hidden=list.hidden;
  document.getElementById('squadTicker').setAttribute('aria-expanded',String(!list.hidden));
  squadFullButton.setAttribute('aria-expanded',String(!list.hidden));
  squadFullButton.textContent=list.hidden?'TAP TO VIEW FULL SQUAD':'TAP TO HIDE FULL SQUAD';
}
document.getElementById('squadTicker').addEventListener('click',toggleFullSquad);
squadFullButton.addEventListener('click',toggleFullSquad);
if(currentState)renderMatchSquad(currentState);
new ResizeObserver(fitSquadTicker).observe(document.getElementById('liveSquad'));
