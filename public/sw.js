self.addEventListener('install', () => {
  self.skipWaiting();
  });
self.addEventListener('activate', () => {
    self.clients.claim();
  });

self.addEventListener('push',event=>{
 let data={};try{data=event.data?.json()||{};}catch{}
 event.waitUntil(self.registration.showNotification(data.title||'RUGBY LIVE',{
 body:data.body||'New match update',icon:'/age-group-live-icon.png',
 tag:data.tag||'rugby-live-update',data:{url:data.url||'/'}
 }));
});
self.addEventListener('notificationclick',event=>{
 event.notification.close();
 event.waitUntil((async()=>{
  const url=new URL(event.notification.data?.url||'/',self.location.origin);
  if(url.origin!==self.location.origin)return;
  const windows=await self.clients.matchAll({type:'window',includeUncontrolled:true});
  for(const client of windows){if(client.url===url.href){await client.focus();return;}}
  await self.clients.openWindow(url.href);
 })());
});

