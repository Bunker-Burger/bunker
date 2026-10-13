import { render, screen } from "@testing-library/react";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getCurrentStoreAdmin } from "@/server/auth/admin-session";
import AdminLayout from "./layout";

vi.mock("@/server/auth/admin-session", () => ({ getCurrentStoreAdmin: vi.fn() }));
vi.mock("next/server", () => ({ connection: vi.fn(async () => undefined) }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn(() => {
    throw new Error("NEXT_REDIRECT:/bunker");
  }),
  usePathname: () => "/bunker/admin/tienda"
}));

const currentAdminMock = vi.mocked(getCurrentStoreAdmin);

beforeEach(() => vi.clearAllMocks());

describe("/bunker/admin layout", () => {
  it("renders children and the verified role without exposing session identifiers", async () => {
    currentAdminMock.mockResolvedValue({
      ok: true,
      value: { userId: "private-user-uuid", storeId: "private-store-uuid", role: "owner" }
    });

    render(await AdminLayout({ children: <div>Contenido privado</div> }));

    expect(connection).toHaveBeenCalledOnce();
    expect(screen.getByText("Contenido privado")).toBeInTheDocument();
    expect(screen.getByText("Dueño")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cerrar sesión" })).toBeInTheDocument();
    expect(screen.queryByText("private-user-uuid")).not.toBeInTheDocument();
    expect(screen.queryByText("private-store-uuid")).not.toBeInTheDocument();
    expect(document.body.textContent).not.toContain("token");
  });

  it("has no tab bar: the captures show none, the control panel links the other screens", async () => {
    currentAdminMock.mockResolvedValue({ ok: true, value: { userId: "u", storeId: "s", role: "admin" } });
    render(await AdminLayout({ children: <div /> }));
    expect(screen.queryByRole("navigation", { name: "Administración" })).toBeNull();
    expect(screen.getByRole("link", { name: "Admin" })).toHaveAttribute("href", "/bunker/admin");
  });

  it.each([
    ["missing session", "unauthorized" as const],
    ["expired or revoked session", "unauthorized" as const],
    ["inactive or cross-store membership", "unauthorized" as const],
    ["temporary backend failure", "unavailable" as const]
  ])("redirects %s before rendering private children", async (_case, code) => {
    currentAdminMock.mockResolvedValue({ ok: false, error: { code, message: "private failure details" } });

    await expect(AdminLayout({ children: <div>Contenido privado</div> })).rejects.toThrow("NEXT_REDIRECT:/bunker");
    expect(redirect).toHaveBeenCalledWith("/bunker");
    expect(screen.queryByText("Contenido privado")).not.toBeInTheDocument();
  });
});
