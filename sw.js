/**
 * StudyCards Service Worker
 * Provides offline caching, standalone desktop/Chromebook PWA support,
 * and background asset updates via GitHub.
 */

const CACHE_NAME = 'studycards-v7';

const STATIC_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './css/main.css',
  './css/components.css',
  './css/study.css',
  './css/responsive.css',
  './js/app.js',
  './js/models.js',
  './js/storage.js',
  './js/srs.js',
  './js/generalKnowledgeData.js',
  './js/importers.js',
  './js/occlusionCanvas.js',
  './js/ui/dashboardView.js',
  './js/ui/studyView.js',
  './js/ui/treeView.js',
  './js/ui/cardEditor.js',
  './js/ui/modal.js',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

// Install: Cache all static assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('[SW] Pre-caching offline assets');
      return cache.addAll(STATIC_ASSETS);
    }).then(() => self.skipWaiting())
  );
});

// Activate: Clean up old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            console.log('[SW] Removing old cache:', key);
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Fetch: Stale-While-Revalidate for app assets, Cache-First for fonts
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Ignore non-GET requests or browser extension schemes
  if (event.request.method !== 'GET' || !url.protocol.startsWith('http')) {
    return;
  }

  // Google Fonts caching
  if (url.origin.includes('fonts.googleapis.com') || url.origin.includes('fonts.gstatic.com')) {
    event.respondWith(
      caches.open('studycards-fonts').then((cache) => {
        return cache.match(event.request).then((cached) => {
          if (cached) return cached;
          return fetch(event.request).then((networkResp) => {
            cache.put(event.request, networkResp.clone());
            return networkResp;
          }).catch(() => cached);
        });
      })
    );
    return;
  }

  // App Assets: Stale-While-Revalidate (Instant offline response + background refresh)
  event.respondWith(
    caches.match(event.request).then((cached) => {
      const fetchPromise = fetch(event.request).then((networkResp) => {
        if (networkResp && networkResp.status === 200) {
          const respClone = networkResp.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, respClone);
          });
        }
        return networkResp;
      }).catch((err) => {
        // Network offline, return cached or fail gracefully
        return cached;
      });

      return cached || fetchPromise;
    })
  );
});
