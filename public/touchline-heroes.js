(()=>{
 const dialog=document.getElementById('touchlineHeroesDialog'),open=document.getElementById('touchlineHeroesOpen'),list=document.getElementById('touchlineHeroesList'),note=document.getElementById('touchlineHeroesNote');
 const title=document.querySelector('.title'),content=document.querySelector('.content'),anchor=document.createComment('Desktop Touchline Heroes position');
 open.before(anchor);const mobile=matchMedia('(max-width:700px)');
 function place(){if(mobile.matches){content.append(open);open.style.top=(title.offsetTop+title.offsetHeight+18)+'px';}else{anchor.after(open);open.style.removeProperty('top');}}
 mobile.addEventListener('change',place);new ResizeObserver(place).observe(title);place();
 document.getElementById('touchlineHeroesBack').onclick=()=>dialog.close();
 dialog.addEventListener('close',()=>open.focus());
 open.onclick=async()=>{
  if(!dialog.open)dialog.showModal();
  list.replaceChildren();note.textContent='Our touchline volunteers will be recognised here.';
  try{const r=await fetch('/touchline-heroes.json',{cache:'no-store'});if(!r.ok)throw Error();const data=await r.json();if(!Array.isArray(data))throw Error();
   for(const hero of data){if(!hero||typeof hero.name!=='string'||!hero.name.trim())continue;const card=document.createElement('article'),name=document.createElement('h3');name.textContent=hero.name;card.append(name);if(hero.group){const group=document.createElement('p');group.textContent=/^U\d+$/.test(hero.group)?hero.group+"'s":hero.group;card.append(group);}if(Number.isInteger(hero.matches)&&hero.matches>0){const matches=document.createElement('p');matches.textContent='Covered '+hero.matches+' match'+(hero.matches===1?'':'es');card.append(matches);}list.append(card);}
   if(list.children.length)note.textContent='Thank you for keeping rugby LIVE!';
  }catch(e){note.textContent='Our volunteer list is temporarily unavailable. Please try again.';}
 };
})();