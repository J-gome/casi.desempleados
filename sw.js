/* Service Worker de (Casi) Desempleados: modo sin conexión.
   - La app (juegos, buzón, descripción, tarjetas) se abre sin internet.
   - Los enlaces a Spotify/YouTube/TikTok/Instagram sí necesitan internet.
   - El buzón sin conexión guarda la historia y la envía sola al volver la red.
   IMPORTANTE: al cambiar este archivo, sube el número de CACHE_NAME
   para que los teléfonos actualicen su copia guardada. */
const CACHE_NAME = 'casi-desempleados-v1';
const GOOGLE_FORM_ACTION_URL = 'https://docs.google.com/forms/d/e/1FAIpQLSdJfJ6zFq1rqkDVODo2Se8uhXiMT2bGeLcEkhU7Xt9pDcX-OQ/formResponse';

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then((cache) => cache.addAll(['./', './index.html']))
            .then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys()
            .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
            .then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', (event) => {
    const req = event.request;
    if (req.method !== 'GET') return;

    // Navegación (el HTML de la app): red primero, copia guardada si no hay red.
    if (req.mode === 'navigate') {
        event.respondWith(
            fetch(req).then((res) => {
                if (res && res.ok) {
                    const copy = res.clone();
                    caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
                }
                return res;
            }).catch(() => caches.match(req).then((cached) => cached || caches.match('./index.html')))
        );
        return;
    }

    // Lo demás (Tailwind, Font Awesome, fuentes, imágenes): copia guardada
    // primero y se actualiza en segundo plano.
    event.respondWith(
        caches.match(req).then((cached) => {
            const network = fetch(req).then((res) => {
                if (res && (res.ok || res.type === 'opaque')) {
                    const copy = res.clone();
                    caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
                }
                return res;
            }).catch(() => cached);
            return cached || network;
        })
    );
});

// Buzón sin conexión: envío diferido cuando vuelve la red.
self.addEventListener('sync', (event) => {
    if (event.tag === 'enviar-buzon') {
        event.waitUntil(flushBuzonOutbox());
    }
});

function openBuzonDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open('casi-desempleados', 1);
        request.onupgradeneeded = () => {
            if (!request.result.objectStoreNames.contains('buzon-outbox')) {
                request.result.createObjectStore('buzon-outbox', { keyPath: 'id', autoIncrement: true });
            }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

async function flushBuzonOutbox() {
    const db = await openBuzonDB();
    const items = await new Promise((resolve, reject) => {
        const tx = db.transaction('buzon-outbox', 'readonly');
        const req = tx.objectStore('buzon-outbox').getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => reject(req.error);
    });
    for (const item of items) {
        const formData = new URLSearchParams();
        formData.append('entry.370750559', item.alias || 'Anónimo');
        formData.append('entry.116396303', item.privacy);
        formData.append('entry.1234219413', item.story);
        await fetch(GOOGLE_FORM_ACTION_URL, {
            method: 'POST',
            mode: 'no-cors',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: formData.toString()
        });
        await new Promise((resolve, reject) => {
            const tx = db.transaction('buzon-outbox', 'readwrite');
            const req = tx.objectStore('buzon-outbox').delete(item.id);
            req.onsuccess = () => resolve();
            req.onerror = () => reject(req.error);
        });
    }
    const clients = await self.clients.matchAll({ includeUncontrolled: true });
    clients.forEach((client) => client.postMessage({ type: 'buzon-outbox-flushed', count: items.length }));
}
