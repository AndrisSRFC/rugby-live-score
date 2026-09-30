(()=>{
 const el=(tag,text)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;return n;};
 const trigger=el('button','NLD PLAYER VOTE');trigger.type='button';trigger.className='green';trigger.id='openNldVoting';
 const panel=document.querySelector('.squad-admin-panel');if(!panel)return;panel.append(trigger);
 const dialog=el('dialog');dialog.id='adminVoteDialog';dialog.setAttribute('aria-labelledby','adminVoteTitle');
 const head=el('div');head.className='squad-dialog-heading';const title=el('h2','NLD Player Voting');title.id='adminVoteTitle';const close=el('button','×');close.type='button';close.setAttribute('aria-label','Close voting administration');head.append(title,close);
 const msg=el('p');msg.setAttribute('role','status');const list=el('div');dialog.append(head,el('p','Open voting after confirming an NLD result. Only that match’s saved squad is eligible. Counts stay private until you publish the winner.'),msg,list);document.body.append(dialog);
 let team=null,serial=0,busy=false;
 close.addEventListener('click',()=>{if(!busy)dialog.close();});dialog.addEventListener('cancel',e=>{if(busy)e.preventDefault();});dialog.addEventListener('close',()=>serial++);
 async function request(path,body={}){const r=await fetch('/api/admin-voting/'+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...body,pin:document.getElementById('pin').value,team})});const d=await r.json();if(!r.ok)throw new Error(d.error || 'Could not load voting.');return d;}
 function lock(value){busy=value;dialog.querySelectorAll('button,select').forEach(n=>n.disabled=value);}
 async function load(){
  const token=++serial;msg.textContent='Loading…';list.replaceChildren();
  const d=await request('list');if(token!==serial || !dialog.open)return;msg.textContent='';
  if(!d.matches.length){list.append(el('p','No confirmed NLD matches in this group yet.'));return;}
  d.matches.forEach(m=>{
   const card=el('section');card.className='admin-vote-match';card.append(el('h3',new Date(m.played_at).toLocaleDateString('en-GB')+' · '+m.home_name+' '+m.home_score+' – '+m.away_score+' '+m.away_name),el('p',(m.season_id || '')+' · '+(m.state || 'not opened').toUpperCase()));
   if(m.status!=='confirmed'){card.append(el('p','Result is no longer confirmed. Public voting and this award are hidden until it is confirmed again.'));list.append(card);return;}
   const counts=new Map(m.counts.map(c=>[c.player_id,Number(c.votes)]));
   const max=Math.max(0,...counts.values());const total=[...counts.values()].reduce((a,b)=>a+b,0);
   if(m.state)card.append(el('p','Total votes: '+total));
   if(m.candidates)for(const p of m.candidates)card.append(el('p',p.name+' · '+(counts.get(p.id)||0)+(m.winner_id===p.id?' · WINNER':'')));
   async function action(kind,winnerId){
    if(busy)return;
    if(kind==='publish'&&!confirm('Publish the selected winner? This award will appear publicly and in the player’s profile.'))return;
    lock(true);msg.textContent='Saving…';
    try{await request('action',{matchId:m.id,action:kind,winnerId});await load();}
    catch(e){msg.textContent=e.message;}finally{lock(false);}
   }
   if(!m.state || m.state==='closed'){const b=el('button',m.state?'REOPEN VOTING':'OPEN VOTING');b.type='button';b.addEventListener('click',()=>action('open'));card.append(b);}
   if(m.state==='open'){const b=el('button','CLOSE VOTING');b.type='button';b.addEventListener('click',()=>action('close'));card.append(b);}
   if(m.state==='closed' && max>0){
    const leaders=m.candidates.filter(p=>counts.get(p.id)===max);const label=el('label',leaders.length>1?'Tie: choose one of the joint leaders':'Winner');const select=el('select');select.setAttribute('aria-label','Select vote winner');
    leaders.forEach(p=>select.append(new Option(p.name,p.id)));label.append(select);const b=el('button','PUBLISH WINNER');b.type='button';b.addEventListener('click',()=>action('publish',select.value));card.append(label,b);
   }else if(m.state==='closed')card.append(el('p','No votes recorded. No winner can be published.'));
   list.append(card);
  });
 }
 trigger.addEventListener('click',async()=>{team=selectedTeam;title.textContent=team+' — NLD Player Voting';dialog.showModal();lock(true);try{await load();}catch(e){msg.textContent=e.message;}finally{lock(false);}});
})();
