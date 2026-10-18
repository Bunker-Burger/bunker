# Plan: reorganizar archivos y extraer componentes (sin cambiar comportamiento)

> Ejecutor previsto: Sonnet 5.5 (esfuerzo medio). Este documento es la única fuente: seguí las fases **en orden**, un commit por paso, y corré los gates de verificación al final de cada fase. Si algo del plan no coincide con el código (líneas corridas, símbolo renombrado), buscá el símbolo por nombre, no por número de línea.

## 0. Reglas que no se negocian

1. **Cero cambios de comportamiento.** Ni textos visibles, ni clases CSS, ni aria-labels, ni orden del DOM. Es mover código y extraer componentes con el mismo markup. Si un test de UI falla, el refactor está mal: no "arregles" el test cambiando la expectativa (salvo la ruta de un `import`).
2. **No tocar:** `supabase/migrations/**`, `src/server/supabase/database.types.ts` (generado), `.gitignore`, `next-env.d.ts`, `tests/e2e/**` (los E2E los mantiene agy; ver §8).
3. **Gates** (todos deben pasar al final de cada fase, y conviene correr `pnpm typecheck` después de cada paso):
   ```bash
   pnpm typecheck
   pnpm lint
   pnpm test
   ```
   Línea de base actual en `main`: 118 archivos de test, **todos verdes** (~1777 tests pasados, 13 skipped). Al terminar cada fase el número de tests pasados debe ser **≥** al de base (en la fase 3 se agregan tests).
4. **Un commit por paso numerado** (ej. `refactor(storefront): mover ProductDrawer a drawers/product-drawer.tsx`). Trailer de autoría como en el resto del repo.
5. **Usar `git mv`** para mover archivos (conserva historia). Para partir un archivo grande: crear el archivo nuevo con el código cortado tal cual y borrar ese bloque del original.
6. `tsconfig` tiene `exactOptionalPropertyTypes`: al extraer componentes, **no pases `prop={undefined}`** a props opcionales; usá spread condicional `{...(x ? { prop: x } : {})}` o declará el tipo como `prop?: T | undefined` (el repo ya usa las dos formas).
7. Todos los archivos de UI llevan `"use client";` en la primera línea si usan hooks/estado/eventos. Al partir `storefront.tsx` (que es `"use client"`), **cada archivo nuevo con JSX interactivo lleva `"use client";`**. Los `.ts` puros (helpers sin React) **no** lo llevan.
8. **Usá codegraph** (MCP `mcp__codegraph__*`; el índice está en `.codegraph/`, ignorado por git). Antes de arrancar cada fase corré `codegraph sync` (o `codegraph index` si dice que no hay nodos). Para cada símbolo que muevas: `codegraph_callers` / `codegraph_impact` para saber exactamente quién lo importa (reemplaza los `grep` de este plan; si el MCP dice "not initialized", pasale `projectPath` con la ruta absoluta del repo). Después de mover, `codegraph sync` y volvé a chequear que no queden callers apuntando a la ruta vieja.
9. Imports: dentro de `src/components/storefront/**` se usan rutas relativas (`./`, `../`); entre áreas, el alias `@/` (único alias: `@/*` → `src/*`).

## 1. Estado actual (relevado el 2026-10-16)

### 1.1 Archivos grandes

| Archivo | Líneas | Problema |
|---|---|---|
| `src/components/storefront/storefront.tsx` | 1771 | Contiene el contenedor + 2 drawers + opciones + carrito + checkout + helpers |
| `src/app/bunker/admin.module.css` | 3786 | Una sola hoja para todo el admin, 196 clases, ~33 sin uso |
| `src/app/bunker/admin/promociones/promotion-form.tsx` | 527 | Form + helpers puros + previewRows + constantes |
| `src/app/bunker/admin/dashboard.tsx` | 372 | 6 componentes en un archivo |
| `src/app/bunker/admin/catalogo/product-form.tsx` | 329 | Aceptable; solo mover |

Otros >400 (`rate-limit.ts`, `payment-repository.ts`, `catalog-admin-service.ts`, `supabase-catalog-admin-repository.ts`, `options.ts`, `cart.ts`, `acceptance-matrix.ts`) son de servidor/dominio y están **fuera de alcance** de este plan.

### 1.2 Mapa de `storefront.tsx` (símbolos top-level)

| Línea | Símbolo | Usado por |
|---|---|---|
| 72-75 | `INVALID_PRODUCT_NOTICE`, `PENDING_PRODUCT_NOTICE`, `UNVERIFIED_PRODUCT_NOTICE`, `DEFAULT_PAYMENT_METHODS` | Storefront (solo; `DEFAULT_PAYMENT_METHODS` en L155) |
| 77 | `VIEW_TITLES` | Storefront |
| 80 | `textKey()` | Storefront |
| 86 | `removeProductParam()` | Storefront |
| 93 | `CREDIT_WHATSAPP_URL` | footer dentro de Storefront |
| 95 | `export interface StorefrontProps` | Storefront |
| 118 | `FOCUSABLE` | trapFocus |
| 121 | `trapFocus(event, container)` | **solo ProductDrawer** (L1032) |
| 138 | `makeCartLine(...)` | Storefront (L326, L351), ComboDrawer (L743), ProductDrawer (L1145, L1147) |
| 152-651 | `export function Storefront` | `src/app/page.tsx`, 11 tests |
| 652 | `export interface ComboDrawerState` | ComboDrawer, comboDrawerState |
| 662 | `export function comboDrawerState` | Storefront |
| 696-841 | `export function ComboDrawer` | Storefront |
| 842 | `const unitsWithExtra` | unitGroupsOf, OptionGroups |
| 845 | `export function unitGroupsOf` | ComboDrawer (L729), ProductDrawer (L1049) |
| 863-995 | `function OptionGroups` | ComboDrawer, ProductDrawer |
| 996-1165 | `export function ProductDrawer` | Storefront, `storefront.test.tsx` (L9, 165, 226, 305) |
| 1166 | `function ViewBar` | CartSection, CheckoutSection |
| 1181 | `function chosenExtras` | **solo** CartSection (L1232) |
| 1189-1340 | `function CartSection` | Storefront |
| 1341 | `function toPromotionLines` | Storefront (L397), CheckoutSection (L1431) |
| 1355 | `function canonicalSelections` | **solo** CheckoutSection (L1466, L1533) |
| 1364 | `const CHECKOUT_ERRORS` | CheckoutSection |
| 1371-1759 | `function CheckoutSection` | Storefront |
| 1760 | `const PAYMENT_ICONS` | PaymentChoice |
| 1762 | `function PaymentChoice` | CheckoutSection |

> Validé esta tabla con `codegraph_callers` y grep el 2026-10-17. El relevamiento automático original tenía errores: decía que ComboDrawer usa `trapFocus` y que Storefront usa `unitGroupsOf`, y no es así.

**Importadores externos:** solo `Storefront` (`src/app/page.tsx` y 11 tests) y `ProductDrawer` (`storefront.test.tsx`). Nadie de afuera importa `ComboDrawer`, `comboDrawerState`, `unitGroupsOf`, `OptionGroups`, `CartSection`, `CheckoutSection`, `ViewBar` ni `PaymentChoice`.

> Antes de cada movimiento, confirmá quién usa el símbolo con `grep -rn "<símbolo>" src` (las líneas de arriba pueden haberse corrido).

### 1.3 Guard tests que condicionan el refactor

- `src/test/design-tokens.test.ts`: escanea todo `.css/.ts/.tsx` de `src` buscando colores literales, escalas de Tailwind, etc. Tiene una lista `ALLOWED` **por ruta de archivo** (`file: "components/storefront/storefront.css"` permite `mask-image: linear-gradient(#000 …)`). **Si movés o partís `storefront.css`, actualizá esa ruta** para el archivo que se quede con esa regla.
- `src/test/client-boundary.test.ts`: prohíbe que módulos de servidor importen constantes no-componente desde archivos `"use client"`. Si movés constantes que usa el servidor, ponelas en un `.ts` **sin** `"use client"`.
- `src/test/data-access-boundary.test.ts`: componentes/rutas no pueden importar Supabase directo. No aplica si solo movés UI.
- `src/ci/cloud-evidence-scope.test.ts:95` menciona la ruta literal `src/components/storefront/storefront.tsx`. **No renombres ni muevas `storefront.tsx`**: se queda con `Storefront`.
- `src/app/bunker/admin/page.test.tsx` y `catalogo/product-form.test.tsx` importan de `./catalogo/actions`, `./form-state` y `./product-form`: si se mueven, actualizá esos imports en el mismo commit.

## 2. Fase 1: limpieza de código muerto (bajo riesgo)

Cada ítem va con `grep -rn "<nombre>" src tests scripts` **antes** de borrar; si aparece algún uso fuera del archivo que lo define, **no lo borres** y anotalo en el PR.

1. **Acciones sin uso** (reemplazadas por `reorder*Action`):
   - `moveCategoryAction` y `moveProductAction` en `src/app/bunker/admin/catalogo/actions.ts`.
   - `movePromotionAction` en `src/app/bunker/admin/promociones/actions.ts`.
   - Borralas, junto con los imports que queden huérfanos (lint los marca).
2. **`tabFor`** en `src/app/bunker/admin/catalogo/form-state.ts:21`: sin uso. Ojo, **`tabForType` sí se usa** (`product-props.ts:4`); no la toques.
3. **`resolveOptionGroupApplicability`** en `src/domain/options.ts`: una sola aparición, su propia definición. Borrala (y su test, si existe uno que solo la cubra a ella).
4. **`getBrowserSupabaseClient`** y `src/lib/supabase/browser-client.ts`: sin importadores. **No borrar en este plan.** `data-access-boundary.test.ts:39` usa la ruta como fixture (string) y es infraestructura que puede volver con Realtime. Anotalo como candidato en el PR.
5. **CSS muerto del storefront:** la regla `.edit-scope` en `src/components/storefront/storefront.css` (~L361-362).
6. **CSS muerto del admin** en `src/app/bunker/admin.module.css`. Estas clases no aparecen como `styles.x` ni como string en ningún `.tsx`:
   ```
   addOptionAction adminNav backLink cardHeader categoryCard deliveryForm editPricesLink focalInputs
   focalMarker focalPreview focalPreviewWrap iconSmall imageEditor moreSettings moveButtons optionForms
   optionGroupCard optionRow optionRows orderList primaryLink productInfo productList publicView
   secondaryLink sectionLinks selectionTag shiftList statusLine variantSaveText
   ```
   - **NO borres `state_open`, `state_closed` ni `state_paused`.** Se usan dinámicamente (`dashboard.tsx:116`: ``styles[`state_${store.state}`]``).
   - Antes de borrar cada clase, revisá también `dashboard.tsx:320` (`styles[badge.className]`): buscá de dónde salen esos `className` y no borres ninguna clase que pueda llegar por ahí.
   - Si una regla combina una clase muerta con una viva (`.a, .muerta {…}` o `.viva .muerta`), borrá solo el selector muerto.
7. **Exports internos innecesarios** (quitar solo la palabra `export`; el código queda):
   - `StorefrontProps` (`storefront.tsx`), `PromoLayout` (`promo-showcase.tsx`).
   - **NO** les quites el `export` a `DashboardProduct`, `DashboardPromotion` ni `DashboardStore`. En la fase 5 se parte `dashboard.tsx`, y los archivos nuevos (`product-rows.tsx`, `promotion-rows.tsx`) los van a importar.

**Gate de fase 1:** typecheck, lint y test en verde. Además, `pnpm build` una vez (por los CSS modules).

## 3. Fase 2: partir `storefront.tsx`

Estructura objetivo, dentro de `src/components/storefront/`:

```
storefront.tsx                 ← SOLO Storefront (+ sus constantes privadas). NO se renombra.
cart-lines.ts                  ← makeCartLine + toPromotionLines (únicos helpers con usuarios en 2+ archivos; sin "use client", sin JSX)
shared/
  view-bar.tsx                 ← ViewBar (CartSection + CheckoutSection)
  quantity-stepper.tsx         ← NUEVO componente (fase 3)
  compare-at.tsx               ← NUEVO componente (fase 3)
drawers/
  option-groups.tsx            ← OptionGroups + unitsWithExtra + unitGroupsOf
  product-drawer.tsx           ← ProductDrawer + FOCUSABLE + trapFocus (su único usuario)
  combo-drawer.tsx             ← ComboDrawer + ComboDrawerState + comboDrawerState
cart/
  cart-section.tsx             ← CartSection + chosenExtras (su único usuario)
checkout/
  checkout-section.tsx         ← CheckoutSection + CHECKOUT_ERRORS + canonicalSelections (su único usuario)
  payment-choice.tsx           ← PaymentChoice + PAYMENT_ICONS
```

Orden de pasos (un commit cada uno; correr `pnpm typecheck && pnpm test src/components/storefront` después de cada uno):

1. **`cart-lines.ts`**: mover `makeCartLine` y `toPromotionLines` (con `export`) e importarlos en `storefront.tsx`.
   - Los helpers que usa **un solo** componente **se quedan en `storefront.tsx`**: `textKey`, `removeProductParam`, `CREDIT_WHATSAPP_URL`, `VIEW_TITLES` y `DEFAULT_PAYMENT_METHODS` (este último solo lo usa Storefront).
   - Los otros helpers se van con su componente, cada uno en su paso: `trapFocus` con ProductDrawer, `chosenExtras` con CartSection y `canonicalSelections` con CheckoutSection.
2. *(eliminado: `trapFocus` va dentro de `product-drawer.tsx`, ver paso 5)*
3. **`shared/view-bar.tsx`**: `ViewBar`. Es JSX puro, sin hooks, así que **no** lleva `"use client"`. Lo importan componentes cliente y con eso alcanza.
4. **`drawers/option-groups.tsx`**: `OptionGroups` (export), `unitsWithExtra` (export solo si otro archivo lo usa) y `unitGroupsOf` (export).
5. **`drawers/product-drawer.tsx`**: `ProductDrawer`, más `FOCUSABLE` y `trapFocus` (privados, sin export).
   - En `storefront.tsx`, re-exportalo para no romper `storefront.test.tsx:9`: `export { ProductDrawer } from "./drawers/product-drawer";`.
   - Alternativa preferida: cambiar el import del test a `import { ProductDrawer } from "./drawers/product-drawer";` y `import { Storefront } from "./storefront";`. Elegí esta y **no** dejes el re-export.
6. **`drawers/combo-drawer.tsx`**: `ComboDrawerState`, `comboDrawerState` y `ComboDrawer`.
7. **`cart/cart-section.tsx`**: `CartSection`. Necesita `ViewBar`, `chosenExtras`, `comboCount`/`comboLines`/`removeOneCombo` (`@/domain/combos`), `changeLineQuantity`/`removeCartLine` (`@/domain/cart`) y los iconos `Minus`/`Plus`.
8. **`checkout/payment-choice.tsx`** (`PaymentChoice` + `PAYMENT_ICONS`) y luego **`checkout/checkout-section.tsx`** (`CheckoutSection` + `CHECKOUT_ERRORS`).
   - CheckoutSection **no** usa `DEFAULT_PAYMENT_METHODS` (solo Storefront, en L155), así que se queda en `storefront.tsx`.
9. Limpiar los imports que quedaron sin uso en `storefront.tsx` (lint `no-unused-vars`). Objetivo: **`storefront.tsx` ≤ ~550 líneas**.

**Reglas de esta fase:**
- Los nombres de props, el markup y las clases CSS quedan **idénticos**. Es cortar y pegar.
- `storefront.css` sigue importándose **una sola vez**, desde `storefront.tsx`. Los archivos nuevos **no** importan CSS (es CSS global; un import duplicado no rompe, pero ensucia).
- Los 11 tests `storefront-*.test.tsx` pasan por `<Storefront/>` y deben seguir verdes **sin cambios**.

**Gate de fase 2:** typecheck, lint, test y `pnpm build`.

## 4. Fase 3: componentes compartidos (sacar duplicación)

Hacela **después** de la fase 2, cuando cada pieza ya vive en su archivo.

### 4.1 `QuantityStepper` (`shared/quantity-stepper.tsx`)

Hay 4 steppers con el mismo markup `<div className="quantity-stepper[ compact]"><button><Minus/></button><strong>{n}</strong><button><Plus/></button></div>`:

| Dónde | aria dec / inc | dec | inc | disabled |
|---|---|---|---|---|
| ComboDrawer (contador de combos, L827) | "Quitar un combo" / "Agregar otro combo" | `setCount(max(1, c-1))` | `setCount(c+1)` | dec si `count<=1` |
| ProductDrawer (cantidad, L1133) | "Disminuir cantidad" / "Aumentar cantidad" | `max(1, q-1)` | `q+1` | dec si `quantity===1` |
| CartSection, línea suelta (`compact`) | `Quitar uno de ${name}` / `Agregar uno de ${name}` | `changeLineQuantity(cart,id,-1)` | `+1` | ninguno |
| CartSection, combo (`compact`) | `Quitar un ${combo.name}` / `Agregar otro ${combo.name}` | `removeOneCombo` | `onAddCombo` | ninguno |

API propuesta (callbacks, no `value/onChange`, porque los del carrito no son un setter numérico):

```tsx
export function QuantityStepper({ value, onDecrement, onIncrement, decrementLabel, incrementLabel, decrementDisabled = false, compact = false }: {
  value: number;
  onDecrement: () => void;
  onIncrement: () => void;
  decrementLabel: string;
  incrementLabel: string;
  decrementDisabled?: boolean;
  compact?: boolean;
})
```

- El markup tiene que salir **byte a byte igual** al actual: misma clase, mismo orden, `type="button"`, `aria-hidden` en los iconos si hoy lo tienen.
- **Antes de reemplazar, leé los 4 sitios y copiá exactamente qué atributos tiene cada botón.** Si alguno tiene algo extra (por ejemplo `disabled` en el inc), agregalo como prop.
- **No** reemplaces el mini-stepper de unidades por extra de `OptionGroups` (`.option-units-stepper`): tiene otro markup y clase.
- Test nuevo: `shared/quantity-stepper.test.tsx`. Cubrí que renderiza el valor, que llama `onDecrement`/`onIncrement`, que `decrementDisabled` deshabilita y que `compact` agrega la clase.

### 4.2 `CompareAt` (`shared/compare-at.tsx`)

Patrón repetido: el precio anterior tachado. Hay **5 sitios** verificados y **no son idénticos**:

| Sitio | Markup exacto actual |
|---|---|
| `menu.tsx` L173 | `{" "}<s className="compare-at"><span className="sr-only">Antes</span> {formatArs(x)}</s>` |
| `promo-showcase.tsx` L117 | igual que en menu (con `{" "}` antes) |
| `storefront.tsx` L551 (bandeja) | `<s><span className="sr-only">Antes</span> {formatArs(subtotal)}</s>`: **sin clase**, sin `{" "}` |
| `storefront.tsx` L763 (ComboDrawer) | `<s className="compare-at"><span className="sr-only">Antes</span> {formatArs(x)}</s>`: sin `{" "}` |
| `storefront.tsx` L1078 (ProductDrawer) | `<s className="compare-at">{formatArs(x)}</s>`: **sin sr-only y sin espacio** |

El `{" "}` previo queda **afuera** del componente, donde está hoy. Con `srLabel`, el contenido es `<span className="sr-only">Antes</span> {formatArs(cents)}`, con el espacio. Sin `srLabel`, es solo `{formatArs(cents)}`.

```tsx
export function CompareAt({ cents, srLabel = true, className = "compare-at" }: { cents: bigint; srLabel?: boolean; className?: string | undefined })
```

- Extraé **solo** el `<s>` tachado (no el precio principal: cada sitio lo envuelve distinto).
- Respetá las diferencias: donde hoy no hay `sr-only`, pasá `srLabel={false}`; donde no hay clase, pasá `className=""` y no renderices el atributo si es vacío. **No uniformes el markup**: sería un cambio de comportamiento (lectores de pantalla y tests).
- Test nuevo: `shared/compare-at.test.tsx`.

### 4.3 ~~`useEscapeKey`~~: descartado

Lo revisé en el código: los 3 handlers de Escape **no** son iguales, y extraerlos cambia el comportamiento.
- `ProductDrawer` (L1031) maneja Escape **y** Tab/`trapFocus` en el mismo handler. Además maneja el foco de retorno, el scroll y `body.drawer-open`.
- `ComboDrawer` (L722) se suscribe una sola vez, con un `eslint-disable` puesto a propósito.
- `order-return-modal.tsx:46` se vuelve a suscribir cuando cambia `onClose`.

Un hook común cambiaría cuándo se suscribe cada uno, así que **no se hace**.

### 4.4 ~~Iconos de mecánica de promo~~: descartado

Verificado: **no son iguales**. `promo-showcase.tsx:36` usa `fixed_price: Layers` y `promotion-form.tsx:158` usa `fixed_price: Package`; el resto coincide. Son decisiones visuales distintas (carta y admin), así que no se unifican.

### 4.5 Formato de pesos duplicado en el admin

- `quick-form.tsx:67` y `store-settings.tsx:90` definen cada uno `const ARS = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 2 })`.
- **No** los cambies a `formatArs`, que formatea centavos `bigint` y puede dar otro string.
- Mové ese formateador **una vez** a `src/lib/money.ts` como `export const ARS_DECIMAL = new Intl.NumberFormat(...)` (mismo constructor) e importalo en ambos.

**Gate de fase 3:** typecheck, lint, test (con los tests nuevos) y build.

## 5. Fase 4: partir `promo-showcase.tsx`

Destino `src/components/storefront/promo/`:

```
promo/promo-showcase.tsx   ← PromoShowcase, showcasePromotions, usePromoLayout (+ subscribe, LAYOUTS, readLayout), PromoTile
promo/combo-section.tsx    ← ComboSection, comboContents, isCombo, comboPromotions
promo/promo-cards.tsx      ← PromoSection, PromoBanner
```

Pasos:
1. `git mv src/components/storefront/promo-showcase.tsx src/components/storefront/promo/promo-showcase.tsx` y `git mv` también su test `promo-showcase.test.tsx` a `promo/`. Después cortá `combo-section.tsx` y `promo-cards.tsx` del archivo movido.
2. Actualizá los importadores. Las rutas varían: chequeá cada archivo con `grep -rn "promo-showcase" src`.
   - `storefront.tsx` (`./promo/...`).
   - `menu.tsx`, si importa algo.
   - El test movido.
   - El admin: `src/app/bunker/admin/promociones/promotion-preview.tsx:6`, que importa `ComboSection`, `isCombo`, `PromoBanner` y `PromoSection` → `@/components/storefront/promo/...`.
   - Si `focal-style` queda en la raíz de storefront, el import pasa a `../focal-style`.

**Gate de fase 4:** typecheck, lint, test y build.

## 6. Fase 5: sacar componentes del árbol de rutas del admin

**Objetivo:** `src/app/bunker/admin/**` solo con archivos de ruta de Next (`page.tsx`, `layout.tsx`, `actions.ts` con `"use server"`, y los helpers de datos que las páginas usan: `*-props.ts`, `form-state.ts`, `paths.ts`, `status-labels.ts`, `admin-action.ts`). La UI se va a `src/components/admin/`.

| Origen (`src/app/bunker/admin/…`) | Destino (`src/components/admin/…`) |
|---|---|
| `dashboard.tsx` | `dashboard/dashboard.tsx` |
| `category-tools.tsx` | `dashboard/category-tools.tsx` |
| `quick-form.tsx` | `dashboard/quick-form.tsx` |
| `use-drag-order.ts` | `dashboard/use-drag-order.ts` |
| `store-settings.tsx` | `tienda/store-settings.tsx` |
| `admin-form.tsx` | `shared/admin-form.tsx` |
| `page-bar.tsx` | `shared/page-bar.tsx` |
| `admin-bottom-nav.tsx` | `shared/admin-bottom-nav.tsx` |
| `logout-form.tsx` (+ `logout-form.test.tsx`) | `shared/logout-form.tsx` (+ test) |
| `catalogo/product-form.tsx` (+ test) | `catalogo/product-form.tsx` (+ test) |
| `catalogo/product-preview.tsx` | `catalogo/product-preview.tsx` |
| `catalogo/photo-field.tsx` (+ test) | `catalogo/photo-field.tsx` (+ test) |
| `catalogo/photo-dropzone.tsx` | `catalogo/photo-dropzone.tsx` |
| `promociones/promotion-form.tsx` (+ test) | `promociones/promotion-form.tsx` (+ test) |
| `promociones/promotion-preview.tsx` | `promociones/promotion-preview.tsx` |

Reglas:
- Cada `git mv` va en su propio commit **o** como un único commit "mover UI del admin a components/admin", tras verificar typecheck. Preferí un commit por carpeta destino (dashboard, tienda, shared, catalogo, promociones).
- Los archivos movidos importan `styles from "../bunker/admin.module.css"` o similar. Reemplazá **todas** esas rutas por el alias absoluto `@/app/bunker/admin.module.css`. Así no dependen de la profundidad. Se mueve en la fase 6.
- Los imports **de** acciones (`./actions`, `../catalogo/actions`) pasan a `@/app/bunker/admin/catalogo/actions`, etc.
- Los imports **hacia** los movidos (en `page.tsx`, `layout.tsx` y `productos/[productId]/page.tsx`) pasan a `@/components/admin/...`.
- **Mocks que hay que actualizar** (verificados):
  - `catalogo/product-form.test.tsx:8` tiene `vi.mock("./actions", …)`. Pasa a `vi.mock("@/app/bunker/admin/catalogo/actions", …)`, y en el `product-form.tsx` movido el import de acciones usa esa misma ruta.
  - `logout-form.test.tsx:8` tiene `vi.mock("../actions", …)` (las acciones de `src/app/bunker/actions.ts`). Pasa a `vi.mock("@/app/bunker/actions", …)`, igual que el import de `logout-form.tsx`.
- **No les agregues `"use client"` a los server components.** Hoy `page-bar.tsx` y `catalogo/photo-dropzone.tsx` **no** lo tienen: movelos tal cual. Si se lo agregás, terminan en el bundle del cliente.
- Estos no son UI y se quedan en `app/`:
  - `admin-action.ts` (`server-only`).
  - `form-state.ts` y `catalogo/form-state.ts` (re-exporta `../form-state`).
  - `paths.ts`, `*-props.ts` y `tienda/status-labels.ts`.
  - `actions.ts` (`"use server"`).
- Tests movidos: los que importan acciones relativas (`product-form.test.tsx` importa `./actions` y `./form-state`) pasan a `@/app/bunker/admin/catalogo/actions` y `.../form-state`. Los `vi.mock("./actions")` con ruta relativa **también hay que actualizarlos a la ruta nueva**. Si no, el mock deja de aplicarse y el test puede pasar o fallar por la razón equivocada. Revisá cada `vi.mock(` de los tests movidos.
- `page.test.tsx` y `layout.test.tsx` se quedan donde están (prueban rutas); solo cambian sus imports si referencian algo movido.
- **Partir `dashboard.tsx`** (después de moverlo):
  - `dashboard/promotion-rows.tsx` (`PromotionRows`).
  - `dashboard/product-rows.tsx` (`ProductRows`, `QuickRowInfo`, `ProductHiddenFields`).
  - `dashboard/store-switch.tsx` (`StoreSwitch`).
  - `dashboard.tsx` queda con `AdminDashboard`, `ICONS` y los tipos.
- **Partir `promotion-form.tsx`:**
  - Los helpers puros `cents`, `mechanicFrom`, `PreviewRow`, `previewRows` y `uniformSchedule`, y las constantes `WEEKDAYS`, `TYPES`, `MECHANIC_HINT`, `BADGE_SUGGESTIONS` y `DAY_CHIPS`, van a `promociones/promotion-form-model.ts` (sin `"use client"` y sin JSX).
    - **Si alguna constante contiene JSX o iconos**, dejala en el `.tsx`.
  - `promotion-form.test.tsx` importa `previewRows` desde `./promotion-form`. Cambialo a `./promotion-form-model`.
- **No** unifiques `WEEKDAYS` con `DAY_CHIPS` en este plan (forma distinta; sin beneficio claro).

**Gate de fase 5:** typecheck, lint, test y build. Además, levantá `pnpm dev` y entrá a `/bunker/admin`, a un producto y a una promo para ver que renderizan. Si no podés loguearte, decílo en el PR. **No** uses credenciales reales.

## 7. Fase 6: partir `admin.module.css` (3786 líneas)

**Esta es la fase de más riesgo visual. Hacela al final y en un commit por hoja.**

1. Hojas destino (CSS Modules, junto a los componentes):
   - `src/components/admin/shared/admin-shared.module.css`: layout, barras, botones, formularios genéricos, `pageBar`, bottom nav, estados.
   - `src/components/admin/dashboard/dashboard.module.css`.
   - `src/components/admin/catalogo/catalogo.module.css`.
   - `src/components/admin/promociones/promociones.module.css`.
   - `src/components/admin/tienda/tienda.module.css`.
2. Método:
   - Para cada clase, listá qué archivos la usan: `grep -rn "styles\.<clase>\b" src`, más los usos dinámicos (`styles[...]`).
   - **Si la usa un solo área, va a la hoja de esa área. Si la usan dos o más, va a `admin-shared`.**
   - Las reglas que combinan clases (`.card .title`, `.a:hover .b`, `@media`) tienen que terminar en **la misma hoja que todas las clases que nombran**. Si mezclan áreas, quedan en `admin-shared`.
   - Copiá también los `@keyframes`, los `@media`/`@container` y las variables locales que esas reglas usen.
3. CSS Modules no comparte clases entre archivos: un componente que usa clases de dos hojas importa ambas (`import shared from ".../admin-shared.module.css"; import styles from "./catalogo.module.css";`). **Los nombres de clase no cambian.**
4. Orden de cascada: en CSS Modules el orden entre hojas depende del orden de import. Si una regla de área pisaba a una compartida (misma especificidad, aparecía después en el archivo único), importá siempre la compartida **primero**.
   - Verificá visualmente las pantallas tocadas: dashboard, producto nuevo/editar, promo nueva/editar, tienda y login.
5. `src/app/bunker/login-form.tsx` y `src/app/bunker/page.tsx` (login) también importan `admin.module.css`: pasan a `admin-shared`, o a una hoja `login.module.css` si sus clases son exclusivas.
6. Al final, `src/app/bunker/admin.module.css` tiene que quedar **vacío y borrado**. Corré `grep -rn "admin.module.css" src` y verificá que dé 0 resultados.
7. Si `design-tokens.test.ts` tiene allowances por ruta para `admin.module.css` (hoy no tiene, verificalo), movelas.

**Gate de fase 6:** typecheck, lint, test y build, más la revisión visual del admin en mobile (375px) y desktop: barras sticky, preview de promo y drag de categorías. Adjuntá capturas en el PR.

## 7.5 Árbol final (cómo queda `src/` al terminar)

Solo las carpetas que cambian. Los tests siguen al lado de su archivo y no se listan. Referencias: ★ nuevo, ← de dónde viene, ✗ se borra.

```
src/
├── app/bunker/
│   ├── page.tsx · login-form.tsx · actions.ts      (login; importan login.module.css o admin-shared)
│   ├── admin.module.css                            ✗ (fase 6)
│   └── admin/                                      ← solo rutas, actions y helpers de datos
│       ├── layout.tsx · page.tsx
│       ├── admin-action.ts · form-state.ts · paths.ts
│       ├── catalogo/   actions.ts · form-state.ts · product-props.ts · productos/{nuevo,[productId]}/page.tsx
│       ├── promociones/ actions.ts · promotion-props.ts · {nueva,[promotionId]}/page.tsx
│       └── tienda/     actions.ts · status-labels.ts
│
├── components/
│   ├── admin/                                      ★ (fase 5)
│   │   ├── shared/
│   │   │   ├── admin-shared.module.css             ★ (fase 6)
│   │   │   ├── admin-form.tsx · admin-bottom-nav.tsx · logout-form.tsx
│   │   │   └── page-bar.tsx                        (server component, sin "use client")
│   │   ├── dashboard/
│   │   │   ├── dashboard.module.css                ★
│   │   │   ├── dashboard.tsx                       (AdminDashboard + ICONS + tipos exportados)
│   │   │   ├── promotion-rows.tsx · product-rows.tsx · store-switch.tsx   ★ salen de dashboard.tsx
│   │   │   └── category-tools.tsx · quick-form.tsx · use-drag-order.ts
│   │   ├── catalogo/
│   │   │   ├── catalogo.module.css                 ★
│   │   │   ├── product-form.tsx · product-preview.tsx · photo-field.tsx
│   │   │   └── photo-dropzone.tsx                  (server component)
│   │   ├── promociones/
│   │   │   ├── promociones.module.css              ★
│   │   │   ├── promotion-form.tsx                  (solo el form)
│   │   │   ├── promotion-form-model.ts             ★ previewRows, mechanicFrom, cents, uniformSchedule, constantes sin JSX
│   │   │   └── promotion-preview.tsx
│   │   └── tienda/
│   │       ├── tienda.module.css                   ★
│   │       └── store-settings.tsx
│   │
│   └── storefront/
│       ├── storefront.tsx                          SOLO Storefront (~550; antes 1771). NO se renombra (ruta en cloud-evidence-scope.test.ts)
│       ├── cart-lines.ts                           ★ makeCartLine + toPromotionLines
│       ├── storefront.css                          (sin .edit-scope; sigue siendo la única hoja, importada solo acá)
│       ├── shared/                                 ★
│       │   ├── view-bar.tsx
│       │   ├── quantity-stepper.tsx                ★ 4 steppers
│       │   └── compare-at.tsx                      ★ precio tachado (5 sitios)
│       ├── drawers/                                ★
│       │   ├── option-groups.tsx                   OptionGroups + unitGroupsOf + unitsWithExtra
│       │   ├── product-drawer.tsx                  + trapFocus/FOCUSABLE (privados)
│       │   └── combo-drawer.tsx                    + ComboDrawerState + comboDrawerState
│       ├── cart/cart-section.tsx                   ★ + chosenExtras
│       ├── checkout/
│       │   ├── checkout-section.tsx                ★ + CHECKOUT_ERRORS + canonicalSelections
│       │   └── payment-choice.tsx                  ★ + PAYMENT_ICONS
│       ├── promo/                                  ★ (fase 4)
│       │   ├── promo-showcase.tsx                  ← ../promo-showcase.tsx (PromoShowcase, PromoTile, usePromoLayout, showcasePromotions)
│       │   ├── combo-section.tsx                   ★ ComboSection, comboContents, isCombo, comboPromotions
│       │   └── promo-cards.tsx                     ★ PromoSection + PromoBanner
│       └── menu.tsx · menu-sections.ts · order-return-modal.tsx · store-toast.tsx
│           focal-style.ts · storefront-state.ts · use-*.ts   (sin cambios)
│
└── lib/money.ts                                    + ARS_DECIMAL (formateador repetido del admin)
```

**Cambios respecto de la primera versión del árbol**, tras validar con codegraph:
- `storefront-helpers.ts` pasa a ser `cart-lines.ts` y solo guarda los 2 helpers compartidos. Los demás viven con su único usuario.
- Se saca `shared/focus-trap.ts`: lo usa únicamente ProductDrawer.
- Se sacan `shared/use-escape-key.ts` y `promo/mechanic-icons.ts` (ver 4.3 y 4.4).
- `price.tsx` pasa a llamarse `compare-at.tsx`, porque eso es lo que realmente extrae.

## 8. Fuera de alcance y avisos

- **E2E (`tests/e2e/*.spec.ts`)**: no se tocan. Si un selector de E2E depende de una ruta de archivo (no debería), anotalo en el PR para agy.
- **Servidor y dominio**: no se reorganiza `src/server/**` ni `src/domain/**` en este plan. Candidatos futuros:
  - `server/rate-limit.ts` (568 líneas, suelto en la raíz).
  - Los tres "catalog" (`src/data/catalog.ts`, `src/domain/catalog.ts`, `src/server/catalog/demo-catalog.ts`).
- **`src/components/ui/*` y `/design-system`**: los primitives solo los usa `design-system/showcase.tsx` (y `ui/sonner.tsx`, que usa el layout). **No borrar.** La ruta `/design-system` está viva y tiene E2E (`tests/e2e/design-system.spec.ts`). Decisión de producto pendiente.
- **Hooks del storefront** (`use-*.ts` en `components/storefront/`): pueden ir a `components/storefront/hooks/` en un PR futuro. No es necesario ahora y suma churn de imports.

## 9. Checklist final del PR de implementación

- [~] El árbol final coincide con la sección 7.5. Si no coincide, explicá la diferencia en el PR. (con desvíos menores: ver "Fases 5-6" en el PR)
- [x] Fases 1 a 6 hechas, con un commit por paso.
- [x] `pnpm typecheck`, `pnpm lint`, `pnpm test` y `pnpm build` en verde. Pegá la línea de resumen de vitest (archivos y tests).
- [ ] `storefront.tsx` ≤ ~550 líneas; ningún archivo de `src/components/storefront/**` > 450. (pendiente: `storefront.tsx` tiene 601 líneas; el resto de `storefront/**` cumple)
- [x] `src/app/bunker/admin/**` sin componentes de UI (solo rutas, actions y helpers de datos).
- [x] `admin.module.css` borrado; `grep -rn "admin.module.css" src` da 0 resultados.
- [ ] Capturas del admin y del storefront (mobile y desktop) sin cambios visuales. (pendiente: falta la verificación visual del admin con sesión)
- [x] La lista de "no borrado por duda" (fase 1) está en la descripción del PR.
- [x] No se tocaron migraciones, `database.types.ts`, `.gitignore`, `next-env.d.ts` ni E2E.
