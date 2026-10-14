const NAME='familymoney-v2-shell-1';
const SHELL=['./','./index.html','./style.css','./app.js','./config.js','./icon.svg','./manifest.webmanifest'];
self.addEventListener('install',event=>{event.waitUntil(caches.open(NAME).then(c=>c.addAll(SHELL)));self.skipWaiting()});
self.addEventListener('activate',event=>{event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('familymoney-')&&k!==NAME).map(k=>caches.delete(k)))));self.clients.claim()});
self.addEventListener('fetch',event=>{const url=new URL(event.request.url);if(event.request.method!=='GET'||url.origin!==self.location.origin)return; if(!SHELL.some(p=>new URL(p,self.registration.scope).pathname===url.pathname))return;event.respondWith(fetch(event.request).then(response=>{const copy=response.clone();caches.open(NAME).then(c=>c.put(event.request,copy));return response}).catch(()=>caches.match(event.request)))});
