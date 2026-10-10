# Evidencia Auth del producto BB-11

`cloud/admin-auth-reviewed` sólo acredita la configuración del proyecto Supabase. No acredita Server Actions,
proxy, cookies SSR, layout ni navegación de la aplicación. La evidencia del producto se publica separadamente como
`cloud/admin-auth-product-reviewed`.

## Procedimiento de mantenedor

1. Esperar la revisión y eventual merge independiente del bootstrap #39. No ejecutar este procedimiento desde un
   workflow que sólo exista en la PR #37.
2. Inspeccionar el diff completo de la PR #37 y confirmar el SHA de HEAD. Crear un runner efímero aislado, sin
   artifacts compartidos, y clonar exactamente ese SHA; no ejecutar una rama móvil ni `pull/*/merge`.
3. Inyectar, sólo en el proceso del runner y después de la revisión humana, las variables del único owner del proyecto
   development: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_PROJECT_ENV=development`,
   `SUPABASE_TEST_ADMIN_EMAIL`, `SUPABASE_TEST_ADMIN_PASSWORD` y `SUPABASE_TEST_REQUIRE_CLOUD=1`. No crear usuarios,
   no escribir `.env.local`, no imprimir variables y no subir logs, screenshots, videos, traces ni reportes HTML.
4. Ejecutar en el SHA completo:

   ```text
   pnpm install --frozen-lockfile
   pnpm run test:integration:auth
   pnpm run test:e2e:admin-auth
   ```

   Ambos comandos deben terminar sin skips: integración Auth 2/2 y Playwright Auth 3/3. El config dedicado ya tiene
   retries, trace, screenshot, video y reporter HTML desactivados.
5. Para sensibilidad, antes de la corrida final aplicar una mutación temporal y local del login, del gate
   `admin_memberships` o del logout; comprobar que falla el caso correspondiente, revertirla y repetir la corrida con
   el árbol limpio. No publicar la mutación ni sus secretos.
6. Sólo el mantenedor publica el resultado, nunca el código de la PR, mediante el status del SHA completo:

   ```text
   gh api --method POST repos/Bunker-Burger/bunker/statuses/<SHA_COMPLETO> \
     -f state=success \
     -f context=cloud/admin-auth-product-reviewed \
     -f description="Auth product integration 2/2 + E2E 3/3 on exact reviewed SHA" \
     -f target_url="<URL_PRIVADA_DEL_RUNNER>"
   ```

   Ante cualquier fallo, skip, SHA distinto o duda sobre el aislamiento, publicar `failure` o no publicar status.

El CI de la PR exige este contexto exacto además de `cloud/admin-auth-reviewed` y `cloud/pgTAP-reviewed`. Un status de
otro SHA, una autodeclaración desde la PR o el probe REST del proveedor no desbloquean el merge.
