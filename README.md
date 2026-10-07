# ZANO — App web

App web real (HTML + CSS + JS puro, sin frameworks ni pasos de build) que reproduce el prototipo de ZANO: Inicio, Menú (con el Poke personalizable), Mi semana (con horarios de recogida por día), Pago y confirmación.

`index.html` funciona con solo abrirlo en el navegador — no necesita servidor, ni `npm install`, ni configuración de ningún tipo. En ese modo ("modo local") las cuentas y pedidos solo viven en la memoria del navegador de cada quien, como al principio.

Desde esta versión, el proyecto también trae un **backend chiquito opcional** (carpeta `api/`) para guardar cuentas y pedidos de verdad en una base de datos, y mandar correos automáticos (bienvenida, aviso a ti, confirmación de pago, y recordatorios). Ver la sección **"Cuentas guardadas y correos automáticos"** más abajo — esa parte sí necesita desplegarse en **Vercel** (no funciona con GitHub Pages ni arrastrando el archivo a Netlify, porque esas opciones no corren código de servidor). Si no la configuras, la app sigue funcionando exactamente como hasta ahora, en modo local.

## Cómo subirlo a GitHub y publicarlo (GitHub Pages)

*(Esta opción es la más simple, pero solo sirve para la app en modo local, sin cuentas guardadas ni correos automáticos. Si quieres esa parte, sáltate a "Desplegar en Vercel" más abajo.)*

1. Entra a [github.com](https://github.com) y crea un repositorio nuevo (por ejemplo `zano-app`). Puede ser público o privado — para GitHub Pages gratis normalmente se necesita que sea público (en cuentas Pro también funciona privado).

2. En tu computadora, dentro de una carpeta vacía, corre estos comandos (sustituye `TU-USUARIO` por tu usuario de GitHub):

```bash
git init
git add index.html README.md
git commit -m "ZANO app web"
git branch -M main
git remote add origin https://github.com/TU-USUARIO/zano-app.git
git push -u origin main
```

   (Antes de esto, copia el archivo `index.html` que te compartí a esa carpeta.)

3. En GitHub, entra al repositorio → pestaña **Settings** → sección **Pages** (en el menú lateral izquierdo).

4. En "Build and deployment" → "Source", elige **Deploy from a branch**. En "Branch" selecciona `main` y la carpeta `/ (root)`. Guarda.

5. Espera 1–2 minutos y GitHub te va a dar una liga tipo:

```
https://TU-USUARIO.github.io/zano-app/
```

   Esa liga ya es la app funcionando, y puedes compartirla con quien quieras.

### Alternativa aún más rápida (sin usar la terminal)

Si no quieres usar `git` desde la terminal:

1. Crea el repositorio vacío en GitHub (como en el paso 1).
2. Ahí mismo, en la página del repo, dale clic a "uploading an existing file" (o "Add file" → "Upload files").
3. Arrastra el `index.html` (y este `README.md` si quieres).
4. Dale "Commit changes".
5. Sigue con los pasos 3–5 de arriba para activar GitHub Pages.

### Otra opción sin GitHub Pages: Vercel o Netlify

Si prefieres, puedes arrastrar la carpeta directo a [vercel.com](https://vercel.com) o [app.netlify.com/drop](https://app.netlify.com/drop) (sin cuenta de GitHub siquiera) y te dan una liga pública al instante.

## Cobro dentro de la app (Mercado Pago)

La pantalla de Pagar cobra de verdad con Mercado Pago — no es una simulación. Antes usaba PayPal; se reemplazó por completo, así que cualquier pago que se confirme en la app es dinero real, que llega a tu cuenta de Mercado Pago.

Igual que antes: pagar **no abre ninguna ventanita/pestaña encima de la app**. Al tocar "Pagar con Mercado Pago", el propio servidor (`api/mercadopago.js`) crea la "preferencia" (el equivalente a una orden) y la app manda a la persona derechito a la página segura de Mercado Pago — una navegación normal, como abrir cualquier enlace, no una ventana nueva. Ahí mismo aparecen automáticamente TODOS los métodos de pago que tengas activados en tu cuenta (tarjeta de crédito/débito, saldo de Mercado Pago, efectivo en OXXO, transferencia, y Apple Pay/Google Pay si tu cuenta los tiene habilitados) — no hace falta programar cada uno por separado; si quieres activar o desactivar alguno, se hace directo desde la configuración de tu cuenta de Mercado Pago, no en el código. En cuanto la persona termina de pagar (o cancela, o deja un pago pendiente como un voucher de OXXO), Mercado Pago la regresa sola a la app. Esto necesita el backend (carpeta `api/`, ver más abajo la sección "Cuentas guardadas y correos automáticos") — sin él, la app sigue funcionando en modo local pero sin poder cobrar de verdad.

Si un platillo todavía tiene precio pendiente (`[PRECIO]`), la app no deja pagar esa semana hasta que se le asigne un precio real — para evitar cobrar de más o de menos por error.

### El Access Token de Mercado Pago (solo para el servidor)

A diferencia de PayPal (que necesitaba dos datos, un Client ID público y un Secret privado), Mercado Pago solo necesita UNO: el **Access Token**. Es privado — NUNCA va en `index.html` ni se sube a GitHub, solo se agrega como variable de entorno en Vercel.

1. Entra a [www.mercadopago.com.mx](https://www.mercadopago.com.mx) e inicia sesión con tu cuenta de Mercado Pago (la misma con la que ya te diste de alta como negocio).
2. Ve a [mercadopago.com.mx/developers/panel/app](https://www.mercadopago.com.mx/developers/panel/app) (o busca "Tus integraciones" / "Credenciales" desde tu panel de Mercado Pago).
3. Si es la primera vez, te va a pedir crear una aplicación ("Crear aplicación") — dale cualquier nombre, por ejemplo "ZANO".
4. Entra a esa aplicación → pestaña **Credenciales de producción** (NO "Credenciales de prueba" — esas son para pruebas, no cobran dinero real).
5. Copia el **Access Token** (una cadena larga que empieza con `APP_USR-`). Si no lo ves de una vez, puede pedirte completar unos datos del negocio primero (RFC, etc.) — es normal, Mercado Pago lo pide para activar cobros de producción.
6. En [vercel.com/dashboard](https://vercel.com/dashboard), entra a tu proyecto de ZANO → **Settings** → **Environment Variables**.
7. Agrega una variable nueva: nombre `MERCADOPAGO_ACCESS_TOKEN`, valor lo que copiaste en el paso 5. Guarda.
8. Ve a la pestaña **Deployments** y dale **Redeploy** al último despliegue (o simplemente sube cualquier archivo nuevo a GitHub — cualquiera de los dos hace que Vercel tome en cuenta la variable nueva).

Con eso ya queda funcionando el cobro completo, incluyendo el aviso automático que Mercado Pago manda solo al servidor cuando un pago pendiente (como un voucher de OXXO) se termina de confirmar — no hay que registrar nada aparte para eso, ya viene incluido en cada pago que se crea.

Si en algún momento un pago no se confirma o algo se ve raro en el cobro, la app no se rompe — solo revisamos juntos con una captura de pantalla de lo que veas (y, si hace falta, el "ID del pago" que aparece en la pantalla de error).

### Tarjetas guardadas (opcional)

Además del botón de siempre ("Pagar con Mercado Pago"), la app ahora deja que cualquier cliente guarde una tarjeta desde Perfil → Cuenta → Métodos de pago, y la próxima vez pague con ella sin volver a escribirla completa (solo le vuelve a pedir el CVV, por seguridad — Mercado Pago nunca lo guarda). El número de la tarjeta nunca pasa por nuestro servidor: va directo del teléfono de la persona a Mercado Pago.

Para que esta parte funcione hace falta UN dato más, distinto del Access Token de arriba: la **Public Key**. A diferencia del Access Token, la Public Key SÍ es segura de poner directamente en `index.html` (para eso existen las "llaves públicas") — no hace falta configurar nada en Vercel para esto.

1. En el mismo panel donde copiaste el Access Token ([mercadopago.com.mx/developers/panel/app](https://www.mercadopago.com.mx/developers/panel/app) → tu aplicación → **Credenciales de producción**), busca justo arriba o al lado del Access Token un campo llamado **Public Key** (empieza con `APP_USR-` también, pero es un dato distinto al Access Token — no los confundas).
2. Copia esa Public Key.
3. Abre `index.html`, busca la línea `const MERCADOPAGO_PUBLIC_KEY = 'TU_PUBLIC_KEY';` (está cerca de la configuración de EmailJS) y reemplaza `'TU_PUBLIC_KEY'` por tu Public Key real, entre comillas.
4. Sube ese cambio a GitHub como cualquier otro (ver la sección de arriba "Cómo subirlo a GitHub").

Mientras no hagas esto, la app sigue funcionando exactamente igual que ahora (el botón "Pagar con Mercado Pago" de siempre cobra normal) — simplemente no aparece la opción de guardar ni de pagar con una tarjeta guardada, en ninguna pantalla, sin ningún error para nadie.

Si alguien intenta guardar una tarjeta y Mercado Pago la rechaza (CVV mal escrito, fecha de vencimiento incorrecta, tarjeta deshabilitada para compras por internet, etc.), la app le muestra el motivo en español — no hace falta que tú intervengas, solo si el mensaje no es claro para esa persona.

## Activar el envío automático del correo de "Ayuda" (EmailJS)

En Perfil → Ayuda, la persona puede escribir un mensaje. Ahora mismo (sin configurar nada) la app usa un respaldo manual: abre la app de correo del teléfono con el mensaje ya redactado a `zano.ayuda@gmail.com`, y además copia el mensaje al portapapeles por si esa app no abre sola. Funciona, pero le pide a la persona que confirme el envío ella misma.

Si prefieres que el mensaje se mande solo, sin que nadie tenga que hacer nada más, puedes activar **EmailJS** — un servicio gratuito (200 correos al mes, sin pedir tarjeta) hecho justo para mandar correos desde una página sin tener servidor propio.

1. Entra a [emailjs.com](https://www.emailjs.com/) y crea una cuenta gratis.
2. En el panel, ve a **Email Services** → **Add New Service** y conecta el correo desde el que quieres que salgan los mensajes (lo más simple es conectar una cuenta de Gmail — puede ser la misma `zano.ayuda@gmail.com` u otra). Copia el **Service ID** que te asigna.
3. Ve a **Email Templates** → **Create New Template**. En el campo "To Email" del template pon `zano.ayuda@gmail.com`. En el cuerpo del correo usa estas variables (tal cual, con las llaves dobles) para que se llenen solas con los datos de la app:

```
De: {{from_name}} ({{from_email}})

Mensaje:
{{message}}
```

   Copia el **Template ID** que te asigna.
4. Ve a **Account** → **General** y copia tu **Public Key** (es pública, es seguro que quede visible en el código — nunca uses ahí una llave privada).
5. Abre `index.html` y busca estas tres líneas (cerca de `AYUDA_CORREO`, en el bloque de JavaScript principal):

```js
const EMAILJS_PUBLIC_KEY = 'TU_PUBLIC_KEY';
const EMAILJS_SERVICE_ID = 'TU_SERVICE_ID';
const EMAILJS_TEMPLATE_ID = 'TU_TEMPLATE_ID';
```

6. Cambia cada valor por el tuyo (Public Key, Service ID y Template ID), guarda, y sube el cambio a GitHub (o vuelve a arrastrar el archivo a Vercel/Netlify).

Desde ese momento, cada mensaje de Ayuda se manda solo a `zano.ayuda@gmail.com` en cuanto la persona le da "Enviar por correo" — ya no depende de que su teléfono tenga una app de correo configurada. Si algún mes se te acaban los 200 correos gratis del plan, o si la persona está sin internet en ese momento, la app cae automáticamente de vuelta al respaldo manual (abrir correo + copiar mensaje), así que el mensaje nunca se pierde.

## Cuentas guardadas y correos automáticos

Esto activa estos correos que salen solos, sin que nadie tenga que confirmar nada en su propia app de correo:

- **Verificación de correo** al crear una cuenta (le llega a la persona que se registró, con un código de 6 dígitos que tiene que escribir en la app — ver siguiente sección). Mientras no lo verifique, la cuenta sigue funcionando casi normal; solo no puede pagar su pedido hasta que lo haga.
- **Aviso a ti** (`zano.ayuda@gmail.com`) cada vez que alguien crea una cuenta.
- **Confirmación de pedido** en cuanto se completa un pago.
- **Recordatorios**: cada jueves, a quien todavía no tenga pagado su pedido de la semana siguiente; y a quien haya llegado a la pantalla de Pagar y la haya dejado a medias por más de 3 horas sin pagar.

### Verificación de correo al crear cuenta

No necesitas configurar nada nuevo para esto — reutiliza la misma plantilla de EmailJS para clientes que ya configuras en el paso siguiente (2. Nueva plantilla de EmailJS). Al crear una cuenta, la persona recibe un código de 6 dígitos (vence en 30 minutos) y lo escribe en una pantalla nueva, "Verifica tu correo". Las cuentas que ya existían ANTES de subir este cambio quedan marcadas como verificadas automáticamente — a nadie se le pide retroactivamente un código que nunca le llegó.

Para esto, las cuentas y los pedidos ya no viven solo en el navegador de cada quien — se guardan en una base de datos de verdad. Esto necesita tres cosas: una base de datos, un despliegue en Vercel (no GitHub Pages), y completar tu cuenta de EmailJS con una plantilla más.

### 1. Base de datos

1. Entra a tu proyecto en [vercel.com](https://vercel.com/dashboard) → pestaña **Storage**.
2. Dale **Create Database** (o entra al **Marketplace** y busca "Postgres") y elige **Neon** (tiene plan gratis, de sobra para tu tamaño). Sigue el asistente y conéctala a tu proyecto de ZANO.
3. Esto agrega solo, automáticamente, una variable de entorno con la conexión a la base de datos (`DATABASE_URL` o `POSTGRES_URL`) — no tienes que copiar nada a mano.
4. Abre el **SQL Editor** de tu base de datos (Neon te lo da directo desde su panel, o desde la pestaña Storage en Vercel) y pega y corre TODO el contenido del archivo `schema.sql` que te mandé — una sola vez. Esto crea las tablas de usuarios y pedidos.

### 2. Nueva plantilla de EmailJS (para correos a clientes)

Ya tienes (o vas a tener, si seguiste la sección de arriba) una plantilla de EmailJS para "Ayuda", que manda correos siempre a `zano.ayuda@gmail.com`. Ese mismo servicio se reutiliza para avisarte de cosas nuevas. Pero los correos que van a cada cliente (bienvenida, confirmación, recordatorios) necesitan una plantilla aparte, porque el destino cambia según quién sea:

1. En emailjs.com, ve a **Email Templates** → **Create New Template**.
2. **To Email**: pon `{{to_email}}` (así el correo va a quien corresponda cada vez, no siempre al mismo).
3. **Subject**: pon `{{subject}}`.
4. **Content**, algo así:

```
Hola {{to_name}},

{{body}}

— Equipo ZANO
```

5. Guarda y copia el **Template ID** que te asigna — este es distinto al de "Ayuda".

### 3. Habilitar el envío desde servidor en EmailJS

Por seguridad, EmailJS trae desactivado que se manden correos desde un servidor (fuera del navegador) — hay que prenderlo:

1. En emailjs.com, ve a **Account** → **Security**.
2. Activa la opción de habilitar las llamadas a la API para aplicaciones que no son de navegador ("Enable API calls for non-browser applications" o similar).
3. Ahí mismo vas a ver (o generar) tu **Private Key**. A diferencia de la Public Key, **esta es secreta** — nunca la pongas en `index.html` ni la subas a GitHub. Solo va en Vercel (siguiente paso).

### 4. Variables de entorno en Vercel

En tu proyecto de Vercel → **Settings** → **Environment Variables**, agrega estas (la de la base de datos ya se agregó sola en el paso 1):

| Nombre | Valor |
|---|---|
| `JWT_SECRET` | Cualquier texto largo y aleatorio (ej. generado en [1password.com/password-generator](https://1password.com/password-generator/)) — es para firmar las sesiones. |
| `CRON_SECRET` | Otro texto largo y aleatorio distinto al anterior — protege el recordatorio automático para que solo Vercel pueda dispararlo. |
| `EMAILJS_SERVICE_ID` | El mismo Service ID que ya usas para Ayuda. |
| `EMAILJS_PUBLIC_KEY` | La misma Public Key que ya usas para Ayuda. |
| `EMAILJS_PRIVATE_KEY` | La Private Key del paso 3. |
| `EMAILJS_TEMPLATE_ID_AYUDA` | El Template ID de tu plantilla de "Ayuda" (el que ya tenías). |
| `EMAILJS_TEMPLATE_ID_CLIENTE` | El Template ID de la plantilla nueva del paso 2. |

Guarda y haz un **Redeploy** (Vercel te lo pide o lo puedes disparar desde la pestaña Deployments) para que el proyecto las tome en cuenta.

### 5. Desplegar en Vercel

Si tu proyecto de Vercel está conectado a tu repositorio de GitHub (como ya lo tienes configurado), simplemente sube todos los archivos nuevos al repo — `index.html`, `README.md`, la carpeta `api/` completa, `package.json`, `vercel.json` y `schema.sql` — y Vercel despliega solo. El `vercel.json` ya trae programado el recordatorio automático para correr **una vez al día**, a las 9:00 AM hora de Monterrey (Vercel revisa internamente si ese día es jueves o no).

Para confirmar que el recordatorio automático quedó bien configurado, en tu proyecto de Vercel ve a **Settings** → **Cron Jobs** — debe aparecer listado `/api/cron`. Desde ahí también lo puedes disparar manualmente para probarlo ("Run" o similar), sin esperar a que llegue la hora.

### Cómo se comporta si algo falta

Mientras no completes estos pasos, la app sigue funcionando en modo local como hasta ahora (cuentas solo en el navegador, sin correos automáticos de cuentas/pedidos) — no se rompe nada. Y aunque ya tengas todo conectado, si algún correo puntual falla (por ejemplo, se te acabaron los 200 correos gratis de EmailJS ese mes), la cuenta o el pedido se guardan igual en la base de datos — solo ese correo en particular no sale.

## Editar entrega de un pedido ya pagado

En Perfil → Pedidos próximos, cada día con un pedido ya pagado trae un botón **"Editar entrega"** que deja, sin cancelar ni volver a pagar:

- Cambiar el horario de recogida de ese día.
- Mover el platillo de ese día a otro día de la misma semana que todavía esté libre (si el día destino ya tiene otro platillo pedido, primero hay que quitarlo — por ahora eso se hace contactándote a ti directamente, la app no deja "intercambiar" dos días automáticamente).

Se bloquea solo (con un mensaje explicándolo) si cocina ya marcó ese día como "Empezar a preparar" o más adelante en el panel de cocina — así nadie mueve un pedido que ya se está cocinando sin que se enteren a tiempo. No necesita ninguna configuración nueva, ni en Vercel ni en `index.html`.

## Qué falta / qué revisar

- Los 7 platillos de "Bebidas, Snacks y Cheat Meals" (Yogurt Griego, Bowl de Frutas, Postres y Snacks, Jugo Verde, Jugo de Naranja, Vampiro, Toronja) siguen con precio `[PRECIO]` — en cuanto me mandes su costeo los lleno.
- **Aguacate**: quedó en $10.66 (el valor del costeo más reciente y completo del Poke, con 130g). Tu instrucción anterior había sido $12.30 — avísame si ese era un margen intencional o si nos quedamos con el $10.66 del costeo.
- **Tarjetas guardadas (opcional)**: nuevo — para que la app deje guardar tarjetas, falta que pongas tu Public Key de Mercado Pago en `index.html` (`MERCADOPAGO_PUBLIC_KEY`) — ver la sección "Tarjetas guardadas (opcional)" más arriba. Mientras no la pongas, todo sigue funcionando normal, solo sin esa opción extra.

Cualquier ajuste de precios, macros o pantallas, mándamelo y actualizo el archivo.
