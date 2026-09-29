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

// v38: se cambió por completo cómo se cobra. Antes, el botón de pagar
// abría una ventanita/pestaña de PayPal encima de la app, y esa
// ventanita se podía quedar atorada al cancelar (sobre todo con la app
// agregada a la pantalla de inicio — los intentos de arreglarlo de las
// versiones v35 y v36 no fueron suficientes). Ahora ya no hay ninguna
// ventanita: al tocar "Pagar", el propio servidor crea la orden en
// PayPal (nuevo api/paypal.js) y la app manda a la persona derechito a
// la página segura de PayPal, con una navegación normal — igual que
// abrir cualquier enlace. En cuanto termina de pagar o cancela, PayPal
// regresa sola a la app, que confirma el cobro automáticamente. Esto
// funciona igual en cualquier navegador, en incógnito, y también con la
// app agregada a la pantalla de inicio. También se agregó Apple Pay
// como opción de pago (en iPhone/iPad/Mac con Safari, cuando la cuenta
// de PayPal de ZANO ya lo tenga habilitado) — si no está disponible,
// simplemente no aparece ese botón y el de PayPal/tarjeta sigue
// funcionando normal.
// v39: se cambió cómo se calculan Ganancia bruta y Ganancia neta en el
// panel de administración (pestaña Resumen). Ganancia bruta ahora resta 5
// gastos en vez de 3: Ingredientes, Empaque, Comisión al instituto (nuevo),
// Salario del staff (nuevo) y Otros gastos — todos capturados por semana en
// la pestaña "Gastos". Ganancia neta cambió por completo: ya NO depende de
// los gastos de la semana; ahora es un "valor de referencia" fijo (que tú
// capturas UNA SOLA VEZ, no cambia semana a semana) menos $20 por cada
// pedido pagado de esa semana. El valor de referencia se edita también en
// la pestaña "Gastos", en su propio recuadro separado del formulario por
// semana.
// v40: se agregó la pestaña "Historial" en el panel de administración —
// muestra, una debajo de otra, TODAS las semanas con pedidos pagados (de la
// más reciente a la más antigua) con sus 4 datos: Ventas, Pedidos pagados,
// Ganancia bruta y Ganancia neta. Es solo para ver el historial completo de
// un vistazo, sin tener que ir cambiando de semana en el selector de la
// pestaña Resumen.
// v41: se corrigió el botón "Exportar a Excel" del panel de administración
// — desde el cambio de fórmulas se había quedado usando las de ANTES
// (restaba solo Ingredientes+Empaque+Otros gastos de las ventas, sin
// Comisión al instituto ni Salario del staff, y le seguía llamando
// "Ganancia neta" a lo que ahora es Ganancia bruta). Ahora la hoja
// "Resumen semanal" trae ambas columnas correctas (Ganancia bruta Y
// Ganancia neta, cada una con su propia fórmula), más las columnas de los
// 2 gastos nuevos; la hoja "Gastos" también los incluye; y se agregó una
// hoja nueva "Valor de referencia" mostrando el valor fijo que usas para
// Ganancia neta.
// v42: cambio grande en cómo se calculan los gastos de la semana. Antes
// escribías a mano Ingredientes, Empaque, Comisión al instituto y Salario
// del staff cada semana. Ahora esos 4 (más uno nuevo, "Pago de inversión")
// se calculan SOLOS, platillo por platillo vendido: de cada platillo se
// reparten siempre $70 ($20 sueldo del jefe, $20 sueldo de los dos
// cocineros, $10 comisión al instituto, $20 pago de inversión) y el resto
// del precio del platillo es el costo real de Ingredientes (empaque ya va
// incluido ahí, por eso se quitó ese campo). Lo único que sigues metiendo a
// mano en la pestaña "Gastos" es "Otros gastos" (transporte, gas, etc.) y
// las notas. También se corrigió el Excel exportado para que muestre este
// mismo desglose.
// v43: en la portada, se cambió el texto "Recógelo en tu escuela" por
// "Recógela cuando quieras" (uno de los 3 recuadros con ícono debajo del
// título). El texto de "pagos seguros con PayPal" que se pidió quitar no se
// encontró en ninguna pantalla de la app — se le pidió al dueño una captura
// de pantalla para ubicarlo exactamente.
const CACHE_NAME = 'zano-shell-v43';
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
