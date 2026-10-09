import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { authenticateStoreAdmin, signOutCurrentSession } from "@/server/auth/admin-session";
import { login, logout } from "./actions";

vi.mock("@/server/auth/admin-session", () => ({
  authenticateStoreAdmin: vi.fn(),
  signOutCurrentSession: vi.fn()
}));

vi.mock("next/navigation", () => ({
  redirect: vi.fn((path: string) => {
    throw new Error(`NEXT_REDIRECT:${path}`);
  })
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const authenticateMock = vi.mocked(authenticateStoreAdmin);
const signOutMock = vi.mocked(signOutCurrentSession);
const redirectMock = vi.mocked(redirect);
const initialState = { message: null };

function form(email: FormDataEntryValue, password: FormDataEntryValue, extra?: Record<string, string>) {
  const data = new FormData();
  data.set("email", email);
  data.set("password", password);
  for (const [key, value] of Object.entries(extra ?? {})) data.set(key, value);
  return data;
}

beforeEach(() => vi.clearAllMocks());

describe("login", () => {
  it("normalizes only the email and redirects an authorized owner to the fixed admin path", async () => {
    authenticateMock.mockResolvedValue({
      kind: "authorized",
      membership: { userId: "user-1", storeId: "store-1", role: "owner" }
    });

    await expect(
      login(initialState, form("  OWNER@Example.COM ", "  keep password spaces  ", { returnTo: "https://evil.example" }))
    ).rejects.toThrow("NEXT_REDIRECT:/bunker/admin");

    expect(authenticateMock).toHaveBeenCalledWith({
      email: "owner@example.com",
      password: "  keep password spaces  "
    });
    expect(redirectMock).toHaveBeenCalledWith("/bunker/admin");
  });

  it.each([
    ["missing email", null, "secret"],
    ["malformed email", "not-an-email", "secret"],
    ["whitespace email", "   ", "secret"],
    ["empty password", "owner@example.com", ""],
    ["whitespace password", "owner@example.com", "   "],
    ["oversized email", `${"a".repeat(310)}@example.com`, "secret"],
    ["oversized password", "owner@example.com", "x".repeat(1025)]
  ])("rejects %s without contacting Supabase", async (_case, email, password) => {
    const data = new FormData();
    if (email !== null) data.set("email", email);
    data.set("password", password);

    await expect(login(initialState, data)).resolves.toEqual({ message: "Email o contraseña incorrectos" });
    expect(authenticateMock).not.toHaveBeenCalled();
  });

  it("rejects non-string fields without contacting Supabase", async () => {
    await expect(login(initialState, form(new File(["x"], "email.txt"), "secret"))).resolves.toEqual({
      message: "Email o contraseña incorrectos"
    });
    expect(authenticateMock).not.toHaveBeenCalled();
  });

  it("uses the same public message for valid credentials without membership", async () => {
    authenticateMock.mockResolvedValue({ kind: "rejected" });

    await expect(login(initialState, form("memberless@example.com", "secret"))).resolves.toEqual({
      message: "Email o contraseña incorrectos"
    });
  });

  it("reports a temporary backend failure without exposing its cause", async () => {
    authenticateMock.mockResolvedValue({ kind: "unavailable" });

    await expect(login(initialState, form("owner@example.com", "secret"))).resolves.toEqual({
      message: "No pudimos iniciar sesión. Intentá nuevamente."
    });
    expect(redirectMock).not.toHaveBeenCalled();
  });
});

describe("logout", () => {
  it("signs out locally, purges authenticated views, and redirects to the fixed login path", async () => {
    signOutMock.mockResolvedValue();

    await expect(logout()).rejects.toThrow("NEXT_REDIRECT:/bunker");

    expect(signOutMock).toHaveBeenCalledOnce();
    expect(revalidatePath).toHaveBeenCalledWith("/", "layout");
    expect(redirectMock).toHaveBeenCalledWith("/bunker");
  });

  it("remains idempotent when the session is absent or signout fails", async () => {
    signOutMock.mockRejectedValue(new Error("session already absent"));

    await expect(logout()).rejects.toThrow("NEXT_REDIRECT:/bunker");

    expect(revalidatePath).toHaveBeenCalledWith("/", "layout");
    expect(redirectMock).toHaveBeenCalledWith("/bunker");
  });
});
