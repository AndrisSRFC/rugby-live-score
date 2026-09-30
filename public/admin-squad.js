// The roster belongs to the selected age group; match picks are separate.
const squadPanel=document.createElement('section');
squadPanel.className='panel squad-admin-panel';
squadPanel.innerHTML='<label>Match Squad</label><div class="row"><button type="button" id="openSquadPicker" class="green">SELECT MATCH SQUAD</button><span id="squadSummary" class="squad-note">Choose today’s players</span></div>';
const nextLivePanel=document.querySelector('.next-live-panel');
const nextSquadStack=document.createElement('div');nextSquadStack.className='next-live-squad-stack';
nextLivePanel.insertAdjacentElement('beforebegin',nextSquadStack);
nextSquadStack.append(nextLivePanel,squadPanel);
let squadDraft=null;
let squadRequestSerial=0;
let squadBusy=false;

async function squadRequest(path,body,team=selectedTeam){
  const response=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...body,pin:$('pin').value,team})});
  const data=await response.json();
  if(!response.ok)throw new Error(data.error || 'Could not save. Please try again.');
  return data;
}
function squadError(error){$('squadError').textContent=error?.message || '';}
function setSquadBusy(busy){
  squadBusy=busy;
  $('addSquadPlayer').disabled=busy || !squadDraft;
  $('saveMatchSquad').disabled=busy || !squadDraft || !!squadDraft?.finished;
  $('clearSquadSelection').disabled=busy || !squadDraft || !!squadDraft?.finished;
  $('squadShowLive').disabled=busy || !squadDraft || !!squadDraft?.finished;
  $('squadPlayerList').querySelectorAll('button,input').forEach(control=>control.disabled=busy || (control.type==='checkbox' && !!squadDraft?.finished));
}
function updateSquadCount(){$('squadSelectedCount').textContent=squadDraft ? squadDraft.ids.size+' selected' : '0 selected';}
function drawSquadPlayers(){
  const list=$('squadPlayerList');list.replaceChildren();
  if(!squadDraft.players.length){const empty=document.createElement('p');empty.className='squad-note';empty.textContent='No players saved for this age group yet. Add your first player above.';list.appendChild(empty);}
  squadDraft.players.forEach(player=>{
    const row=document.createElement('div');row.className='squad-player-row';
    const label=document.createElement('label');label.className='squad-player-check';
    const check=document.createElement('input');check.type='checkbox';check.checked=squadDraft.ids.has(player.id);check.disabled=squadDraft.finished;
    check.addEventListener('change',()=>{if(check.checked)squadDraft.ids.add(player.id);else squadDraft.ids.delete(player.id);updateSquadCount();});
    const name=document.createElement('span');name.textContent=(player.shirt_number ? player.shirt_number+'. ' : '')+player.name;
    label.append(check,name);
    const remove=document.createElement('button');remove.type='button';remove.className='squad-delete';remove.textContent='Delete';remove.setAttribute('aria-label','Delete '+player.name+' from active roster');
    remove.addEventListener('click',async()=>{
      if(squadBusy || !confirm('Remove '+player.name+' from the active '+squadDraft.team+' roster? Previous match squads will be kept.'))return;
      const draft=squadDraft;setSquadBusy(true);squadError(null);
      try{await squadRequest('/api/players/archive',{id:player.id},draft.team);if(squadDraft!==draft)return;draft.players=draft.players.filter(p=>p.id!==player.id);if(!draft.finished)draft.ids.delete(player.id);drawSquadPlayers();updateSquadCount();}
      catch(error){squadError(error);}finally{setSquadBusy(false);}
    });
    row.append(label,remove);list.appendChild(row);
  });
  updateSquadCount();setSquadBusy(squadBusy);
}
$('openSquadPicker').addEventListener('click',async()=>{
  const team=selectedTeam, serial=++squadRequestSerial;
  squadDraft=null;squadError(null);updateSquadCount();$('squadTitle').textContent=team+' — Match Squad';$('squadPlayerList').textContent='Loading players…';$('squadPlayerName').value='';$('squadPlayerNumber').value='';$('squadShowLive').checked=false;
  $('squadDialog').showModal();setSquadBusy(true);
  try{
    const data=await squadRequest('/api/players/list',{},team);
    if(serial!==squadRequestSerial || team!==selectedTeam || !$('squadDialog').open)return;
    squadDraft={...data,team,ids:new Set(data.selected.map(p=>p.id))};
    $('squadShowLive').checked=data.selected.length ? data.visible : true;
    if(data.finished)squadError(new Error('This match is finished. Use New Match before choosing another squad.'));
    drawSquadPlayers();
  }catch(error){if(serial===squadRequestSerial){squadError(error);$('squadPlayerList').textContent='Close this window, check your Admin PIN and reopen the squad picker.';}}finally{if(serial===squadRequestSerial)setSquadBusy(false);}
});
$('closeSquad').addEventListener('click',()=>$('squadDialog').close());
$('squadDialog').addEventListener('close',()=>{squadRequestSerial++;});
$('addSquadPlayer').addEventListener('click',async()=>{
  if(squadBusy || !squadDraft)return;
  const draft=squadDraft;setSquadBusy(true);squadError(null);
  try{
    const data=await squadRequest('/api/players/add',{name:$('squadPlayerName').value,shirtNumber:$('squadPlayerNumber').value},draft.team);
    if(squadDraft!==draft)return;
    draft.players.push(data.player);draft.players.sort((a,b)=>(a.shirt_number ?? 100)-(b.shirt_number ?? 100) || a.name.localeCompare(b.name));
    $('squadPlayerName').value='';$('squadPlayerNumber').value='';drawSquadPlayers();$('squadPlayerName').focus();
  }catch(error){squadError(error);}finally{setSquadBusy(false);}
});
$('clearSquadSelection').addEventListener('click',()=>{if(squadDraft && !squadBusy){squadDraft.ids.clear();drawSquadPlayers();}});
$('saveMatchSquad').addEventListener('click',async()=>{
  if(squadBusy || !squadDraft)return;
  const draft=squadDraft;setSquadBusy(true);squadError(null);
  try{await squadRequest('/api/squad/save',{matchId:draft.matchId,playerIds:[...draft.ids],visible:$('squadShowLive').checked},draft.team);if(squadDraft===draft)$('squadDialog').close();}
  catch(error){squadError(error);}finally{setSquadBusy(false);}
});
function updateSquadSummary(state){$('squadSummary').textContent=(state.matchSquad || []).length+' selected · '+(state.showSquad ? 'Visible on LIVE' : 'Hidden on LIVE');}
if(last)updateSquadSummary(last);
socket.on('state',updateSquadSummary);
