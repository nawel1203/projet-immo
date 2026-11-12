/* Fonctionnement hors connexion : l'application est gardée en cache.
   Les modules de lecture (PDF, photo, Excel) sont mis en cache à leur premier usage. */
const VERSION = 'v1.0.0';
const COEUR = ['./', 'index.html', 'css/app.css', 'js/parser.js', 'js/donnees.js', 'js/app.js', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(COEUR)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(cles => Promise.all(cles.filter(k => !k.startsWith(VERSION)).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  if (url.origin === location.origin) {
    // Réseau d'abord (pour recevoir les mises à jour), cache si hors connexion.
    e.respondWith(fetch(e.request).then(r => { const copie = r.clone(); caches.open(VERSION).then(c => c.put(e.request, copie)); return r; }).catch(() => caches.match(e.request)));
  } else if (url.hostname === 'cdn.jsdelivr.net' || url.hostname.endsWith('tessdata.projectnaptha.com')) {
    // Modules externes : cache d'abord.
    e.respondWith(caches.match(e.request).then(m => m || fetch(e.request).then(r => { const copie = r.clone(); caches.open(VERSION + '-modules').then(c => c.put(e.request, copie)); return r; })));
  }
});
