# Gastos Hogar

App web para que una pareja administre sus finanzas: gastos personales, gastos compartidos del hogar (con división automática y cruce de deudas), cuentas y metas de ahorro. React + TypeScript + Firebase. Moneda: COP.

## Stack

- **Monorepo**: npm workspaces (`apps/*`, `packages/*`)
- **Frontend** (`apps/web`): React 18 + Vite + TypeScript + Tailwind CSS
- **Backend** (`apps/functions`): Firebase Cloud Functions (Node 20)
- **Datos/Auth**: Firebase Firestore + Google Auth
- **Hosting**: Firebase Hosting

## Estructura

```
apps/
  web/          # la app (Vite + React)
  functions/    # Cloud Functions (limpieza de deudas al borrar un gasto compartido, etc.)
packages/
  shared/       # paquete compartido (no es la fuente activa — ver nota abajo)
scripts/
  seed.mjs      # carga usuarios permitidos en Firestore (allowedUsers)
firestore.rules
firestore.indexes.json
firebase.json
```

> **Nota**: los tipos/constantes/utilidades que usa realmente la app viven en `apps/web/src/shared/`, no en `packages/shared/`. El paquete en `packages/` quedó desactualizado; no lo edites esperando que se refleje en la app.

## Requisitos

- Node 20+ (Cloud Functions está fijado a Node 20)
- Un proyecto de Firebase (Firestore + Auth con proveedor Google + Hosting habilitados)
- [Firebase CLI](https://firebase.google.com/docs/cli): `npm install -g firebase-tools`

## Setup inicial

1. **Instalar dependencias** (en la raíz y en cada app):
   ```bash
   npm install
   cd apps/web && npm install
   cd ../functions && npm install
   ```

2. **Crear el archivo de entorno** del frontend a partir del ejemplo:
   ```bash
   cp apps/web/.env.example apps/web/.env.local
   ```
   Completa las credenciales de tu proyecto de Firebase (Project Settings → General → "Tus apps" → SDK config):
   ```
   VITE_FIREBASE_API_KEY=
   VITE_FIREBASE_AUTH_DOMAIN=
   VITE_FIREBASE_PROJECT_ID=
   VITE_FIREBASE_STORAGE_BUCKET=
   VITE_FIREBASE_MESSAGING_SENDER_ID=
   VITE_FIREBASE_APP_ID=
   ```

3. **Whitelist de acceso**: el login está restringido — solo entran los correos listados en la colección `allowedUsers` de Firestore (nadie puede escribir esa colección desde el cliente, por regla de seguridad). Hay dos formas de cargarla:
   - **Firebase Console** (más simple): crea manualmente documentos en `allowedUsers` con `{ email, name, active: true }`.
   - **Script de seed**: copia `scripts/allowed-users.example.json` a `scripts/allowed-users.json` (está en `.gitignore`, no se sube) con los correos reales, y corre:
     ```bash
     node scripts/seed.mjs
     ```
     Este script escribe directo con el SDK de cliente, así que necesita que las reglas de Firestore permitan la escritura momentáneamente (o hazlo desde la Console, que es más directo).

4. **Vincular el proyecto de Firebase** (si vas a desplegar):
   ```bash
   firebase login
   firebase use --add   # selecciona tu proyecto, o edita .firebaserc a mano
   ```

## Desarrollo

Desde la raíz del repo:

```bash
npm run dev     # levanta Vite en apps/web (puerto 5173, o el siguiente libre)
npm run build   # build de producción del frontend
npm run test    # corre la suite de pruebas (vitest) de apps/web
npm run clean   # limpia dist/.turbo de apps/web
```

Cloud Functions (opcional, solo si vas a tocar `apps/functions`):
```bash
cd apps/functions
npm run build   # compila TypeScript a lib/
npm run dev     # compila en watch mode
```

## Desplegar

```bash
npm run build                               # build del frontend primero
firebase deploy --only hosting              # publica apps/web/dist
firebase deploy --only firestore:rules      # publica firestore.rules
firebase deploy --only firestore:indexes    # publica firestore.indexes.json
firebase deploy --only functions            # requiere plan Blaze (pago por uso) en el proyecto de Firebase
```

O todo junto: `firebase deploy`.

> Cloud Functions no se puede desplegar en el plan gratuito (Spark) de Firebase — hay que subir a Blaze desde la consola del proyecto primero. El resto (hosting, rules, indexes) funciona en el plan gratuito.

## Módulos de la app

1. **Login** — Google Auth, restringido por whitelist (`allowedUsers`)
2. **Dashboard** — resumen del mes, gráfica por categoría
3. **Gastos personales** — fijos y variables, categorías en español
4. **Hogar** — gastos compartidos entre los dos integrantes:
   - **Gasto compartido**: registra una compra y la divide automáticamente (partes iguales, porcentaje o monto fijo), con fecha límite opcional
   - **Cruzar deuda**: compensa lo que cada quien debe entre sí, contra una o varias deudas a la vez, sin mover dinero
   - **Abonar/Saldar**: pago directo contra una deuda puntual
   - Vista **Interactiva**: explorador tipo burbujas (hogar → integrante → historial) — actualmente en su diseño original, pendiente de unificar con el rediseño del resto de Hogar
5. **Cuentas** — saldos bancarios / efectivo
6. **Ahorros** — metas con barra de progreso

## Pruebas

La lógica de negocio pura (split de gastos, cruce de deudas, balance neto) tiene pruebas unitarias en `apps/web/src/shared/utils/*.test.ts` y `apps/web/src/lib/firestore.calcNetBalance.test.ts`. Córrelas con `npm run test` (desde la raíz o desde `apps/web`).
