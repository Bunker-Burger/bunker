# Búnker Burger

Carta, carrito y checkout para Búnker Burger, Aguilares (Tucumán). La operación diaria se confirma por WhatsApp; Mercado Pago Checkout Pro es opcional.

## Desarrollo

1. Instalar Node.js 22 (`.nvmrc`).
2. Copiar `.env.example` a `.env.local` y completar las claves disponibles.
3. Ejecutar `npm ci`.
4. Enlazar la CLI con el proyecto Supabase cloud de desarrollo mediante `npx supabase link --project-ref <ref>`.
5. Revisar migraciones con `npm run db:push:dry` y aplicarlas con `npm run db:push`.
6. Ejecutar `npm run dev`.

Mercado Pago se oculta automáticamente si falta cualquiera de sus variables requeridas. Las claves secretas nunca llevan prefijo `NEXT_PUBLIC_`.

## Scripts

| Script | Uso |
| --- | --- |
| `npm run dev` | Servidor de desarrollo (Turbopack, service worker desactivado). |
| `npm run build` / `npm start` | Build de producción (webpack, genera `public/sw.js`) y servidor. |
| `npm run lint` | ESLint sin warnings permitidos. |
| `npm run typecheck` | `tsc --noEmit` en modo estricto. |
| `npm test` / `npm run test:watch` | Pruebas unitarias con Vitest. |
| `npm run test:e2e` | Playwright (mobile + desktop, Chromium) contra el build de producción; correr `npm run build` antes. |
| `npm run db:push:dry` / `db:push` / `db:test` | Migraciones y pgTAP contra Supabase cloud de desarrollo. |

Antes de abrir un PR: `npm run lint`, `npm run typecheck`, `npm test` y las pruebas específicas de la tarea. CI corre además build, Playwright y, cuando está configurado `SUPABASE_DEV_DB_URL`, las migraciones y pgTAP contra el proyecto cloud de desarrollo.

## UI

Tailwind CSS 4.3 se carga desde `src/app/globals.css`, que es la única fuente de tokens (colores, tipografía, radios, sombras, `tap` de 44 px y ancho `content` de 1280 px). La paleta por defecto de Tailwind está deshabilitada: usar solo utilidades de tokens (`bg-surface`, `text-primary`, `text-headline-md`, `rounded-lg`, `min-h-tap`…) o `var(--color-*)` en CSS. Oswald (títulos y precios) y Space Grotesk (cuerpo y controles) se cargan con `next/font`.

- Primitives en `src/components/ui`: Button, Card, Badge, Dialog, Drawer, Tabs, Input, Textarea, Select, Switch, Label, Skeleton, EmptyState/ErrorState y Toaster (`toast` de sonner).
- Shell en `src/components/shell`: `AppShell`, `SiteHeader`, `Container` y la única `BottomNav`, que respeta safe areas y se oculta mientras el teclado virtual está abierto.
- `/design-system` muestra todos los primitives y estados; se sirve en local y previews, nunca en producción (`VERCEL_ENV=production`). Playwright la audita con axe (WCAG 2.1 AA), teclado y targets de 44 px.
- shadcn/ui está configurado en `components.json`. Al agregar componentes con `npx shadcn@latest add <componente>`, adaptarlos a los tokens; si se suman tokens nuevos, registrarlos también en `src/lib/utils.ts` para que `cn` los combine bien.

## Excepciones de versiones

Todas las dependencias directas están fijadas a versiones exactas y el lockfile está versionado.

- **TypeScript 6.0.3** en lugar de 7.x: `typescript-eslint` (usado por `eslint-config-next`) solo soporta `>=4.8.4 <6.1.0` y aborta con TS 7. Volver a `latest` cuando typescript-eslint publique soporte (ver typescript-eslint/typescript-eslint#10940).
- **Build con webpack** (`next build --webpack`): `@serwist/next` todavía no soporta Turbopack. El desarrollo sigue usando Turbopack con el service worker desactivado.
