import { render, screen } from "@testing-library/react";
import { redirect } from "next/navigation";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getCurrentStoreAdmin } from "@/server/auth/admin-session";
import BunkerLoginPage from "./page";

vi.mock("@/server/auth/admin-session", () => ({ getCurrentStoreAdmin: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn(() => {
    throw new Error("NEXT_REDIRECT:/bunker/admin");
  })
}));

const currentAdminMock = vi.mocked(getCurrentStoreAdmin);

beforeEach(() => vi.clearAllMocks());

describe("/bunker", () => {
  it("redirects an already-authorized member to the fixed admin path", async () => {
    currentAdminMock.mockResolvedValue({
      ok: true,
      value: { userId: "private-user-id", storeId: "store-1", role: "owner" }
    });

    await expect(BunkerLoginPage()).rejects.toThrow("NEXT_REDIRECT:/bunker/admin");
    expect(redirect).toHaveBeenCalledWith("/bunker/admin");
  });

  it.each([
    ["no session", { ok: false as const, error: { code: "unauthorized" as const, message: "no session" } }],
    ["backend unavailable", { ok: false as const, error: { code: "unavailable" as const, message: "database details" } }]
  ])("renders only the login for %s", async (_case, result) => {
    currentAdminMock.mockResolvedValue(result);

    render(await BunkerLoginPage());

    expect(screen.getByRole("heading", { name: "Administración" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Ingresar" })).toBeInTheDocument();
    expect(screen.queryByText("private-user-id")).not.toBeInTheDocument();
    expect(screen.queryByText("database details")).not.toBeInTheDocument();
  });
});
