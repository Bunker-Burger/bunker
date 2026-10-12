/*
 * BB-18 R1 H2: where a person exercises their data rights. It must keep working when the catalog
 * cannot be read, so besides the store's WhatsApp (from the catalog) there is a contact configured
 * on the server, provided and authorized by the owner. Nothing here is a default: without either,
 * the page says the channel is still pending.
 */

export interface PrivacyContact {
  /** Visible text: the number or address itself. */
  label: string;
  /** Actionable link: `https://wa.me/<digits>` or `mailto:<address>`. */
  href: string;
}

export interface PrivacyContactEnv {
  /** WhatsApp number authorized by the owner for privacy requests, E.164 (`+5493...`). */
  PRIVACY_CONTACT_WHATSAPP?: string | undefined;
  /** Email address authorized by the owner for privacy requests. */
  PRIVACY_CONTACT_EMAIL?: string | undefined;
}

/** Same rule as `stores.whatsapp_e164`. */
const E164 = /^\+[1-9][0-9]{7,14}$/;
/** Plain address: no spaces, quotes, angle brackets or URL syntax that could change the link. */
const EMAIL = /^[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}$/;

export function whatsappContact(e164: string | null | undefined): PrivacyContact | null {
  const number = e164?.trim() ?? "";
  return E164.test(number) ? { label: number, href: `https://wa.me/${number.slice(1)}` } : null;
}

export function emailContact(address: string | null | undefined): PrivacyContact | null {
  const email = address?.trim() ?? "";
  return email.length <= 254 && EMAIL.test(email) ? { label: email, href: `mailto:${email}` } : null;
}

/** The configured contact (WhatsApp first), or null when the owner has not provided a valid one. */
export function configuredPrivacyContact(env: PrivacyContactEnv): PrivacyContact | null {
  return whatsappContact(env.PRIVACY_CONTACT_WHATSAPP) ?? emailContact(env.PRIVACY_CONTACT_EMAIL);
}

/**
 * The store's WhatsApp when the catalog answered with a valid one; otherwise the configured
 * contact, which does not depend on the database; null only when neither exists.
 */
export function resolvePrivacyContact(storeWhatsapp: string | null, env: PrivacyContactEnv): PrivacyContact | null {
  return whatsappContact(storeWhatsapp) ?? configuredPrivacyContact(env);
}
