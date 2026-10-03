(()=>{
const data=[
{name:'Turnbull',main:true,x:79,w:165,url:'https://www.turnbull.co.uk/cms/branches/sleaford-general-building-supplies/'},
{name:'1 Stop Spas',x:278,w:94,url:'https://1stopspas.com/'},
{name:'C.P.S. LTD',x:398,w:58},
{name:'The Food Heroes',x:488,w:101},
{name:'Winkworth',x:620,w:88,url:'https://www.winkworth.co.uk/estate-agents/sleaford'},
{name:'PREVAIL Strength & Conditioning',x:742,w:160,url:'https://www.facebook.com/p/Prevail-Strength-Conditioning-61564651198615/'}];
const el=(tag,text,cls)=>{const n=document.createElement(tag);if(text)n.textContent=text;if(cls)n.className=cls;return n;};
function logo(s){const n=el('span',null,'sponsor-logo');n.style.setProperty('--logo-x',s.x+'px');n.style.width=s.w+'px';n.setAttribute('role','img');n.setAttribute('aria-label',s.name+' logo');return n;}
const tile=el('button',null,'sponsor-teaser');tile.id='sponsorsOpen';tile.type='button';tile.setAttribute('aria-haspopup','dialog');tile.setAttribute('aria-controls','sponsorsDialog');
const art=el('span',null,'sponsor-teaser-art'),label=el('span',null,'sponsor-teaser-label');
tile.append(el('strong','OUR SPONSORS'),art,label,el('span','Tap to view all →','sponsor-teaser-hint'));
const dialog=el('dialog',null,'sponsors-dialog');dialog.id='sponsorsDialog';dialog.setAttribute('aria-labelledby','sponsorsTitle');
const back=el('button','← Back to LIVE','sponsors-back');back.type='button';
const title=el('h2','OUR SPONSORS');title.id='sponsorsTitle';dialog.append(back,title,el('p','Supporting Sleaford Rugby Club'));
const list=el('div',null,'sponsor-cards');dialog.append(list);
function link(s,text){const a=el('a',text,'sponsor-visit');a.href=s.url;a.target='_blank';a.rel='noopener noreferrer';a.setAttribute('aria-label','Visit '+s.name+' (opens in a new tab)');return a;}
data.forEach(s=>{const c=el('section',null,'sponsor-card');if(s.main){c.classList.add('sponsor-main');c.append(el('strong','MAIN SPONSOR','sponsor-role'));}
c.append(logo(s),el('h3',s.name));if(s.url)c.append(link(s,'Visit '+(s.url.includes('facebook.com')?'Facebook':'website')+' ↗'));list.append(c);});
document.body.append(dialog);tile.addEventListener('click',()=>dialog.showModal());back.addEventListener('click',()=>dialog.close());dialog.addEventListener('close',()=>tile.focus());
const phone=matchMedia('(max-width:700px)');function place(){if(phone.matches)document.querySelector('.home-primary-actions').before(tile);else document.getElementById('whyAppOpen').after(tile);}
phone.addEventListener('change',place);place();
let current=0,paused=false;function show(){const s=data[current];art.replaceChildren(logo(s));label.textContent=s.main?'MAIN SPONSOR · Turnbull':s.name;}
tile.addEventListener('mouseenter',()=>paused=true);tile.addEventListener('mouseleave',()=>paused=false);tile.addEventListener('focus',()=>paused=true);tile.addEventListener('blur',()=>paused=false);
show();if(!matchMedia('(prefers-reduced-motion:reduce)').matches)setInterval(()=>{if(document.hidden||dialog.open||paused)return;current=(current+1)%data.length;show();},6000);
})();