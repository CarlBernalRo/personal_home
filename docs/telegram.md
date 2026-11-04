# Avisos y comandos por Telegram

Guía para **volver a montar** la integración desde cero (o rotar sus claves) y para **diagnosticar** cuando algo falla.
No contiene ningún token ni secreto: esos se generan y guardan tú mismo (ver "Secretos").

---

## 1. Cómo está armado

```
Usuario ──/start CÓDIGO, /saldo…──▶ Telegram ──webhook──▶ Cloudflare Worker ──▶ Firestore
                                                              │  (vincula chats, responde comandos)
                                                              ▼
Firestore (notifications) ◀── la app guarda avisos ──  GitHub Actions (cada hora)
                                  │                          │
                                  └────── send-telegram.ts ──┘──▶ Telegram ──▶ chat del usuario
```

| Pieza | Dónde vive | Qué hace |
|---|---|---|
| **App** (Perfil → Avisos) | Firebase Hosting | Genera un código de un solo uso (5 min) y muestra el estado de la vinculación. Guarda `telegramChatId`, `telegramZones` en `users/{uid}`. |
| **Worker** | Cloudflare (`workers/telegram-webhook/`) | Recibe cada mensaje del bot al instante. Vincula (`/start CÓDIGO`), desvincula (`/stop`) y responde los comandos de consulta. |
| **Task de avisos** | GitHub Actions (`.github/workflows/telegram-avisos.yml`, `scripts/ci/send-telegram.ts`) | Cada hora envía a Telegram las notificaciones que aún no se han enviado. |
| **Bot** | Telegram (BotFather) | El usuario del bot es el que usa la app en `VITE_TELEGRAM_BOT`. |

Lo que **no** se hace aquí: la task **ya no vincula chats** (eso es del Worker) y el Worker **no envía avisos** (eso es de la task).

### Comandos del bot (solo lectura, solo chats vinculados)

`/saldo` · `/proximos` · `/debo` · `/medeben` · `/resumen` · `/ayuda` — usan el mismo código compartido de la app (`apps/web/src/shared`), así que los números coinciden con la pantalla. La lista está en `workers/telegram-webhook/src/commands.ts` (`COMMANDS`).

### Cómo se decide qué aviso se envía

Cada documento de `notifications` puede llevar `telegramStatus`:

- sin valor → **pendiente** (se envía en la próxima ejecución),
- `sent` → enviado (también `telegramSent: true`),
- `skipped` → omitido a propósito: descartado en la app, de una zona apagada o de hace más de 7 días.

Ejecutar la task varias veces **no repite** mensajes.

### Reglas del código de vinculación

- Dura **5 minutos** y sirve **una sola vez** (se borra al vincular).
- Se valida contra la hora en que se **envió** el mensaje, no cuando se procesa.
- Se rechaza si más de un perfil lo tiene (nunca se cruza entre usuarios).
- 16 caracteres aleatorios (~80 bits).

---

## 2. Montaje desde cero

### 2.1 Crear el bot

1. En Telegram, abre **@BotFather** → `/newbot`.
2. Elige un nombre visible (puede llevar espacios) y un **usuario** que termine en `bot` (sin guiones; ej. `Casita_Felix_bot`).
3. Copia el **token** que te da. Trátalo como una contraseña: no lo pegues en chats, issues ni commits.

### 2.2 Variable de la app

En `apps/web/.env.local` (no se sube al repo):

```
VITE_TELEGRAM_BOT=Casita_Felix_bot
```

Es el usuario del bot **sin** `@`. Sin esta variable, la pestaña Avisos dice "Falta configurar el bot". El valor se compila dentro de la app: hay que **volver a desplegar** para que cambie en producción.

### 2.3 Secreto en GitHub (para la task de avisos)

GitHub → repo → Settings → Secrets and variables → Actions:

- `TELEGRAM_BOT_TOKEN` = el token del bot.
- `FIREBASE_SERVICE_ACCOUNT` = el JSON de una cuenta de servicio de Firebase (ya existe por la task de débitos automáticos).

El workflow solo corre por cron desde la rama **`main`**.

### 2.4 Cuenta de servicio para el Worker

Recomendado: una cuenta **solo para esto**, con permisos mínimos.

1. https://console.cloud.google.com/iam-admin/serviceaccounts (proyecto `personalhome-3ee06`) → **Crear cuenta de servicio**, p. ej. `telegram-worker`.
2. Rol: **Usuario de Cloud Datastore** (lo único que necesita).
3. En esa cuenta: **Claves → Agregar clave → Crear clave nueva → JSON**. Se descarga un archivo.
4. Guárdalo fuera del repo. Bórralo del equipo cuando termines el paso 2.6.

### 2.5 Cuenta de Cloudflare y primer despliegue

1. Crea una cuenta gratis en https://dash.cloudflare.com/sign-up (sin tarjeta).
2. Entra una vez a **Workers & Pages**: Cloudflare crea tu subdominio `…workers.dev` (se ve en el panel derecho, "Subdomain"). Si el deploy pide registrarlo, hazlo desde el enlace que muestra el error.
3. En PowerShell, dentro de `workers\telegram-webhook`:

```powershell
npx wrangler login      # abre el navegador para autorizar
npx wrangler deploy     # imprime la URL: https://gastos-hogar-telegram.TUSUBDOMINIO.workers.dev
```

Si `npx` falla con `cb.apply is not a function`, repite el comando (la segunda vez suele funcionar) o instala con `npm install -g wrangler` y usa `wrangler …` sin `npx`.

### 2.6 Secretos del Worker

Genera el secreto del webhook (una clave inventada, larga):

```powershell
node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"
```

Guárdalo en un lugar seguro y úsalo en los dos sitios (Worker y `setWebhook`). Luego, en `workers\telegram-webhook`:

```powershell
npx wrangler secret put WEBHOOK_SECRET
npx wrangler secret put TELEGRAM_BOT_TOKEN
Get-Content "C:\ruta\a\cuenta-de-servicio.json" -Raw | npx wrangler secret put FIREBASE_SERVICE_ACCOUNT
```

Cada `put` pide pegar el valor. Los secretos **se conservan** al volver a ejecutar `wrangler deploy`.

### 2.7 Conectar Telegram con el Worker (`setWebhook`)

**Después** de guardar los secretos (si no, el Worker rechaza a Telegram con 403):

```powershell
curl.exe -X POST "https://api.telegram.org/botTU_TOKEN/setWebhook" -d "url=https://gastos-hogar-telegram.TUSUBDOMINIO.workers.dev" -d "secret_token=TU_WEBHOOK_SECRET"
```

Debe responder `{"ok":true,"result":true,"description":"Webhook was set"}`.

Comprobar: abre `https://api.telegram.org/botTU_TOKEN/getWebhookInfo` → `url` debe ser la del Worker y **no** debe haber `last_error_message`.

### 2.8 Publicar el menú de comandos

```powershell
curl.exe -X POST "https://gastos-hogar-telegram.TUSUBDOMINIO.workers.dev/setup" -H "X-Telegram-Bot-Api-Secret-Token: TU_WEBHOOK_SECRET"
```

Responde `{"ok":true,"cleared":…,"set":…}`. Limpia las listas de comandos de todos los ámbitos/idiomas y fija la nuestra. Cierra y abre el chat (o reinicia Telegram) para ver el menú al escribir `/`.

### 2.9 Desplegar la app

```powershell
cd apps\web
npx vite build
cd ..\..
npx firebase-tools deploy --only hosting --project personalhome-3ee06
```

(Si cambian los índices de Firestore: `--only hosting,firestore`.)

### 2.10 Prueba de punta a punta

1. App → **Perfil → Avisos → Vincular Telegram**. Debe aparecer el spinner con la cuenta regresiva de 5:00.
2. Abre el bot con el botón y toca **Iniciar**. Si no se abre nada (computador sin Telegram instalado), escribe `/start TU_CÓDIGO` a mano en el chat del bot desde el celular o web.telegram.org.
3. El bot responde "✅ Telegram vinculado" **al instante** y la pantalla cambia sola.
4. Escribe `/saldo`: debe contestar tus cuentas.
5. Avisos: GitHub → Actions → **Avisos por Telegram** → *Run workflow*, con **"apply" marcado**. Sin "apply" solo simula. El log muestra `Bot del token: @…` y cuántos avisos envió (`0` si no hay notificaciones nuevas sin enviar).

---

## 3. Rotar claves

### Token del bot (también si se filtró)

1. BotFather → `/revoke` → elige el bot → copia el token nuevo.
2. GitHub: actualiza el secreto `TELEGRAM_BOT_TOKEN`.
3. Worker: `npx wrangler secret put TELEGRAM_BOT_TOKEN`.
4. Vuelve a ejecutar `setWebhook` (2.7) con el token nuevo.
5. Vuelve a publicar el menú (2.8).

El vínculo de los usuarios sigue vigente: vive en Firestore, no depende del token.

### Secreto del webhook

1. Genera uno nuevo (2.6).
2. `npx wrangler secret put WEBHOOK_SECRET` **primero**.
3. `setWebhook` (2.7) con el secreto nuevo **después**. Si Telegram usa el nuevo y el Worker aún tiene el viejo, todo da 403.

---

## 4. Diagnóstico

| Síntoma | Causa probable | Qué hacer |
|---|---|---|
| El bot no responde a nada | El webhook no está puesto | Abre `getWebhookInfo`: si `url` está vacío, repite `setWebhook` (2.7). |
| `url` vuelve a quedar vacío solo | **Otro programa usa el mismo token** con sondeo (`getUpdates`) y borra el webhook al arrancar. Suele delatarse porque el bot contesta en inglés ("Unknown command") | **Rota el token** (sección 3). Es la forma segura de dejar fuera a cualquier otro consumidor. |
| `getWebhookInfo` muestra `last_error_message` | Telegram llega al Worker pero este falla o responde ≠ 200 | `npx wrangler tail`, escribe al bot y lee el error. Si es 403: el `WEBHOOK_SECRET` del Worker no coincide con el del `setWebhook`. |
| `wrangler tail` no muestra nada | Telegram no está entregando mensajes | Mira `getWebhookInfo`. Verifica que estés en la carpeta `workers\telegram-webhook`. |
| El menú "/" muestra comandos que no son nuestros | Hay listas en otro ámbito o idioma, o caché del cliente | Ejecuta `/setup` (2.8), cierra y abre el chat. |
| "El código no es válido o ya venció" | Pasaron más de 5 min, o ya se usó | En la app, **Generar código nuevo**. |
| Pantalla de la app no cambia a "vinculado" | El Worker no se enteró del `/start` | Revisa el diagnóstico de arriba; mira Firestore: `users/{uid}.telegramChatId` debe existir. |
| La task de GitHub falla en `getMe` | El token de GitHub es viejo o de otro bot | Actualiza `TELEGRAM_BOT_TOKEN` en los secretos. |
| La task dice `0 enviados` | No hay notificaciones nuevas sin enviar | Es normal. Hace falta una notificación nueva de otra persona o una alerta nueva. |
| Un aviso no llega | Descartado, zona apagada o de hace más de 7 días (queda `skipped`) | Revisa las zonas en Perfil → Avisos. |
| Los avisos tardan | La task corre cada hora (`17 * * * *`) y GitHub puede retrasar los cron | Es una limitación conocida; ver "Límites". |
| `git push` o el build suben datos personales | La página `/seed` solo existe en desarrollo (`import.meta.env.DEV`) | Antes de desplegar, verifica que el bundle no contenga datos de `seed-data.ts`. |

Útil: `npx wrangler tail` (en `workers\telegram-webhook`) muestra en vivo lo que recibe el Worker.

---

## 5. Límites y notas

- Los **avisos** salen cada hora (cron de GitHub, no es exacto). La **vinculación y los comandos** son instantáneos (Worker).
- Los avisos calculados de los datos de alguien ("vence mañana") solo llegan a Telegram si esa persona abrió la app ese día, porque es la app quien los guarda.
- Cloudflare Workers (plan gratis): 100.000 peticiones al día. Sobra para este uso.
- Solo funcionan chats **privados** con el bot. El Worker ignora los grupos.
- `/stop` en el bot o **Desvincular** en la app borran el `telegramChatId`.
- Si alguien bloquea el bot, la task detecta el error 403 y desvincula el chat sola.

## 6. Archivos

- `workers/telegram-webhook/src/index.ts` — webhook: vincular, `/stop`, comandos, capturas, botones, `/setup`.
- `workers/telegram-webhook/src/flow.ts` — conversación paso a paso para registrar desde una captura.
- `workers/telegram-webhook/src/vision.ts` — lectura de la captura con Workers AI; `try-vision.ts` la prueba con una imagen local.
- `workers/telegram-webhook/src/telegram.ts`, `db.ts` — clientes de Telegram y de Firestore.
- `apps/web/src/pages/PendingMovementsPage.tsx`, `components/pending/PendingMovementsPrompt.tsx`, `hooks/usePendingMovements.ts` — confirmación en la app.
- `workers/telegram-webhook/src/commands.ts` — comandos de consulta.
- `workers/telegram-webhook/src/db.ts` — cliente REST de Firestore.
- `workers/telegram-webhook/wrangler.toml` — nombre del Worker.
- `scripts/ci/send-telegram.ts` — task de avisos.
- `.github/workflows/telegram-avisos.yml` — cron horario.
- `apps/web/src/components/profile/TelegramForm.tsx` — pantalla Perfil → Avisos.

## 7. Registrar movimientos desde una captura

El usuario envía al bot una captura (foto o imagen) de un pago o ingreso. El bot la lee con **Workers AI** (gratis, dentro de tu cuenta de Cloudflare), **ofrece** lo que vio (valor, fecha, concepto) y pide, paso a paso, lo necesario. **No registra nada**: al final deja un movimiento *pendiente* y el usuario lo confirma dentro de la app.

### Flujo en el chat

1. **Valor** → "Leí $X, ¿es correcto?" (Sí / Escribir otro).
2. **Fecha** → igual (además Hoy / Ayer).
3. **Tipo** → Ingreso · Gasto fijo · Gasto ocasional (siempre lo elige la persona; la captura solo da una pista).
4. Según el tipo:
   - *Ingreso*: concepto → cuenta.
   - *Gasto fijo*: cuál gasto fijo y de qué mes (lista de los pendientes más cercanos a la fecha) → cuenta.
   - *Gasto ocasional*: cuál presupuesto, o "Otro gasto" (concepto y categoría) → cuenta.
5. **Comentario** (opcional) → **Confirmar** → "Enviar a la app".

Cada paso tiene **⬅️ Atrás** y **❌ Cancelar**; `/cancelar` también sirve. El estado de la conversación se guarda en `telegramFlows/{chatId}` (vence a las 24 h); los botones de mensajes viejos no hacen nada.

### En la app

- Al iniciar sesión, si hay pendientes, sale una **modal** con cuántos ingresos, gastos fijos y gastos adicionales esperan (una vez por sesión).
- La pantalla **`/pendientes`** (ítem *Pendientes por confirmar* en la barra lateral; en el celular, el ícono de bandeja junto a la campana) usa el mismo diseño de dos paneles que Notificaciones: a la izquierda el filtro por tipo con contadores y **Confirmar todos**; a la derecha los movimientos agrupados por Hoy / Esta semana / Antes. En cada uno se puede cambiar la cuenta, ver el comprobante, **Confirmar y registrar** (crea el ingreso, el pago del fijo o el gasto y mueve el saldo, en una sola escritura) o **Descartar**.
- También aparece una alerta en Notificaciones ("Tienes N movimientos de Telegram por confirmar").
- Un gasto fijo que ya se pagó en la app mientras tanto **se rechaza** al confirmar (hay que descartarlo).

### Datos

| Colección | Qué guarda | Quién escribe |
|---|---|---|
| `pendingMovements` | `kind` (`income`/`fixed`/`occasional`), `amount`, `date`, `concept`, `category`, `fixedExpenseId`+`occMonth`, `budgetId`, `accountId`, `comment`, `status` (`pending`/`confirmed`/`discarded`), `read` (lo que dijo la captura) | El Worker crea; el dueño confirma o descarta (reglas en `firestore.rules`) |
| `telegramFlows` | Estado de la conversación en curso | Solo el Worker (sin acceso desde la app) |
| `attachments` | Copia pequeña de la captura (`mime`, `size`, `data` en base64, `userId`) | El Worker crea; el dueño la lee o la borra |

### La captura guardada (comprobante)

- Para **leer** se usa la copia más nítida; para **guardar** se toma la mayor copia de hasta ~900 px y ~350 KB que Telegram ya entrega comprimida (una captura típica queda en 50–120 KB), así que no se convierte nada en el Worker.
- Una imagen enviada como **archivo** (sin comprimir) solo se guarda si pesa ≤ 400 KB; si no, el bot avisa que se envíe como foto.
- Se guarda en Firestore (`attachments/{id}`, tope 600 KB por documento): no usa Cloud Storage, que exige el plan Blaze.
- Sigue al movimiento: al **confirmar** se copia `attachmentId` al ingreso, pago fijo o gasto creado (se ve con **Ver comprobante** en `/pendientes` y en el detalle de un pago fijo). Al **descartar**, al cancelar el flujo o al vencer (24 h) se borra.
- No se borra al eliminar después el registro confirmado (queda huérfana, pesa poco).

### La lectura de la imagen (Cloudflare Workers AI)

El bot lee la captura con un modelo de visión de **Workers AI** (`@cf/meta/llama-4-scout-17b-16e-instruct`) que corre **dentro de tu cuenta de Cloudflare**: es gratis (cupo diario de 10.000 "neurons", que alcanza para cientos de capturas), no necesita ninguna clave y **la imagen no se envía a ninguna otra empresa**. Responde en unos 2 segundos.

Lee con menos precisión que los modelos de pago, pero el flujo nunca asume: cada dato se confirma o se corrige en el chat. Si no hay lectura (por ejemplo, se acabó el cupo o falló), el bot **sigue funcionando y pregunta todo a mano**.

> Se probó primero con Claude (de pago) y con Gemini (su capa gratuita exige no enviar datos sensibles y, para cuentas nuevas, pide créditos prepagados). Workers AI fue la opción que cumple: gratis, privada y sin claves.

### Configuración (una sola vez)

1. **No hay que crear ninguna clave.** El Worker ya declara el servicio en `workers/telegram-webhook/wrangler.toml`:
   ```toml
   [ai]
   binding = "AI"
   ```
2. **Probar antes de desplegar** con una captura tuya (usa la sesión de `wrangler login`, sin pegar nada):
   ```powershell
   cd apps\web
   npx vite-node ..\..\workers\telegram-webhook\try-vision.ts "C:\ruta\captura.png"
   ```
   Imprime el valor, la fecha y el concepto leídos. Una captura que no sea un comprobante sale con `is_payment_proof: false`.
3. Opcional: cambiar el modelo con la variable `VISION_MODEL` en `wrangler.toml` (por ejemplo `@cf/mistralai/mistral-small-3.1-24b-instruct`, que también leyó bien en las pruebas):
   ```toml
   [vars]
   VISION_MODEL = "@cf/mistralai/mistral-small-3.1-24b-instruct"
   ```
4. Redesplegar el Worker y volver a publicar el menú (aparece `/cancelar`):
   ```powershell
   cd workers\telegram-webhook
   npx wrangler deploy
   curl.exe -X POST "https://gastos-hogar-telegram.TUSUBDOMINIO.workers.dev/setup" -H "X-Telegram-Bot-Api-Secret-Token: TU_WEBHOOK_SECRET"
   ```
5. Desplegar las reglas de Firestore y la app:
   ```powershell
   npx firebase-tools deploy --only hosting,firestore:rules --project personalhome-3ee06
   ```

### Diagnóstico de esta función

| Síntoma | Causa probable | Qué hacer |
|---|---|---|
| El bot nunca "lee" nada y siempre pregunta todo | El Worker no tiene el servicio `AI` (falta `[ai]` en `wrangler.toml` o no se redesplegó) | Revisar `wrangler.toml` y ejecutar `npx wrangler deploy`. |
| "No pude leer la captura" | Workers AI falló (cupo diario agotado — se renueva a las 00:00 UTC —, modelo retirado, imagen no legible) | `npx wrangler tail` mientras envías la captura para ver el error. Para probar fuera del bot: `try-vision.ts`. |
| Lee mal el valor o la fecha | La captura es poco clara | Se corrige en el paso (Escribir otro); si es frecuente, prueba `VISION_MODEL` con un modelo más capaz. |
| "Este registro ya no está activo" | Se tocó un botón de un mensaje antiguo, o pasaron 24 h | Enviar la captura otra vez. |
| La app no muestra la modal | Ya salió en esta sesión (una vez por sesión), o no hay pendientes | Cerrar sesión y volver a entrar, o abrir `/pendientes`. |
| Error al confirmar un gasto fijo | Ya estaba pagado en la app | Descartar el pendiente. |
| "No guardé la imagen porque pesa mucho" | Se envió como archivo sin comprimir | Enviarla como foto (no como archivo). |
