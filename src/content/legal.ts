/*
 * BB-18: facts the legal pages state, kept in one place so they cannot drift apart.
 * Nothing here is approved yet: the owner, a lawyer and the accountant must review the texts
 * (docs/legal/bb-18-lanzamiento.md). Until then every page says so.
 */

/** Days a Mercado Pago attempt (name, phone, payment status) is kept: `private.purge_expired_payment_data`. */
export const PAYMENT_DATA_RETENTION_DAYS = 90;

/** Date of the current version of the texts, shown on every page. */
export const LEGAL_TEXTS_UPDATED_AT = "11 de octubre de 2026";

/**
 * Review state. `approved` only turns true with the owner's written approval, recorded in
 * docs/legal/bb-18-lanzamiento.md; never set it to make the banner go away.
 */
export const LEGAL_REVIEW = { approved: false } as const;

/**
 * Legal identity of the business (Ley 24.240 and Res. 104/2005 for online sales). Only the owner
 * can provide it; null is shown as pending, never invented.
 */
export const LEGAL_OWNER: { legalName: string | null; taxId: string | null; address: string | null } = {
  legalName: null,
  taxId: null,
  address: null
};

export const LEGAL_PAGES = [
  { href: "/legal/terminos", label: "Términos" },
  { href: "/legal/privacidad", label: "Privacidad" },
  { href: "/legal/cancelaciones", label: "Cancelaciones y devoluciones" }
] as const;

/** Shown in the menu and repeated in the terms: the menu carries no allergen information. */
export const ALLERGEN_NOTICE =
  "La carta no informa alérgenos. Si tenés alguna alergia o intolerancia, consultá al local por WhatsApp antes de pedir.";
