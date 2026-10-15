'use strict';
const CACHE = 'pocket-cricket-v6';
const ASSETS = ['./', './index.html', './styles.css?v=6', './engine.js?v=6', './app.js?v=6', './online.js?v=6', './pitch.js?v=6', './presentation.js?v=6', './peerjs.min.js', './icon.svg', './manifest.webmanifest'];
self.addEventListener('install', event => { event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS)).then(() => self.skipWaiting())); });
self.addEventListener('activate', event => { event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith('pocket-cricket-') && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET' || new URL(event.request.url).origin !== self.location.origin) return;
  event.respondWith(fetch(event.request).then(response => { if (response.ok && ASSETS.some(path => new URL(path, self.registration.scope).pathname === new URL(event.request.url).pathname)) { const copy = response.clone(); caches.open(CACHE).then(cache => cache.put(event.request, copy)); } return response; }).catch(() => caches.match(event.request).then(cached => cached || (event.request.mode === 'navigate' ? caches.match('./index.html') : Response.error()))));
});

