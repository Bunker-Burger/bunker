import { catalogError } from "./errors";
import { membershipForStore, type AdminAccessGate, type AdminMembership } from "./admin-access";

export type InMemorySession = { userId: string; expired?: boolean } | null;

export interface InMemoryMembership {
  userId: string;
  storeId: string;
  storeSlug: string;
  role: AdminMembership["role"];
  active: boolean;
}

/**
 * Admin gate over plain data, injected in unit tests: models no session, an expired session
 * and the membership table, and decides with the same `membershipForStore` as production.
 */
export function createInMemoryAdminAccess(session: InMemorySession, memberships: InMemoryMembership[]): AdminAccessGate {
  return {
    async requireStoreAdmin(storeSlug) {
      if (!session) return catalogError("unauthorized", "auth.getUser: no valid session (Auth session missing!)");
      if (session.expired) return catalogError("unauthorized", "auth.getUser: no valid session (session expired)");
      const rows = memberships
        .filter((membership) => membership.userId === session.userId)
        .map((membership) => ({
          store_id: membership.storeId,
          role: membership.role,
          is_active: membership.active,
          stores: { slug: membership.storeSlug }
        }));
      return membershipForStore(session.userId, rows, storeSlug);
    }
  };
}
