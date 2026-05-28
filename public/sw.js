// Service Worker — LabQuality
const CACHE = 'labquality-v1';

self.addEventListener('install', e => {
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(clients.claim());
});

// Estratégia: network first para API, cache first para assets
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  
  // Deixa passar chamadas ao Supabase sem interceptar
  if (url.hostname.includes('supabase.co')) return;

  e.respondWith(
    caches.open(CACHE).then(async cache => {
      // Tenta a rede primeiro
      try {
        const response = await fetch(e.request);
        // Salva no cache apenas GET bem-sucedidos
        if (e.request.method === 'GET' && response.status === 200) {
          cache.put(e.request, response.clone());
        }
        return response;
      } catch {
        // Offline: tenta o cache
        const cached = await cache.match(e.request);
        return cached || new Response('Offline', { status: 503 });
      }
    })
  );
});
