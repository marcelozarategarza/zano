// ZANO — service worker mínimo.
//
// Su único trabajo es guardar una copia de la app (index.html, manifest,
// iconos) la primera vez que se abre con internet, para que el teléfono
// pueda volver a ABRIR la app aunque no haya señal en ese momento. Sin
// esto, sin conexión el navegador ni siquiera puede descargar la página,
// así que no llega a ejecutarse el JS que muestra el pedido guardado.
//
// Nunca guarda en caché nada de /api/ (login, pedidos, pagos, panel de
// admin): esas llamadas siempre van a la red, para no mostrar nunca datos
// viejos como si fueran reales.

// v15: index.html cambió otra vez — se agregó "background-clip:
// content-box" a #nav. Antes, el blanco de la barra pintaba TODO su
// alto, incluyendo la franja de abajo que reserva un iPhone real para
// el gesto de inicio (esa franja mide 0px en una Mac) — por eso en un
// iPhone real la barra blanca se veía más gruesa que en la Mac, aunque
// el código fuera idéntico. Ahora el blanco solo pinta los 33px de
// arriba (donde están los íconos); la franja del gesto se ve del color
// crema del fondo de la app. Resultado: la barra blanca mide EXACTO lo
// mismo en la Mac que en el iPhone.
const CACHE_NAME = 'zano-shell-v15';
const APP_SHELL = [
  './',
  './index.html',
  './admin.html',
  './staff.html',
  './manifest.json',
  './manifest-admin.json',
  './manifest-staff.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .catch(() => { /* si algún archivo falla no bloqueamos la instalación */ })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))
    ))
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;

  // Solo nos metemos en peticiones GET de nuestro propio dominio (la
  // página, el manifest, los iconos). Todo lo demás -PayPal, Google
  // Fonts, y sobre todo /api/- pasa de largo sin tocarlo.
  if (req.method !== 'GET') return;
  if (new URL(req.url).origin !== self.location.origin) return;
  if (req.url.includes('/api/')) return;

  event.respondWith(
    caches.match(req).then((cached) => {
      const fetchAndUpdate = fetch(req)
        .then((res) => {
          if (res && res.ok) {
            const clone = res.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(req, clone));
          }
          return res;
        })
        .catch(() => cached || caches.match('./index.html'));
      // Muestra lo que ya está guardado al instante si existe (rápido y
      // funciona sin señal); mientras tanto actualiza el caché en
      // segundo plano para la próxima vez.
      return cached || fetchAndUpdate;
    })
  );
});
