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

## Cobro dentro de la app (PayPal) + Apple Pay

La pantalla de Pagar cobra de verdad con PayPal — no es una simulación. Ya usa tu Client ID de **Live** (cuenta real de negocio de ZANO), así que cualquier pago que se confirme en la app es dinero real, que llega a tu cuenta de PayPal Business.

Desde la versión más reciente, pagar **ya no abre ninguna ventanita/pestaña de PayPal encima de la app** (eso era lo que a veces se quedaba atorado al cancelar, sobre todo con la app agregada a la pantalla de inicio). Ahora, al tocar "Pagar con PayPal o tarjeta", el propio servidor (`api/paypal.js`) crea la orden en PayPal y la app manda a la persona derechito a la página segura de PayPal — una navegación normal, como abrir cualquier enlace, no una ventana nueva. En cuanto la persona termina de pagar (o cancela), PayPal la regresa sola a la app, que confirma el cobro automáticamente. Esto necesita el backend (carpeta `api/`, ver más abajo la sección "Cuentas guardadas y correos automáticos") — sin él, la app sigue funcionando en modo local pero sin poder cobrar de verdad.

### 1. El "Secret" de PayPal (nuevo — solo para el servidor)

Antes solo se usaba el Client ID (público, va en `index.html`). Ahora, para que el servidor pueda hablar con PayPal en tu nombre, también hace falta el **Secret** de esa misma app — este es privado, NUNCA va en `index.html` ni se sube a GitHub, solo se agrega como variable de entorno en Vercel.

1. Entra a [developer.paypal.com](https://developer.paypal.com) e inicia sesión con tu cuenta de PayPal Business.
2. Ve a **Apps & Credentials**, asegúrate de estar en modo **Live** (no Sandbox, arriba a la derecha).
3. Verás la lista de tus apps — dale clic al nombre de la app que ya usaste para conseguir el Client ID (la que está en `index.html`).
4. En esa pantalla verás **Client ID** (el mismo que ya tienes) y, debajo, **Secret**, con un botón que dice **Show** (mostrarlo). Dale clic y cópialo (es una cadena larga de letras y números, parecida al Client ID pero distinta).
5. En [vercel.com/dashboard](https://vercel.com/dashboard), entra a tu proyecto de ZANO → **Settings** → **Environment Variables**.
6. Agrega una variable nueva: nombre `PAYPAL_SECRET`, valor lo que copiaste en el paso 4. Guarda.
7. Ve a la pestaña **Deployments** y dale **Redeploy** al último despliegue (o simplemente sube cualquier archivo nuevo a GitHub — cualquiera de los dos hace que Vercel tome en cuenta la variable nueva).

Si un platillo todavía tiene precio pendiente (`[PRECIO]`), la app no deja pagar esa semana hasta que se le asigne un precio real — para evitar cobrar de más o de menos por error.

### 2. Apple Pay (opcional)

Apple Pay aparece como un botón aparte, solo en iPhone/iPad/Mac con Safari, y solo si tu cuenta de PayPal ya lo tiene habilitado y tu dominio verificado. Si no completas estos pasos (o algo no aplica para tu cuenta), sencillamente ese botón nunca aparece — el botón normal de "Pagar con PayPal o tarjeta" sigue funcionando siempre, sin ningún problema.

1. Entra a tu cuenta de PayPal Business normal (paypal.com, no developer.paypal.com) → **Configuración de la cuenta** → busca la sección de **Apple Pay** (a veces está dentro de "Preferencias del sitio web" o "Mis productos y servicios", el nombre exacto varía). Confírmame que ya la ves activada ahí (me dijiste que sí).
2. Ahí mismo debe haber una opción para **verificar un dominio** para Apple Pay — te va a pedir el dominio de tu app (por ejemplo `zano-five.vercel.app`, o el dominio propio si ya tienes uno) y te va a dar un archivo para descargar, algo así: `apple-developer-merchantid-domain-association`.
3. Ese archivo hay que subirlo a GitHub en una carpeta nueva llamada exactamente `.well-known` (con el punto al inicio), con ese mismo nombre de archivo, SIN ninguna extensión. Para crearlo con la misma técnica que ya usaste para la carpeta `images/`:
   - En GitHub, dentro de tu repositorio, **Add file → Create new file**.
   - En el cuadro de nombre, escribe exactamente: `.well-known/apple-developer-merchantid-domain-association`
   - Abre el archivo que descargaste de PayPal con el Bloc de notas (o TextEdit en Mac) y copia TODO su contenido dentro del cuadro grande de GitHub.
   - Dale **Commit changes**.
4. Espera a que Vercel termine de desplegar ese cambio (1-2 minutos), y ya debería quedar verificado del lado de PayPal (a veces hay que regresar a esa misma pantalla de PayPal y darle "Verificar" otra vez).

Si en algún momento el botón de Apple Pay no aparece o no funciona, la app no se rompe — solo revisamos estos pasos juntos con una captura de pantalla de lo que veas.

## Activar el envío automático del correo de "Ayuda" (EmailJS)

En Perfil → Ayuda, la persona puede escribir un mensaje. Ahora mismo (sin configurar nada) la app usa un respaldo manual: abre la app de correo del teléfono con el mensaje ya redactado a `zano.ayuda@gmail.com`, y además copia el mensaje al portapapeles por si esa app no abre sola. Funciona, pero le pide a la persona que confirme el envío ella misma.

Si prefieres que el mensaje se mande solo, sin que nadie tenga que hacer nada más, puedes activar **EmailJS** — un servicio gratuito (200 correos al mes, sin pedir tarjeta) hecho justo para mandar correos desde una página sin tener servidor propio, igual que hicimos con PayPal para los cobros.

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

Esto activa cuatro correos que salen solos, sin que nadie tenga que confirmar nada en su propia app de correo:

- **Bienvenida** al crear una cuenta (le llega a la persona que se registró).
- **Aviso a ti** (`zano.ayuda@gmail.com`) cada vez que alguien crea una cuenta.
- **Confirmación de pedido** en cuanto se completa un pago.
- **Recordatorios**: cada jueves, a quien todavía no tenga pagado su pedido de la semana siguiente; y a quien haya llegado a la pantalla de Pagar y la haya dejado a medias por más de 3 horas sin pagar.

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

## Qué falta / qué revisar

- Los 7 platillos de "Bebidas y postres" (Yogurt Griego, Bowl de Frutas, Postres y Snacks, Jugo Verde, Jugo de Naranja, Vampiro, Toronja) siguen con precio `[PRECIO]` — en cuanto me mandes su costeo los lleno.
- **Aguacate**: quedó en $10.66 (el valor del costeo más reciente y completo del Poke, con 130g). Tu instrucción anterior había sido $12.30 — avísame si ese era un margen intencional o si nos quedamos con el $10.66 del costeo.
- **Cobro dentro de la app + Apple Pay**: el código ya está listo, pero falta que agregues `PAYPAL_SECRET` en Vercel (y, si quieres Apple Pay, verificar el dominio) — ver la sección de arriba "Cobro dentro de la app (PayPal) + Apple Pay".

Cualquier ajuste de precios, macros o pantallas, mándamelo y actualizo el archivo.
