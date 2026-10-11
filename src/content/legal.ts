/*
 * BB-18: facts the legal pages state, kept in one place so they cannot drift apart.
 * Nothing here is approved yet: the owner, a lawyer and the accountant must review the texts
 * (docs/legal/bb-18-lanzamiento.md). Until then every page says so.
 */

/** Age at which a Mercado Pago attempt (name, phone, payment status) becomes due: `private.purge_expired_payment_data`. */
export const PAYMENT_DATA_RETENTION_DAYS = 90;

/**
 * How that data actually goes (BB-18 R1 H1): a daily job (`bb15-purge-expired-payment-data`, pg_cron)
 * deletes what is older than the retention, so a record outlives day 90 until the next run. The
 * same sentence goes in the privacy policy and next to the checkout fields; it promises no exact
 * instant and no maximum, which would depend on the job running and being monitored.
 */
export const PAYMENT_DATA_RETENTION_NOTICE =
  `Se eliminan en una purga diaria de los registros con más de ${PAYMENT_DATA_RETENTION_DAYS} días, ` +
  "así que pueden seguir guardados hasta la purga siguiente: no se borran en el instante exacto en que se cumple el plazo.";

/** Date of the current version of the texts, shown on every page. */
export const LEGAL_TEXTS_UPDATED_AT = "11 de octubre de 2026";

/**
 * Review state. `approved` only turns true with the owner's written approval, recorded in
 * docs/legal/bb-18-lanzamiento.md; never set it to make the banner go away.
 */
export const LEGAL_REVIEW = { approved: false } as const;

/** Search engines skip the legal pages until the texts are approved. */
export const LEGAL_ROBOTS = LEGAL_REVIEW.approved ? { index: true, follow: true } : { index: false, follow: false };

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
