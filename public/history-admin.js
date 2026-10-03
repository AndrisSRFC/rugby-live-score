
(()=>{
 const phone=matchMedia('(max-width:720px)'),rows=document.getElementById('savedHistoryRows'),status=document.getElementById('savedHistoryStatus'),filter=document.getElementById('savedHistoryFilter'),refresh=document.getElementById('refreshSavedHistory');
 let data=[],loading=false;
 async function api(path,body){const r=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({pin:document.getElementById('pin').value,...body})});const d=await r.json();if(!r.ok)throw Error(d.error||'Could not update history.');return d;}
 function draw(){rows.replaceChildren();const visible=data.filter(r=>!filter.value||r.team_key===filter.value);
 if(!visible.length){const p=document.createElement('p');p.textContent='No saved previous history for this selection.';rows.append(p);}
 for(const record of visible){const row=document.createElement('div');row.className='saved-history-row';const title=document.createElement('strong');title.textContent=record.team_key+' · '+record.opponent;row.append(title);
 const fields={};for(const [key,label]of [['wins','Wins (W)'],['draws','Draws (D)'],['losses','Losses (L)']]){const l=document.createElement('label'),input=document.createElement('input');l.textContent=label;input.type='number';input.min='0';input.max='100000';input.step='1';input.value=record[key];input.setAttribute('aria-label',record.team_key+' '+record.opponent+' '+label);fields[key]=input;l.append(input);row.append(l);}
 const save=document.createElement('button');save.type='button';save.textContent='SAVE CHANGES';
 save.addEventListener('click',async()=>{const values={};for(const key of Object.keys(fields)){if(!fields[key].value||!fields[key].reportValidity())return;values[key]=Number(fields[key].value);}
 if(!confirm('Update previous history for '+record.team_key+' vs '+record.opponent+' to W '+values.wins+' / D '+values.draws+' / L '+values.losses+'?'))return;
 save.disabled=true;status.textContent='Saving…';
 try{const updated=await api('/api/history/admin/update',{id:record.id,...values,original:{wins:Number(record.wins),draws:Number(record.draws),losses:Number(record.losses)}});Object.assign(record,updated);status.textContent='History updated. The LIVE head-to-head totals use these counts.';draw();}
 catch(e){status.textContent=e.message;save.disabled=false;}
 });row.append(save);rows.append(row);}
 }
 async function load(){if(phone.matches||loading)return;loading=true;refresh.disabled=true;status.textContent='Loading…';try{data=await api('/api/history/admin/list',{});draw();status.textContent=data.length+' saved record'+(data.length===1?'':'s')+'.';}catch(e){rows.replaceChildren();status.textContent=e.message;}finally{loading=false;refresh.disabled=false;}}
 refresh.addEventListener('click',load);filter.addEventListener('change',draw);window.refreshSavedHistory=load;
 document.getElementById('pin').addEventListener('input',()=>{data=[];rows.replaceChildren();status.textContent='Enter Admin PIN and refresh.';});
})();
