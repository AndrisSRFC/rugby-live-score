(()=>{
 const teams=['U13','U14','U15','U16','Colts','1st XV','2nd XV'];
 const node=(tag,text,cls)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;};
 const box=node('section',undefined,'nld-vote-home');box.setAttribute('aria-labelledby','voteHomeTitle');
 const title=node('h2','FANS’ PLAYER OF THE MATCH');title.id='voteHomeTitle';
 box.append(title,node('p','NLD matches only · Vote after full-time'));
 const groups=node('div',undefined,'nld-vote-groups');box.append(groups);
 const liveGroups=document.querySelector('.bottom .age-groups');
 liveGroups.before(box);
 const liveHeading=node('h2','LIVE SCORES','home-live-heading');liveGroups.before(liveHeading);
 const dialog=node('dialog',undefined,'nld-vote-dialog');dialog.id='nldVoteDialog';
 dialog.setAttribute('aria-labelledby','nldVoteTitle');
 const header=node('header'),back=node('button','← BACK TO HOME');back.type='button';header.append(back,node('span','RUGBY LIVE'));dialog.append(header);
 const heading=node('h2','FANS’ PLAYER OF THE MATCH');heading.id='nldVoteTitle';dialog.append(heading);
 const message=node('p');message.setAttribute('role','status');const body=node('div');dialog.append(message,body);
 document.body.append(dialog);back.addEventListener('click',()=>dialog.close());
 let serial=0,origin=null,busy=false;
 dialog.addEventListener('cancel',e=>{if(busy)e.preventDefault();});
 dialog.addEventListener('close',()=>{serial++;origin?.focus();});
 const buttons=new Map();
 teams.forEach(team=>{const b=node('button',team);b.type='button';b.addEventListener('click',()=>open(team,b));buttons.set(team,b);groups.append(b);});
 async function get(url){const r=await fetch(url,{cache:'no-store'});const d=await r.json();if(!r.ok)throw new Error(d.error || 'Could not load voting.');return d;}
 async function refresh(){try{const d=await get('/api/nld-voting/groups');for(const g of d.groups){const b=buttons.get(g.team);if(!b)continue;b.textContent=g.team+(g.state==='published'?' 🏆':g.state==='open'?' · VOTE':'');b.setAttribute('aria-label',g.team+(g.state==='published'?' - winner published':g.state==='open'?' - voting open':' - voting status'));}}catch(e){box.querySelector('p').textContent='NLD matches only · Voting temporarily unavailable';}}
 async function open(team,button){
  origin=button;const token=++serial;body.replaceChildren();message.textContent='Loading…';if(!dialog.open)dialog.showModal();
  try{
   const d=await get('/api/nld-voting/poll?team='+encodeURIComponent(team));if(token!==serial || !dialog.open)return;
   message.textContent='';
   if(!d.poll){body.append(node('p','No NLD vote is available for '+team+' yet.','nld-vote-note'));return;}
   const poll=d.poll;
   body.append(node('h3',team+' · '+poll.home+' '+poll.homeScore+' – '+poll.awayScore+' '+poll.away),node('p',new Date(poll.date).toLocaleDateString('en-GB')+' · '+(poll.season || ''),'nld-vote-note'));
   if(poll.state==='published'){
     const w=poll.winner;body.append(node('h3','🏆 FANS’ PLAYER OF THE MATCH'));
     if(w?.photo){const img=node('img',undefined,'nld-vote-winner-photo');img.src=w.photo;img.alt=w.name+' player photo';body.append(img);}
     body.append(node('h2',w?.name || 'Winner unavailable'));
     const summary=await get('/api/nld-voting/winners?team='+encodeURIComponent(team));if(token!==serial||!dialog.open)return;
     const totals=new Map();summary.winners.filter(w=>w.season===poll.season).forEach(w=>{const old=totals.get(w.playerId)||{name:w.name,count:0};old.count++;totals.set(w.playerId,old);});
     body.append(node('h3','SEASON AWARDS · '+(poll.season || '')));
     [...totals.values()].sort((a,b)=>b.count-a.count||a.name.localeCompare(b.name)).forEach(w=>body.append(node('p',w.name+' · '+w.count+' award'+(w.count===1?'':'s'))));
     return;
   }
   if(poll.state==='closed'){body.append(node('p','Voting has closed. The winner will be announced here.','nld-vote-note'));return;}
   if(poll.voted){body.append(node('h3','THANK YOU — YOUR VOTE IS IN!'),node('p','The winner will appear after voting closes.','nld-vote-note'));return;}
   body.append(node('p','Choose the player who stood out in this match. One vote per match on this browser.','nld-vote-note'));
   const list=node('div',undefined,'nld-vote-players');const form=node('form');const footer=node('div',undefined,'nld-vote-footer'),submit=node('button','VOTE');submit.type='submit';submit.disabled=true;footer.append(submit);form.append(list,footer);body.append(form);
   (poll.players || []).forEach(p=>{
     const row=node('label',undefined,'nld-vote-player');const input=node('input');input.type='radio';input.name='votePlayer';input.value=p.id;input.required=true;
     if(p.photo){const img=node('img');img.src=p.photo;img.alt='';img.width=48;img.height=48;row.append(img);}else row.append(node('span','●','nld-vote-avatar'));
     row.prepend(input);row.append(node('span',(p.shirtNumber?p.shirtNumber+'. ':'')+p.name));list.append(row);
     input.addEventListener('change',()=>{submit.disabled=false;list.querySelectorAll('label').forEach(l=>l.classList.toggle('selected',l.querySelector('input').checked));});
   });
   form.addEventListener('submit',async e=>{
     e.preventDefault();if(busy)return;const selected=form.querySelector('input:checked');if(!selected)return;
     busy=true;submit.disabled=true;back.disabled=true;list.querySelectorAll('input').forEach(i=>i.disabled=true);message.textContent='Saving your vote…';
     try{
       const r=await fetch('/api/nld-voting/vote',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({team,matchId:poll.id,playerId:selected.value})});const d=await r.json();
       if(!r.ok&&!d.voted)throw new Error(d.error || 'Could not save your vote.');
       if(token!==serial||!dialog.open)return;form.remove();body.append(node('h3','THANK YOU — YOUR VOTE IS IN!'),node('p','The winner will appear here after voting closes.','nld-vote-note'));message.textContent='';refresh();
     }catch(e){message.textContent=e.message;submit.disabled=false;list.querySelectorAll('input').forEach(i=>i.disabled=false);}
     finally{busy=false;back.disabled=false;}
   });
  }catch(e){if(token===serial&&dialog.open)message.textContent=e.message;}
 }
 refresh();setInterval(()=>{if(!document.hidden)refresh();},30000);
})();
