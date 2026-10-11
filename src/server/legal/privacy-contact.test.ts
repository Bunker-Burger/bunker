import { describe, expect, it } from "vitest";
import { configuredPrivacyContact, emailContact, resolvePrivacyContact, whatsappContact } from "./privacy-contact";

/* Fixture values only: no real contact of the owner is known yet. */

describe("privacy contact (BB-18 R1 H2)", () => {
  it("links a valid E.164 WhatsApp number", () => {
    expect(whatsappContact(" +5491100000000 ")).toEqual({ label: "+5491100000000", href: "https://wa.me/5491100000000" });
  });

  it.each(["", "5491100000000", "+0491100000000", "+54 9 11 0000", "javascript:alert(1)", "+5491100000000/../x"])(
    "rejects %j as a WhatsApp number",
    (value) => {
      expect(whatsappContact(value)).toBeNull();
    }
  );

  it("links a plain email address", () => {
    expect(emailContact("privacidad@example.com")).toEqual({ label: "privacidad@example.com", href: "mailto:privacidad@example.com" });
  });

  it.each(["", "sin-arroba", "a@b", "a@b.com?bcc=x@y.com", "a b@c.com", "\"a\"@b.com", "<a@b.com>", "javascript:a@b.com"])(
    "rejects %j as an email",
    (value) => {
      expect(emailContact(value)).toBeNull();
    }
  );

  it("configured contact: WhatsApp first, then email, else none", () => {
    expect(configuredPrivacyContact({ PRIVACY_CONTACT_WHATSAPP: "+5491100000000", PRIVACY_CONTACT_EMAIL: "p@example.com" })?.label).toBe("+5491100000000");
    expect(configuredPrivacyContact({ PRIVACY_CONTACT_EMAIL: "p@example.com" })?.label).toBe("p@example.com");
    expect(configuredPrivacyContact({})).toBeNull();
  });

  it("the store's WhatsApp wins when the catalog gave one; the configured contact covers its absence", () => {
    const env = { PRIVACY_CONTACT_EMAIL: "p@example.com" };
    expect(resolvePrivacyContact("+5493865207458", env)?.label).toBe("+5493865207458");
    expect(resolvePrivacyContact(null, env)?.label).toBe("p@example.com");
    expect(resolvePrivacyContact(null, {})).toBeNull();
  });
});
