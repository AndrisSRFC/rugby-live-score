(()=>{
 let prompt=null,lastFocus=null;
 const standalone=()=>matchMedia('(display-mode: standalone)').matches||navigator.standalone===true;
 const dialog=document.createElement('dialog');dialog.className='app-upgrade-dialog';dialog.id='appUpgradeDialog';dialog.setAttribute('aria-labelledby','appUpgradeTitle');
 dialog.innerHTML='<h2 id="appUpgradeTitle">GET MORE WITH THE RUGBY LIVE APP</h2><p id="appUpgradeText">Install the app to view player stats, match history and the NLD table.</p><p>30 days free · At least 50% of your payment supports the club.</p><button type="button" id="appUpgradeInstall">INSTALL APP</button><button type="button" id="appUpgradeSubscribe" hidden>SUBSCRIBE / SUPPORT</button><button type="button" class="app-upgrade-back" id="appUpgradeBack">BACK TO LIVE</button><p class="app-upgrade-note" id="appUpgradeNote" role="status"></p>';
 document.body.append(dialog);
 function id(){let value=localStorage.getItem('rugbyLiveInstallId');if(!value){const bytes=new Uint8Array(18);crypto.getRandomValues(bytes);value='rli_'+Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');localStorage.setItem('rugbyLiveInstallId',value);}return value;}
 async function access(){
  let r=await fetch('/api/app-access?installId='+encodeURIComponent(id()),{cache:'no-store'});
  if(r.status===404)r=await fetch('/api/app-access/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({installId:id()})});
  if(!r.ok)throw Error('Could not check app access. Please try again.');return r.json();
 }
 function show(expired=false,note=''){
  lastFocus=document.activeElement;document.getElementById('appUpgradeTitle').textContent=expired?'KEEP RUGBY LIVE RUNNING':'GET MORE WITH THE RUGBY LIVE APP';
  document.getElementById('appUpgradeText').textContent=expired?'Your app access has ended. Subscribe to view player stats, match history and the NLD table.':'Install the app to view player stats, match history and the NLD table.';
  document.getElementById('appUpgradeInstall').hidden=expired;document.getElementById('appUpgradeSubscribe').hidden=!expired;
  document.getElementById('appUpgradeNote').textContent=note;if(!dialog.open)dialog.showModal();
 }
 document.getElementById('appUpgradeBack').onclick=()=>dialog.close();
 dialog.addEventListener('close',()=>lastFocus?.isConnected&&lastFocus.focus());
 document.getElementById('appUpgradeSubscribe').onclick=()=>location.assign('/?subscribe=1');
 window.addEventListener('beforeinstallprompt',event=>{event.preventDefault();prompt=event;});
 document.getElementById('appUpgradeInstall').onclick=async()=>{
  if(prompt){const offer=prompt;prompt=null;await offer.prompt();const choice=await offer.userChoice;document.getElementById('appUpgradeNote').textContent=choice.outcome==='accepted'?'Open Rugby LIVE from your home screen to start your trial.':'You can install later from your browser menu.';}
  else document.getElementById('appUpgradeNote').textContent=/iPhone|iPad|iPod/.test(navigator.userAgent)?'On iPhone: open this page in Safari, tap Share, then Add to Home Screen. Open it from your home screen.':'Open your browser menu and choose Install app or Add to Home Screen. Then open Rugby LIVE from its app icon.';
 };
 window.RugbyAppAccess={
  installed:standalone,
  headers:()=>standalone()?{'X-Rugby-Install':id()}:{},
  show,
  async ensure(){if(!standalone()){show();return false;}try{const a=await access();if(['trial','subscriber','owner'].includes(a.status))return true;show(true);return false;}catch(e){show(true,e.message);return false;}},
  async fetch(url,options={}){const r=await fetch(url,{...options,cache:'no-store',headers:{...options.headers,...this.headers()}});if(r.status===403){show(standalone());throw Error('App access is required.');}return r;}
 };
 if('serviceWorker'in navigator)navigator.serviceWorker.register('/sw.js').catch(()=>{});
})();