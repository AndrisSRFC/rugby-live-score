(()=>{
 const key='rugbyLiveExcludeVisits';
 const visitId=crypto.randomUUID().replace(/-/g,'');
 const excluded=()=>localStorage.getItem(key)==='1';
 const sockets=new Set();
 window.RugbyVisits={
  excluded,
  query:()=>({visitId,excludeVisits:excluded()?'1':'0'}),
  bind(socket){sockets.add(socket);},
  render(data,team){const el=document.getElementById('totalViewsCount');if(el)el.textContent=Number(team?data.groups?.[({'1stXV':'1st XV','2ndXV':'2nd XV'})[team]||team]||0:data.total||0).toLocaleString('en-GB');const row=document.getElementById('totalViewsRow');if(row)row.title=data.enabled?'Visits since '+new Date(data.startedAt).toLocaleDateString('en-GB'):'Counting will start at public launch.';}
 };
 window.addEventListener('storage',event=>{if(event.key!==key)return;for(const socket of sockets){socket.disconnect();socket.io.opts.query={...socket.io.opts.query,...window.RugbyVisits.query()};socket.connect();}});
})();