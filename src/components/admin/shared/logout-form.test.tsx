import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { purgeSessionCaches } from "@/lib/session-caches";
import { logout } from "@/app/bunker/actions";
import { LogoutForm } from "./logout-form";

vi.mock("@/app/bunker/actions", () => ({ logout: vi.fn(async () => undefined) }));
vi.mock("@/lib/session-caches", () => ({ purgeSessionCaches: vi.fn(async () => undefined) }));

beforeEach(() => vi.clearAllMocks());

describe("LogoutForm", () => {
  it("clears this browser's session caches before signing out", async () => {
    const order: string[] = [];
    vi.mocked(purgeSessionCaches).mockImplementation(async () => void order.push("purge"));
    vi.mocked(logout).mockImplementation(async () => void order.push("logout") as never);
    render(<LogoutForm buttonClassName="x" />);
    await userEvent.setup().click(screen.getByRole("button", { name: "Cerrar sesión" }));
    await waitFor(() => expect(order).toEqual(["purge", "logout"]));
  });

  it("signs out even when the caches cannot be cleared", async () => {
    vi.mocked(purgeSessionCaches).mockRejectedValue(new Error("SecurityError"));
    render(<LogoutForm />);
    await userEvent.setup().click(screen.getByRole("button", { name: "Cerrar sesión" }));
    await waitFor(() => expect(logout).toHaveBeenCalledTimes(1));
  });
});
