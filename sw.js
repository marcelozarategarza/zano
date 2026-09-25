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

// v25: se corrigió cómo se calcula "la semana que se está armando" —
// antes podía calcular un lunes que ya había pasado (por ejemplo, ver
// "Lunes 21" un viernes, cuando esa semana casi ya se terminó). Ahora
// siempre calcula el PRÓXIMO lunes que todavía no llega, recalculándolo
// solo cada vez que se abre la app. También se cambió el formato de la
// fecha junto a cada día, de solo "28" a "28/09" (día/mes), otra vez en
// Mi semana, Admin y Cocina por igual.

// v26: se revirtió el cambio de nombre a MAZANO — la app vuelve a
// llamarse ZANO en todo (título, logo, badges, textos de correos,
// iconos de pantalla de inicio). Se sube la versión del caché para que
// los teléfonos que ya habían instalado la versión "MAZANO" bajen esta
// actualización y dejen de mostrar el logo/nombre viejo.

// v27: se quitó "chorizo" de la descripción de Huevos Rancheros (ahora
// solo dice "machaca").

// v28: se agregó el botón "Volver a inicio" en la pantalla de
// Iniciar sesión / Crear cuenta.

// v29: se agregó la foto real de Huevos Rancheros (antes solo mostraba
// el cuadro gris "[FOTO DEL PLATILLO]").

// v30: se agregó la foto real de Ensalada César.

// v31: se agregó la foto real de Pasta Alfredo con Pollo.

// v32: se agregó la foto real de Huevos Americanos.

// v33: se agregó la foto real de Poke. Con esto, los 5 platillos del
// menú ya tienen su foto real (ya no queda ninguno con el cuadro gris
// "[FOTO DEL PLATILLO]").

// v34: se agregó "Agua (1 litro)" en Bebidas y postres, aclarando que
// va incluida gratis con el pedido.

// v35: se arregló que el pago con PayPal se quedaba atorado cuando la
// app se usa ya instalada como ícono en la pantalla de inicio (iOS
// manda esa ventanita de pago a una pestaña de Safari suelta, sin
// conexión con la app, y la X de PayPal no puede cerrarla ni avisar
// que se canceló — es una limitación de Apple con apps instaladas, no
// un error de esta app). Ahora, si detecta que está abierta así, en
// vez de abrir ese botón roto muestra un aviso con un enlace para
// abrir la misma página en Safari normal y pagar ahí sin problema.

// v36: se encontró la causa real de que la X de PayPal no se pudiera
// tocar bien (confirmado con captura): nuestra página usa
// "viewport-fit=cover" para que el resto de la app se vea bien detrás
// del notch/Dynamic Island del iPhone, pero la ventanita de PayPal NO
// sabe nada de eso — dibuja su propia X pegada al borde de arriba
// pensando que ahí empieza la pantalla, y por eso queda escondida justo
// detrás del reloj/batería, casi imposible de tocar. Ahora, mientras se
// muestra esa ventanita de PayPal, se le quita por un momento el
// "viewport-fit=cover" (así su X se dibuja más abajo, en zona segura),
// y se regresa a la normalidad en cuanto el pago termina (aprobado,
// cancelado o con error).

// v37: se actualizaron los macros de Salmón (40g proteína, 0g carbos,
// 26g grasa) y Camarón (46g proteína, 0.4g carbos, 3.4g grasa) como
// proteínas del Poke, tomados directo de la hoja de costeo. Atún no se
// tocó.
const CACHE_NAME = 'zano-shell-v37';
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
