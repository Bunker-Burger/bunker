-- BB-13 / BB-10: payment methods carry no configurable public text.
-- store_payment_methods is readable by anonymous visitors once a method is enabled
-- (payment_methods_public_read), and BB-10 forbids publishing an alias or bank details: the
-- customer asks for them on WhatsApp. A filter on free text cannot tell an alias like
-- "bunkerburger" from any other word, so there is no free text: each method has one fixed name,
-- public_instructions is always empty, and what customers read is fixed copy in the app.
--
-- Data change, on purpose: rows that differ are set to the fixed values first (today the seed's
-- neutral instructions, e.g. "Abonás al recibir o retirar."), so whatever was typed there stops
-- being public. Nothing else changes: is_enabled and sort_order are kept; no table, policy or
-- grant changes.

update public.store_payment_methods
set
  display_name = case method
    when 'cash' then 'Efectivo'
    when 'bank_transfer' then 'Transferencia'
    when 'mercado_pago' then 'Mercado Pago'
  end,
  public_instructions = ''
where public_instructions <> ''
  or display_name is distinct from case method
    when 'cash' then 'Efectivo'
    when 'bank_transfer' then 'Transferencia'
    when 'mercado_pago' then 'Mercado Pago'
  end;

-- coalesce: a method added to the enum later has no name here and must be rejected, not let
-- through by a NULL comparison.
alter table public.store_payment_methods
  add constraint store_payment_methods_fixed_public_copy check (
    public_instructions = ''
    and coalesce(display_name = case method
      when 'cash' then 'Efectivo'
      when 'bank_transfer' then 'Transferencia'
      when 'mercado_pago' then 'Mercado Pago'
    end, false)
  );

comment on constraint store_payment_methods_fixed_public_copy on public.store_payment_methods is
  'BB-13/BB-10: publicly readable row, so no configurable text (never an alias or bank details). Mirrors PAYMENT_METHOD_NAME in src/domain/public-payment-options.ts.';
