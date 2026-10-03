
(()=>{
 const open=document.getElementById('matchAlertsOpen');if(!isInstalledApp())return;open.hidden=false;
 const actions=document.querySelector('.home-primary-actions'),phone=matchMedia('(max-width:700px)'),anchor=document.createComment('Match alerts desktop position');open.before(anchor);
 function place(){const sponsors=document.getElementById('sponsorsOpen');if(sponsors)sponsors.style.transform=phone.matches?'translateY(44px)':'';if(phone.matches&&actions){actions.before(open);open.style.display='block';open.style.margin='0 0 8px';}else{anchor.after(open);open.style.display='';open.style.margin='';}}
 phone.addEventListener('change',place);place();
 const groups=['U13','U14','U15','U16','Colts','1st XV','2nd XV'],dialog=document.createElement('dialog');dialog.id='matchAlertsDialog';dialog.setAttribute('aria-labelledby','matchAlertsTitle');
 dialog.innerHTML='<button type="button" id="matchAlertsBack">← BACK TO HOME</button><h2 id="matchAlertsTitle">MATCH ALERTS</h2><p>Choose the groups you want to follow. Push notifications are coming soon; saving this selection does not enable notifications yet.</p><form><label><input type="checkbox" id="matchAlertsAll"> ALL GROUPS</label><div class="alert-groups"></div><button type="submit">SAVE PREFERENCES</button></form><p role="status" id="matchAlertsStatus"></p>';
 document.body.append(dialog);const all=dialog.querySelector('#matchAlertsAll'),box=dialog.querySelector('.alert-groups'),status=dialog.querySelector('[role=status]'),save=dialog.querySelector('[type=submit]'),checks=[];
 function sync(){all.checked=checks.every(c=>c.checked);all.indeterminate=checks.some(c=>c.checked)&&!all.checked;}
 for(const group of groups){const label=document.createElement('label'),check=document.createElement('input');check.type='checkbox';check.value=group;label.append(check,document.createTextNode(/^U\d+$/.test(group)?group+"'s":group));box.append(label);checks.push(check);check.addEventListener('change',sync);}
 all.addEventListener('change',()=>{checks.forEach(c=>c.checked=all.checked);sync();});
 dialog.querySelector('#matchAlertsBack').onclick=()=>dialog.close();dialog.addEventListener('close',()=>open.focus());
 async function request(body){const r=await fetch('/api/match-alerts/preferences',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({installId:getInstallId(),...body})});const d=await r.json();if(!r.ok)throw Error(d.error||'Could not save preferences.');return d;}
 open.addEventListener('click',async()=>{dialog.showModal();dialog.querySelector('#matchAlertsBack').focus();status.textContent='Loading…';save.disabled=true;checks.forEach(c=>c.disabled=true);all.disabled=true;
 try{await getServerAppAccess();const d=await request({});checks.forEach(c=>c.checked=d.groups.includes(c.value));sync();status.textContent='Select any groups, or leave all unticked to follow none.';save.disabled=false;checks.forEach(c=>c.disabled=false);all.disabled=false;}catch(e){status.textContent=e.message;}});
 dialog.querySelector('form').onsubmit=async e=>{e.preventDefault();save.disabled=true;status.textContent='Saving…';try{await request({save:true,groups:checks.filter(c=>c.checked).map(c=>c.value)});status.textContent='Preferences saved. Push notifications are not active yet.';}catch(e){status.textContent=e.message;}finally{save.disabled=false;}};
})();
