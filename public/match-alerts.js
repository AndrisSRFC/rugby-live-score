
(()=>{
 const open=document.getElementById('matchAlertsOpen');if(!isInstalledApp()||!/Android|iPhone|iPad|iPod/i.test(navigator.userAgent))return;open.hidden=false;
 const actions=document.querySelector('.home-primary-actions'),phone=matchMedia('(max-width:700px)'),anchor=document.createComment('Match alerts desktop position');open.before(anchor);
 function place(){const sponsors=document.getElementById('sponsorsOpen');if(sponsors)sponsors.style.transform=phone.matches?'translateY(44px)':'';if(phone.matches&&actions){actions.before(open);open.style.display='block';open.style.margin='0 0 8px';open.style.alignSelf='flex-start';open.style.justifySelf='start';open.style.position='relative';open.style.zIndex='1';}else{anchor.after(open);open.style.display='';open.style.margin='';open.style.alignSelf='';open.style.justifySelf='';open.style.position='';open.style.zIndex='';}}
 phone.addEventListener('change',place);place();
 const groups=['U13','U14','U15','U16','Colts','1st XV','2nd XV'],dialog=document.createElement('dialog');dialog.id='matchAlertsDialog';dialog.setAttribute('aria-labelledby','matchAlertsTitle');
 dialog.innerHTML='<button type="button" id="matchAlertsBack">← BACK TO HOME</button><h2 id="matchAlertsTitle">MATCH ALERTS</h2><p>Choose your groups for LIVE coverage and full-time alerts. Save your choices, then enable notifications on this phone.</p><form><label><input type="checkbox" id="matchAlertsAll"> ALL GROUPS</label><div class="alert-groups"></div><button type="submit">SAVE PREFERENCES</button></form><div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:12px"><button type="button" id="pushEnable">ENABLE NOTIFICATIONS</button><button type="button" id="pushTest" hidden>SEND TEST NOTIFICATION</button><button type="button" id="pushDisable" hidden>DISABLE NOTIFICATIONS</button></div><p role="status" id="matchAlertsStatus"></p>';
 document.body.append(dialog);const all=dialog.querySelector('#matchAlertsAll'),box=dialog.querySelector('.alert-groups'),status=dialog.querySelector('[role=status]'),save=dialog.querySelector('[type=submit]'),checks=[];
 function sync(){all.checked=checks.every(c=>c.checked);all.indeterminate=checks.some(c=>c.checked)&&!all.checked;}
 for(const group of groups){const label=document.createElement('label'),check=document.createElement('input');check.type='checkbox';check.value=group;label.append(check,document.createTextNode(/^U\d+$/.test(group)?group+"'s":group));box.append(label);checks.push(check);check.addEventListener('change',sync);}
 all.addEventListener('change',()=>{checks.forEach(c=>c.checked=all.checked);sync();});
 dialog.querySelector('#matchAlertsBack').onclick=()=>dialog.close();dialog.addEventListener('close',()=>open.focus());
 async function request(body){const r=await fetch('/api/match-alerts/preferences',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({installId:getInstallId(),...body})});const d=await r.json();if(!r.ok)throw Error(d.error||'Could not save preferences.');return d;}
 open.addEventListener('click',async()=>{dialog.showModal();dialog.querySelector('#matchAlertsBack').focus();status.textContent='Loading…';save.disabled=true;checks.forEach(c=>c.disabled=true);all.disabled=true;
 try{await getServerAppAccess();const d=await request({});checks.forEach(c=>c.checked=d.groups.includes(c.value));sync();status.textContent='Select any groups, or leave all unticked to follow none.';save.disabled=false;checks.forEach(c=>c.disabled=false);all.disabled=false;await updatePushButtons();}catch(e){status.textContent=e.message;}});
 dialog.querySelector('form').onsubmit=async e=>{e.preventDefault();save.disabled=true;status.textContent='Saving…';try{await request({save:true,groups:checks.filter(c=>c.checked).map(c=>c.value)});status.textContent='Preferences saved. Enable notifications to receive your selected groups.';}catch(e){status.textContent=e.message;}finally{save.disabled=false;}};
 const enable=dialog.querySelector('#pushEnable'),test=dialog.querySelector('#pushTest'),disable=dialog.querySelector('#pushDisable');
 let config=null;
 const supported=()=>('Notification' in window)&&('PushManager' in window)&&('serviceWorker' in navigator);
 async function pushApi(path,body){const r=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({installId:getInstallId(),...body})});const d=await r.json();if(!r.ok)throw Error(d.error||'Could not set up notifications.');return d;}
 async function registration(){return await navigator.serviceWorker.register('/sw.js',{scope:'/'}).then(()=>navigator.serviceWorker.ready);}
 function keyBytes(value){const raw=atob(value.replace(/-/g,'+').replace(/_/g,'/'));return Uint8Array.from(raw,c=>c.charCodeAt(0));}
 async function updatePushButtons(){
  if(!supported()){enable.disabled=true;status.textContent='Push is not supported here. On iPhone, use iOS 16.4 or later and open Rugby LIVE from its Home Screen icon.';return;}
  if(!config){const r=await fetch('/api/push/config',{cache:'no-store'});if(!r.ok)throw Error('Notification service unavailable.');config=await r.json();}
  const reg=await registration(),subscription=await reg.pushManager.getSubscription();
  enable.disabled=!config.ready||Notification.permission==='denied';enable.textContent=subscription?'REFRESH NOTIFICATIONS':'ENABLE NOTIFICATIONS';
  test.hidden=!subscription;disable.hidden=!subscription;
  if(Notification.permission==='denied')status.textContent='Notifications are blocked. Allow them for Rugby LIVE in your phone settings, then reopen the app.';
 }
 enable.addEventListener('click',async()=>{
  if(!supported()||!config?.ready)return;enable.disabled=true;
  try{
   // Permission must be requested directly from the user's button press on iPhone.
   const permission=Notification.permission==='granted'?'granted':await Notification.requestPermission();
   if(permission!=='granted')throw Error('Notifications were not allowed. You can change this in phone settings.');
   await getServerAppAccess();const reg=await registration();let subscription=await reg.pushManager.getSubscription();
   if(!subscription)subscription=await reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:keyBytes(config.publicKey)});
   await pushApi('/api/push/subscribe',{subscription:subscription.toJSON()});
   await request({save:true,groups:checks.filter(c=>c.checked).map(c=>c.value)});
   await updatePushButtons();status.textContent='Notifications enabled. Send a test, then check your phone notification tray.';
  }catch(e){status.textContent=e.message;enable.disabled=false;}
 });
 test.addEventListener('click',async()=>{test.disabled=true;try{await pushApi('/api/push/test',{});status.textContent='Test accepted by the push service. Check your phone notifications.';}catch(e){status.textContent=e.message;}finally{test.disabled=false;}});
 disable.addEventListener('click',async()=>{disable.disabled=true;try{const reg=await registration(),subscription=await reg.pushManager.getSubscription();if(subscription){await pushApi('/api/push/unsubscribe',{endpoint:subscription.endpoint});await subscription.unsubscribe();}await updatePushButtons();status.textContent='Notifications disabled on this phone. Your group choices are saved.';}catch(e){status.textContent=e.message;}finally{disable.disabled=false;}});

})();

