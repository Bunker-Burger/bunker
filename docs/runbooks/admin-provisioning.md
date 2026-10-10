# Aprovisionamiento de la cuenta administrativa

BB-11 admite una sola cuenta creada manualmente por entorno. Crear el usuario en Supabase Auth no concede acceso: la autorización depende de una membresía activa `owner` para la tienda `bunker-burger`.

## Reglas

- Crear la cuenta manualmente en el proyecto Supabase correcto, con email confirmado.
- Mantener exactamente un usuario de Auth y una membresía activa `owner` para `bunker-burger`.
- No habilitar registro público ni crear cuentas adicionales para este alcance.
- No autorizar mediante `user_metadata`; la aplicación usa `auth.uid()` y `admin_memberships`.
- No copiar UUIDs entre desarrollo y producción ni guardarlos en migraciones, código o documentación.
- No exponer una clave `service_role`/secret en el navegador.

## Verificación previa

Ejecutar en el SQL Editor del entorno correspondiente:

```sql
select
  (select count(*) from auth.users) as auth_user_count,
  (select count(*) from public.stores where slug = 'bunker-burger') as bunker_store_count,
  (select count(*)
   from public.admin_memberships am
   join public.stores s on s.id = am.store_id
   where s.slug = 'bunker-burger') as membership_count;
```

Continuar solo si hay exactamente un usuario, exactamente una tienda y ninguna membresía conflictiva.

## Crear o restaurar la membresía

Esta operación resuelve ambos UUID dentro del entorno; no se reemplazan a mano:

```sql
do $$
declare
  v_user_id uuid;
  v_store_id uuid;
begin
  if (select count(*) from auth.users) <> 1 then
    raise exception 'Expected exactly one Auth user';
  end if;
  if (select count(*) from public.stores where slug = 'bunker-burger') <> 1 then
    raise exception 'Expected exactly one bunker-burger store';
  end if;

  select id into v_user_id from auth.users;
  select id into v_store_id from public.stores where slug = 'bunker-burger';

  if exists (
    select 1 from public.admin_memberships
    where user_id = v_user_id and store_id <> v_store_id and is_active
  ) then
    raise exception 'The sole Auth user has a conflicting active membership';
  end if;

  insert into public.admin_memberships (store_id, user_id, role, is_active)
  values (v_store_id, v_user_id, 'owner', true)
  on conflict (store_id, user_id)
  do update set role = excluded.role, is_active = excluded.is_active;
end
$$;
```

Verificar que el resultado sea `1 / 1 / 1`:

```sql
select
  count(*) as membership_count,
  count(*) filter (where am.is_active) as active_membership_count,
  count(*) filter (where am.is_active and am.role = 'owner') as active_owner_count
from public.admin_memberships am
join public.stores s on s.id = am.store_id
where s.slug = 'bunker-burger';
```

Configurar el email y la contraseña únicamente como secretos del entorno de pruebas:

```text
SUPABASE_TEST_ADMIN_EMAIL
SUPABASE_TEST_ADMIN_PASSWORD
```

## Revocación

Para retirar acceso sin borrar la cuenta:

```sql
update public.admin_memberships am
set is_active = false
from public.stores s
where s.id = am.store_id
  and s.slug = 'bunker-burger';
```

Confirmar después que `/bunker/admin` redirige a `/bunker`. Para restaurar el acceso, repetir el bloque de aprovisionamiento.
