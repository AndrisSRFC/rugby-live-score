(()=>{
 if(!isInstalledApp())return;
 const host=document.getElementById('whyAppDialog');
 const details=document.createElement('details');details.className='admin-access-test';
 const summary=document.createElement('summary');summary.textContent='ADMIN · TEST MY APP ACCESS';summary.style.cssText='cursor:pointer;color:#fff;padding:12px 0;font-weight:800';details.append(summary);
 const note=document.createElement('p');note.textContent='TEST version only. End your trial temporarily to test Subscribe / Support. Restore returns the original trial dates and cancels subscription requests created during this test. No payment is needed.';
 const label=document.createElement('label');label.textContent='Admin PIN';const pin=document.createElement('input');pin.type='password';pin.autocomplete='off';pin.style.cssText='width:100%;box-sizing:border-box;padding:12px;margin:8px 0;background:#111;border:1px solid #444;color:#fff;font-size:16px';label.append(pin);
 const status=document.createElement('p');status.setAttribute('role','status');
 details.append(note,label,status);
 for(const [action,text] of [['start','END TRIAL FOR TEST'],['restore','RESTORE ORIGINAL ACCESS']]){
 const b=document.createElement('button');b.type='button';b.textContent=text;details.append(b);
 b.addEventListener('click',async()=>{
  if(!pin.value){status.textContent='Enter your Admin PIN here.';pin.focus();return;}
  const buttons=details.querySelectorAll('button');buttons.forEach(n=>n.disabled=true);status.textContent='Saving…';
  try{
   await getServerAppAccess();
   const r=await fetch('/api/app-access/admin/test',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({pin:pin.value,installId:getInstallId(),action})});const d=await r.json();if(!r.ok)throw Error(d.error||'Access test failed');
   pin.value='';await renderTrialStatus();
   status.textContent=action==='start'?'Trial ended for this test. Go Back to LIVE and select Subscribe / Support.':'Original access restored. Test subscription requests have been cancelled.';
  }catch(e){status.textContent=e.message;}finally{buttons.forEach(n=>n.disabled=false);}
 });
 }
 host.append(details);
})();