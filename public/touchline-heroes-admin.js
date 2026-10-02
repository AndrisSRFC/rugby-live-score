(()=>{
 const dialog=document.getElementById('heroesAdminDialog'),open=document.getElementById('heroesAdminOpen'),list=document.getElementById('heroesAdminRows'),status=document.getElementById('heroesAdminStatus'),save=document.getElementById('heroesAdminSave');
 let revision=null;
 const groups=['U13','U14','U15','U16','Colts','1st XV','2nd XV'];
 async function api(action,body={}){const r=await fetch('/api/touchline-heroes/admin/'+action,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...body,pin:document.getElementById('pin').value})});const d=await r.json();if(!r.ok)throw Error(d.error||'Request failed');return d;}
 function add(hero={name:'',group:'',matches:null,published:false}){
  const row=document.createElement('section');row.className='heroes-admin-row';if(hero.id)row.dataset.id=hero.id;
  const name=document.createElement('input');name.className='hero-name';name.placeholder='Volunteer name';name.maxLength=80;name.value=hero.name;name.setAttribute('aria-label','Volunteer name');
  const group=document.createElement('select');group.className='hero-group';group.setAttribute('aria-label','Age group');group.append(new Option('All groups / not specified',''));for(const g of groups)group.append(new Option(/^U\d+$/.test(g)?g+"'s":g,g));group.value=hero.group;
  const matches=document.createElement('input');matches.type='number';matches.className='hero-matches';matches.min='0';matches.max='10000';matches.step='1';matches.placeholder='Matches covered (optional)';matches.value=hero.matches===null?'':hero.matches;matches.setAttribute('aria-label','Matches covered');
  const label=document.createElement('label'),published=document.createElement('input');published.type='checkbox';published.className='hero-published';published.checked=hero.published;label.append(published,document.createTextNode(' Show publicly'));
  row.append(name,group,matches,label);list.append(row);
 }
 open.onclick=async()=>{dialog.showModal();revision=null;save.disabled=true;list.replaceChildren();status.textContent='Loading…';try{const d=await api('read');revision=d.revision;for(const h of d.heroes)add(h);status.textContent='';save.disabled=false;}catch(e){status.textContent=e.message;}};
 document.getElementById('heroesAdminClose').onclick=()=>dialog.close();dialog.addEventListener('close',()=>open.focus());
 document.getElementById('heroesAdminAdd').onclick=()=>{if(revision===null)return;if(list.children.length>=100){status.textContent='Maximum 100 volunteers.';return;}add();list.lastElementChild.querySelector('input').focus();};
 save.onclick=async()=>{
  if(revision===null)return;
  const heroes=[...list.children].map(row=>({id:row.dataset.id||null,name:row.querySelector('.hero-name').value,group:row.querySelector('.hero-group').value,matches:row.querySelector('.hero-matches').value===''?null:Number(row.querySelector('.hero-matches').value),published:row.querySelector('.hero-published').checked}));
  save.disabled=true;try{const d=await api('save',{heroes,revision});revision=d.revision;list.replaceChildren();for(const h of d.heroes)add(h);status.textContent='Saved. Published volunteers are now visible in Touchline Heroes.';}catch(e){status.textContent=e.message;}finally{save.disabled=false;}
 };
})();