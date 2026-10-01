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
  $('clearSquadSelection').disabled=busy || !squadDraft;
  $('transferSquadPlayers').disabled=busy || !squadDraft;
  $('squadTransferTarget').disabled=busy || !squadDraft;
  $('squadShowLive').disabled=busy || !squadDraft || !!squadDraft?.finished;
  $('squadPlayerList').querySelectorAll('button,input').forEach(control=>control.disabled=busy);
}
function updateSquadCount(){$('squadSelectedCount').textContent=squadDraft ? squadDraft.ids.size+' selected' : '0 selected';}
function drawSquadPlayers(){
  const list=$('squadPlayerList');list.replaceChildren();
  if(!squadDraft.players.length){const empty=document.createElement('p');empty.className='squad-note';empty.textContent='No players saved for this age group yet. Add your first player above.';list.appendChild(empty);}
  squadDraft.players.forEach(player=>{
    const row=document.createElement('div');row.className='squad-player-row';
    const label=document.createElement('label');label.className='squad-player-check';
    const check=document.createElement('input');check.type='checkbox';check.checked=squadDraft.ids.has(player.id);check.disabled=squadBusy;
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
    const photo=document.createElement('button');photo.type='button';photo.className='squad-photo-button';photo.textContent=player.has_photo?'EDIT PHOTO':'ADD PHOTO';photo.setAttribute('aria-label','Photo for '+player.name);photo.addEventListener('click',()=>openPlayerPhoto(player));
    const clubs=document.createElement('button');clubs.type='button';clubs.className='squad-club-button';clubs.textContent='CLUB HISTORY';clubs.addEventListener('click',()=>openPlayerClubs(player));
    row.append(label,photo,clubs,remove);list.appendChild(row);
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
    squadDraft={...data,team,ids:new Set(data.selected.filter(p=>data.players.some(active=>active.id===p.id)).map(p=>p.id))};
    const groups=['U13','U14','U15','U16','Colts','1st XV','2nd XV'];
    const target=$('squadTransferTarget');target.replaceChildren();
    groups.filter(group=>group!==team).forEach(group=>{const option=document.createElement('option');option.value=group;option.textContent=group;target.appendChild(option);});
    target.value=({'U13':'U14','U14':'U15','U15':'U16','U16':'Colts','Colts':'1st XV','1st XV':'2nd XV','2nd XV':'1st XV'})[team];
    $('squadTransferStatus').textContent='';
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

$('transferSquadPlayers').addEventListener('click',async()=>{
  if(squadBusy || !squadDraft)return;
  const draft=squadDraft, ids=[...draft.ids], target=$('squadTransferTarget').value;
  if(!ids.length){squadError(new Error('Tick the players you want to transfer.'));return;}
  if(!confirm('Transfer '+ids.length+' selected player(s) from '+draft.team+' to '+target+'? They will leave the active '+draft.team+' roster. Previous match squads and player IDs will be kept.'))return;
  setSquadBusy(true);squadError(null);$('squadTransferStatus').textContent='';
  try{
    const data=await squadRequest('/api/players/transfer',{playerIds:ids,targetTeam:target},draft.team);
    if(squadDraft!==draft)return;
    draft.players=draft.players.filter(p=>!ids.includes(p.id));draft.ids.clear();drawSquadPlayers();
    $('squadTransferStatus').textContent=data.count+' transferred to '+target;
  }catch(error){squadError(error);}finally{setSquadBusy(false);}
});


// Photos are managed from the PC roster picker and follow the player ID.
const playerPhotoDialog=document.createElement('dialog');playerPhotoDialog.id='playerPhotoDialog';
playerPhotoDialog.innerHTML='<div class="squad-dialog-heading"><h2 id="playerPhotoTitle">Player photo</h2><button type="button" id="closePlayerPhoto" aria-label="Close photo editor">×</button></div><p class="squad-note">This photo will appear in the public LIVE player profile. Choose a clear portrait.</p><img id="playerPhotoPreview" alt="Player photo preview" hidden><label class="squad-photo-file">CHOOSE PHOTO<input type="file" id="playerPhotoFile" accept="image/jpeg,image/png,image/webp"></label><label class="squad-show"><input type="checkbox" id="playerPhotoConsent">I have permission to publish this player’s photo on Rugby LIVE.</label><p id="playerPhotoError" role="status"></p><div class="squad-dialog-footer"><button type="button" id="savePlayerPhoto" class="green">SAVE PHOTO</button><button type="button" id="removePlayerPhoto">REMOVE PHOTO</button></div>';
playerPhotoDialog.setAttribute('aria-labelledby','playerPhotoTitle');document.body.append(playerPhotoDialog);
let photoDraft=null,photoSerial=0,photoBusy=false;
function photoControls(busy){photoBusy=busy;['playerPhotoFile','playerPhotoConsent','savePlayerPhoto','removePlayerPhoto'].forEach(id=>$(id).disabled=busy);}
function photoPreview(photo){$('playerPhotoPreview').hidden=!photo;if(photo)$('playerPhotoPreview').src=photo;else $('playerPhotoPreview').removeAttribute('src');}
async function openPlayerPhoto(player){
  if(squadBusy || !squadDraft)return;
  const token=++photoSerial;photoDraft={player,team:squadDraft.team,photo:null,changed:false};
  $('playerPhotoTitle').textContent=player.name+' — Photo';$('playerPhotoFile').value='';$('playerPhotoConsent').checked=false;$('playerPhotoError').textContent='Loading photo…';photoPreview(null);playerPhotoDialog.showModal();photoControls(true);
  try{const data=await squadRequest('/api/players/photo/read',{id:player.id},photoDraft.team);if(token!==photoSerial)return;photoDraft.photo=data.photo;photoPreview(data.photo);$('playerPhotoError').textContent='';}
  catch(e){if(token===photoSerial)$('playerPhotoError').textContent=e.message;}finally{if(token===photoSerial)photoControls(false);}
}
$('closePlayerPhoto').addEventListener('click',()=>{if(!photoBusy)playerPhotoDialog.close();});
playerPhotoDialog.addEventListener('cancel',event=>{if(photoBusy)event.preventDefault();});
playerPhotoDialog.addEventListener('close',()=>{photoSerial++;photoDraft=null;photoPreview(null);});
$('playerPhotoFile').addEventListener('change',async()=>{
  const file=$('playerPhotoFile').files[0];if(!file || !photoDraft)return;
  const token=++photoSerial;photoControls(true);$('playerPhotoError').textContent='Preparing photo…';
  let bitmap;
  try{
    if(!['image/jpeg','image/png','image/webp'].includes(file.type)||file.size>10*1024*1024)throw new Error('Choose a JPG, PNG or WebP image under 10 MB.');
    bitmap=await createImageBitmap(file);if(!bitmap.width || !bitmap.height || bitmap.width*bitmap.height>50000000)throw new Error('Image is too large. Choose a smaller photo.');
    const ratio=Math.min(1,600/Math.max(bitmap.width,bitmap.height)),canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(bitmap.width*ratio));canvas.height=Math.max(1,Math.round(bitmap.height*ratio));
    const ctx=canvas.getContext('2d');ctx.fillStyle='#111';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(bitmap,0,0,canvas.width,canvas.height);
    const photo=canvas.toDataURL('image/jpeg',0.85);if(photo.length>450000)throw new Error('Photo is too large. Choose a simpler image.');
    if(token!==photoSerial)return;photoDraft.photo=photo;photoDraft.changed=true;photoPreview(photo);$('playerPhotoError').textContent='Ready to save.';
  }catch(e){if(token===photoSerial)$('playerPhotoError').textContent=e.message;}finally{bitmap?.close();if(token===photoSerial)photoControls(false);}
});
async function savePhoto(remove){
  if(photoBusy || !photoDraft)return;
  if(!remove && (!photoDraft.photo || !photoDraft.changed)){$('playerPhotoError').textContent='Choose a new photo first.';return;}
  if(!remove && !$('playerPhotoConsent').checked){$('playerPhotoError').textContent='Confirm permission to publish this photo.';return;}
  const draft=photoDraft;photoControls(true);$('playerPhotoError').textContent='Saving…';
  try{
    const data=await squadRequest('/api/players/photo',{id:draft.player.id,photo:remove?null:draft.photo,consent:$('playerPhotoConsent').checked},draft.team);
    draft.player.has_photo=data.hasPhoto;if(squadDraft?.team===draft.team)drawSquadPlayers();playerPhotoDialog.close();
  }catch(e){$('playerPhotoError').textContent=e.message;}finally{photoControls(false);}
}
$('savePlayerPhoto').addEventListener('click',()=>savePhoto(false));$('removePlayerPhoto').addEventListener('click',()=>savePhoto(true));

const playerClubDialog=document.createElement('dialog');playerClubDialog.id='playerClubDialog';
playerClubDialog.setAttribute('aria-labelledby','playerClubTitle');
playerClubDialog.innerHTML='<div class="squad-dialog-heading"><h2 id="playerClubTitle">Club history</h2><button type="button" id="closePlayerClubs" aria-label="Close club history">×</button></div><p class="squad-note">Enter the actual starting season. Leave the end season empty for the current club. This does not add match statistics.</p><div id="playerClubRows"></div><p id="playerClubMessage" role="status"></p><div class="squad-dialog-footer"><button type="button" id="addPlayerClub">ADD CLUB</button><button type="button" class="green" id="savePlayerClubs">SAVE CLUB HISTORY</button></div>';
document.body.append(playerClubDialog);
let clubDraft=null,clubSerial=0,clubBusy=false;
function clubControls(busy){clubBusy=busy;playerClubDialog.querySelectorAll('button,input').forEach(n=>n.disabled=busy);}
function drawPlayerClubs(){
 const list=$('playerClubRows');list.replaceChildren();
 clubDraft.clubs.forEach((c,index)=>{
  const row=document.createElement('div');row.className='player-club-edit-row';
  for(const [key,title,placeholder] of [['club','Club','SRFC'],['start','Start season','2026/27'],['end','End season','Present (leave empty)']]){
   const label=document.createElement('label');label.textContent=title;
   const input=document.createElement('input');input.value=c[key] || '';input.placeholder=placeholder;input.maxLength=key==='club'?80:7;
   input.addEventListener('input',()=>c[key]=input.value);label.append(input);row.append(label);
  }
  const remove=document.createElement('button');remove.type='button';remove.textContent='Remove';remove.addEventListener('click',()=>{clubDraft.clubs.splice(index,1);drawPlayerClubs();});row.append(remove);list.append(row);
 });
}
async function openPlayerClubs(player){
 if(squadBusy || !squadDraft)return;
 const token=++clubSerial;clubDraft={id:player.id,team:squadDraft.team,clubs:[]};
 $('playerClubTitle').textContent=player.name+' — Club history';$('playerClubRows').replaceChildren();$('playerClubMessage').textContent='Loading…';
 playerClubDialog.showModal();clubControls(true);
 try{const d=await squadRequest('/api/players/clubs/read',{id:player.id},clubDraft.team);if(token!==clubSerial)return;clubDraft.clubs=d.clubs.map(c=>({...c}));drawPlayerClubs();$('playerClubMessage').textContent='';}
 catch(e){if(token===clubSerial){$('playerClubMessage').textContent=e.message;clubDraft=null;}}
 finally{if(token===clubSerial){clubControls(false);$('savePlayerClubs').disabled=!clubDraft;$('addPlayerClub').disabled=!clubDraft;}}
}
$('closePlayerClubs').addEventListener('click',()=>{if(!clubBusy)playerClubDialog.close();});
playerClubDialog.addEventListener('cancel',e=>{if(clubBusy)e.preventDefault();});
playerClubDialog.addEventListener('close',()=>{clubSerial++;clubDraft=null;});
$('addPlayerClub').addEventListener('click',()=>{if(!clubDraft||clubBusy)return;clubDraft.clubs.push({club:clubDraft.clubs.length?'':'SRFC',start:'',end:null});drawPlayerClubs();});
$('savePlayerClubs').addEventListener('click',async()=>{
 if(!clubDraft||clubBusy)return;const draft=clubDraft;clubControls(true);$('playerClubMessage').textContent='Saving…';
 try{await squadRequest('/api/players/clubs/save',{id:draft.id,clubs:draft.clubs},draft.team);playerClubDialog.close();}
 catch(e){$('playerClubMessage').textContent=e.message;}
 finally{clubControls(false);}
});
