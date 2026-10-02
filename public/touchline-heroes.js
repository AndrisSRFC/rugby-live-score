(()=>{
 const dialog=document.getElementById('touchlineHeroesDialog'),open=document.getElementById('touchlineHeroesOpen'),list=document.getElementById('touchlineHeroesList'),note=document.getElementById('touchlineHeroesNote');
 const help=document.querySelector('.score-help'),home=document.querySelector('.home-screen'),promos=document.querySelector('.home-promo-stack');
 const anchor=document.createComment('Desktop Touchline Heroes position'),helpAnchor=document.createComment('Original Touchline Team position');
 open.before(anchor);help.before(helpAnchor);
 const tools=document.createElement('div');tools.className='touchline-mobile-tools';home.append(tools);
 const mobile=matchMedia('(max-width:700px)');
 function positionPromos(){if(mobile.matches)promos.style.top=(tools.offsetTop+tools.offsetHeight+12)+'px';else promos.style.removeProperty('top');}
 function place(){if(mobile.matches){tools.append(help,open);open.style.removeProperty('top');}else{helpAnchor.after(help);anchor.after(open);}positionPromos();}
 mobile.addEventListener('change',place);new ResizeObserver(positionPromos).observe(tools);place();
 document.getElementById('touchlineHeroesBack').onclick=()=>dialog.close();
 dialog.addEventListener('close',()=>open.focus());
 open.onclick=async()=>{
  if(!dialog.open)dialog.showModal();
  list.replaceChildren();note.textContent='Our touchline volunteers will be recognised here.';
  try{const r=await fetch('/api/touchline-heroes',{cache:'no-store'});if(!r.ok)throw Error();const data=await r.json();if(!Array.isArray(data))throw Error();
   for(const hero of data){if(!hero||typeof hero.name!=='string'||!hero.name.trim())continue;const card=document.createElement('article'),name=document.createElement('h3');name.textContent=hero.name;card.append(name);if(hero.group){const group=document.createElement('p');group.textContent=/^U\d+$/.test(hero.group)?hero.group+"'s":hero.group;card.append(group);}if(Number.isInteger(hero.matches)&&hero.matches>0){const matches=document.createElement('p');matches.textContent='Covered '+hero.matches+' match'+(hero.matches===1?'':'es');card.append(matches);}list.append(card);}
   if(list.children.length)note.textContent='Thank you for keeping rugby LIVE!';
  }catch(e){note.textContent='Our volunteer list is temporarily unavailable. Please try again.';}
 };
})();