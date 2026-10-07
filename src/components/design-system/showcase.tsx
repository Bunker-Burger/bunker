"use client";

import { CircleDollarSign, Plus, Settings2, ShoppingBag, UtensilsCrossed } from "lucide-react";
import { useState, type ReactNode } from "react";
import { AppShell, SiteHeader } from "@/components/shell/app-shell";
import { BottomNav } from "@/components/shell/bottom-nav";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from "@/components/ui/dialog";
import {
  Drawer,
  DrawerBody,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger
} from "@/components/ui/drawer";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/sonner";
import { EmptyState, ErrorState } from "@/components/ui/state-message";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";

const colorTokens = [
  ["canvas", "Fondo base"],
  ["surface", "Tarjetas"],
  ["surface-raised", "Overlays"],
  ["surface-high", "Contenedor alto"],
  ["field", "Campos"],
  ["foreground", "Texto"],
  ["muted", "Texto secundario"],
  ["border-strong", "Borde de controles"],
  ["primary", "Ámbar / CTA"],
  ["primary-hover", "Ámbar hover"],
  ["secondary", "Ámbar caramelo"],
  ["danger", "Rojo / agotado"],
  ["danger-text", "Rojo texto"],
  ["success", "Verde / estado positivo"]
] as const;

const typeScale = [
  ["font-display text-hero font-bold uppercase", "Display hero"],
  ["font-display text-headline-lg font-bold uppercase", "Headline grande"],
  ["font-display text-headline-md font-semibold uppercase", "Headline medio"],
  ["font-display text-title font-semibold uppercase", "Título"],
  ["font-display text-price font-bold text-primary", "$ 7.800"],
  ["text-body-lg", "Cuerpo grande para descripciones y formularios."],
  ["text-body text-muted", "Cuerpo para listas de ingredientes y metadata."],
  ["text-body-sm text-muted", "Cuerpo chico para notas al pie."],
  ["text-label font-bold uppercase tracking-[0.05em]", "Etiqueta de control"]
] as const;

const radii = [
  ["sm", "rounded-sm"],
  ["md", "rounded-md"],
  ["lg", "rounded-lg"],
  ["xl", "rounded-xl"],
  ["full", "rounded-full"]
] as const;

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="grid grid-cols-1 gap-4 border-t border-border py-8">
      <h2 id={id} className="m-0 font-display text-headline-lg font-bold uppercase">{title}</h2>
      {children}
    </section>
  );
}

export function DesignSystemShowcase() {
  const [loading, setLoading] = useState(false);
  const [pickup, setPickup] = useState(true);

  const simulateLoading = () => {
    setLoading(true);
    window.setTimeout(() => setLoading(false), 1500);
  };

  return (
    <AppShell
      header={
        <SiteHeader>
          <span className="font-display text-title font-bold tracking-[0.04em] text-primary">BÚNKER BURGER</span>
          <Badge variant="neutral">Sistema visual</Badge>
        </SiteHeader>
      }
      bottomNav={
        <BottomNav
          activeHref="#componentes"
          items={[
            { href: "#tokens", label: "Tokens", icon: Settings2 },
            { href: "#componentes", label: "Componentes", icon: UtensilsCrossed },
            { href: "#estados", label: "Estados", icon: ShoppingBag, badge: 3 },
            { href: "#overlays", label: "Overlays", icon: CircleDollarSign }
          ]}
        />
      }
    >
      <div className="grid gap-2 py-8">
        <p className="m-0 text-badge font-bold uppercase tracking-[0.12em] text-primary">Streetcraft</p>
        <h1 className="m-0 font-display text-hero font-bold uppercase lg:text-hero-lg">Sistema visual</h1>
        <p className="m-0 max-w-2xl text-body-lg text-muted">
          Tokens, primitives y estados compartidos. Todo color, tipografía y radio sale de <code>globals.css</code>.
        </p>
      </div>

      <Section id="tokens" title="Tokens">
        <ul className="m-0 grid list-none grid-cols-2 gap-3 p-0 sm:grid-cols-3 lg:grid-cols-7">
          {colorTokens.map(([token, label]) => (
            <li key={token} className="grid gap-1.5">
              <span
                aria-hidden="true"
                className="h-14 rounded-md border border-border"
                style={{ background: `var(--color-${token})` }}
              />
              <span className="text-body-sm font-bold">{label}</span>
              <code className="text-body-sm text-muted">{token}</code>
            </li>
          ))}
        </ul>
        <div className="grid gap-3">
          {typeScale.map(([className, sample]) => (
            <p key={className} className={`m-0 ${className}`}>{sample}</p>
          ))}
        </div>
        <div className="flex flex-wrap gap-3">
          {radii.map(([radius, className]) => (
            <span key={radius} className={`grid size-16 place-items-center border border-border-strong bg-surface text-body-sm ${className}`}>
              {radius}
            </span>
          ))}
        </div>
      </Section>

      <Section id="componentes" title="Componentes">
        <div className="flex flex-wrap items-center gap-3">
          <Button>Agregar al carrito</Button>
          <Button variant="secondary">Personalizar</Button>
          <Button variant="ghost">Ver detalle</Button>
          <Button variant="destructive">Vaciar carrito</Button>
          <Button size="sm">Chico</Button>
          <Button size="lg">Grande</Button>
          <Button size="icon" aria-label="Agregar uno"><Plus /></Button>
          <Button disabled>Deshabilitado</Button>
          <Button loading={loading} onClick={simulateLoading}>{loading ? "Enviando" : "Probar carga"}</Button>
        </div>

        <div className="flex flex-wrap gap-2">
          <Badge>Doble smash</Badge>
          <Badge variant="solid">Más pedida</Badge>
          <Badge variant="neutral">Nuevo</Badge>
          <Badge variant="success">Abierto</Badge>
          <Badge variant="soldOut">Agotado</Badge>
        </div>

        <Tabs defaultValue="burgers">
          <TabsList aria-label="Categorías de ejemplo">
            <TabsTrigger value="burgers">Hamburguesas</TabsTrigger>
            <TabsTrigger value="sandwiches">Sándwiches</TabsTrigger>
            <TabsTrigger value="papas">Papas</TabsTrigger>
            <TabsTrigger value="bebidas" disabled>Bebidas</TabsTrigger>
          </TabsList>
          <TabsContent value="burgers" className="text-muted">Smash, cheddar y bacon.</TabsContent>
          <TabsContent value="sandwiches" className="text-muted">Milanesa y lomito.</TabsContent>
          <TabsContent value="papas" className="text-muted">Clásicas y con cheddar.</TabsContent>
        </Tabs>

        <form className="grid max-w-xl gap-4" onSubmit={(event) => event.preventDefault()}>
          <div className="grid gap-1.5">
            <Label htmlFor="ds-name">Tu nombre</Label>
            <Input id="ds-name" autoComplete="name" placeholder="¿A nombre de quién?" />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="ds-address">Dirección</Label>
            <Input id="ds-address" aria-invalid="true" aria-describedby="ds-address-error" defaultValue="Calle" />
            <p id="ds-address-error" className="m-0 text-body-sm text-danger-text">Ingresá calle, número y referencia.</p>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="ds-disabled">Campo deshabilitado</Label>
            <Input id="ds-disabled" disabled defaultValue="No editable" />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="ds-notes">Aclaraciones para la cocina</Label>
            <Textarea id="ds-notes" maxLength={180} placeholder="Ej: sin cebolla, salsa aparte…" />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="ds-payment">Método de pago</Label>
            <Select defaultValue="transfer">
              <SelectTrigger id="ds-payment">
                <SelectValue placeholder="Elegí cómo pagar" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="transfer">Transferencia</SelectItem>
                <SelectItem value="cash">Efectivo exacto</SelectItem>
                <SelectItem value="mercado-pago" disabled>Mercado Pago (no disponible)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex min-h-tap items-center gap-3">
            <Switch id="ds-pickup" checked={pickup} onCheckedChange={setPickup} />
            <Label htmlFor="ds-pickup" className="normal-case tracking-normal text-foreground">Retiro en el local</Label>
          </div>
          <div className="flex min-h-tap items-center gap-3">
            <Switch id="ds-switch-disabled" disabled />
            <Label htmlFor="ds-switch-disabled" className="normal-case tracking-normal">Delivery (fuera de horario)</Label>
          </div>
        </form>
      </Section>

      <Section id="estados" title="Estados">
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          <Card>
            <CardHeader>
              <Badge>Signature</Badge>
              <CardTitle>Smash Búnker Doble</CardTitle>
              <CardDescription>Dos medallones smash, doble cheddar, bacon crocante y salsa Búnker.</CardDescription>
            </CardHeader>
            <CardFooter>
              <strong className="font-display text-price text-primary">$ 7.800</strong>
              <Button size="sm">Agregar <Plus /></Button>
            </CardFooter>
          </Card>

          <Card>
            <CardHeader>
              <Badge variant="soldOut">Agotado</Badge>
              <CardTitle>Papas Búnker</CardTitle>
              <CardDescription>Papas rústicas con cheddar y verdeo.</CardDescription>
            </CardHeader>
            <CardFooter>
              <strong className="font-display text-price text-muted line-through">$ 4.200</strong>
              <Button size="sm" disabled>Sin stock</Button>
            </CardFooter>
          </Card>

          <Card role="status" aria-busy="true" aria-label="Cargando producto">
            <CardHeader>
              <Skeleton className="h-6 w-24 rounded-full" />
              <Skeleton className="h-7 w-3/4" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-2/3" />
            </CardHeader>
            <CardFooter>
              <Skeleton className="h-6 w-20" />
              <Skeleton className="h-tap w-28 rounded-full" />
            </CardFooter>
          </Card>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <EmptyState
            icon={ShoppingBag}
            title="Tu carrito está vacío"
            description="Elegí algo rico de la carta para empezar."
            action={<Button variant="secondary" size="sm">Ver menú</Button>}
          />
          <ErrorState
            title="No pudimos cargar la carta"
            description="Revisá tu conexión e intentá de nuevo."
            action={<Button size="sm">Reintentar</Button>}
          />
        </div>
      </Section>

      <Section id="overlays" title="Overlays">
        <div className="flex flex-wrap gap-3">
          <Dialog>
            <DialogTrigger asChild>
              <Button variant="secondary">Abrir diálogo</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>¿Vaciar el carrito?</DialogTitle>
                <DialogDescription>Se quitan todos los productos. Esta acción no se puede deshacer.</DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <DialogClose asChild><Button variant="ghost">Cancelar</Button></DialogClose>
                <DialogClose asChild><Button variant="destructive">Vaciar</Button></DialogClose>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          <Drawer>
            <DrawerTrigger asChild>
              <Button variant="secondary">Abrir drawer</Button>
            </DrawerTrigger>
            <DrawerContent>
              <DrawerHeader>
                <DrawerTitle>Smash Búnker Doble</DrawerTitle>
                <DrawerDescription>Personalizá tu hamburguesa.</DrawerDescription>
              </DrawerHeader>
              <DrawerBody className="grid gap-3">
                <Label htmlFor="ds-drawer-notes">Aclaraciones</Label>
                <Textarea id="ds-drawer-notes" placeholder="Ej: sin cebolla" />
              </DrawerBody>
              <DrawerFooter>
                <DrawerClose asChild><Button className="flex-1">Agregar 1 al carrito</Button></DrawerClose>
              </DrawerFooter>
            </DrawerContent>
          </Drawer>

          <Button variant="secondary" onClick={() => toast.success("Smash Búnker Doble se agregó al carrito.")}>
            Mostrar toast
          </Button>
          <Button variant="secondary" onClick={() => toast.error("No pudimos confirmar el pedido.")}>
            Toast de error
          </Button>
        </div>
      </Section>
    </AppShell>
  );
}
