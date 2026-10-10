import { afterEach, describe, expect, it, vi } from "vitest";
// The trusted harness is plain Node ESM so it can run from main without installing app code.
// @ts-expect-error The JavaScript module carries its own runtime contract and is tested below.
import { extractActionsRunId, isAuthorizedStatus, isBunkerOwner, isTrustedActionsRun, run, selectLatestStatus } from "../../../scripts/check-admin-auth-cloud.mjs";

const env = {
  NEXT_PUBLIC_SUPABASE_URL: "https://abcdefghijklmnopqrst.supabase.co",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
  SUPABASE_TEST_ADMIN_EMAIL: "owner@example.com",
  SUPABASE_TEST_ADMIN_PASSWORD: "password-that-never-logs",
  EXPECTED_PROJECT_REF: "abcdefghijklmnopqrst"
};

afterEach(() => vi.restoreAllMocks());

describe("trusted Auth cloud harness", () => {
  it.each([
    ["bunker owner", [{ role: "owner", is_active: true, stores: { slug: "bunker-burger" } }], true],
    ["other store owner", [{ role: "owner", is_active: true, stores: { slug: "other-store" } }], false],
    ["inactive bunker owner", [{ role: "owner", is_active: false, stores: { slug: "bunker-burger" } }], false],
    ["missing membership", [], false]
  ])("accepts only the active bunker-burger owner (%s)", (_name, rows, expected) => {
    expect(isBunkerOwner(rows)).toBe(expected);
  });

  it("uses local logout, checks HTTP 204, and filters the bunker store", async () => {
    const calls: Array<{ url: string; init?: RequestInit | undefined }> = [];
    const fakeFetch = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      if (url.includes("/token?grant_type=password") && JSON.parse(String(init?.body)).password.endsWith("-invalid")) return new Response("{}", { status: 400 });
      if (url.includes("/token?grant_type=password")) return new Response(JSON.stringify({ access_token: "access-token", user: { id: "user-id" } }), { status: 200 });
      if (url.includes("admin_memberships")) return new Response(JSON.stringify([{ role: "owner", is_active: true, stores: { slug: "bunker-burger" } }]), { status: 200 });
      if (url.includes("/auth/v1/logout")) return new Response(null, { status: 204 });
      throw new Error(`unexpected URL ${url}`);
    });

    await expect(run(fakeFetch, env, false)).resolves.toMatchObject({ passed: true });
    const membershipCall = calls.find((call) => call.url.includes("admin_memberships"));
    expect(membershipCall?.url).toContain("stores!inner(slug)");
    expect(membershipCall?.url).toContain("stores.slug=eq.bunker-burger");
    const logoutCall = calls.find((call) => call.url.includes("/auth/v1/logout"));
    expect(logoutCall?.url).toBe("https://abcdefghijklmnopqrst.supabase.co/auth/v1/logout?scope=local");
    expect(logoutCall?.init?.method).toBe("POST");
    expect(logoutCall?.init?.headers).toMatchObject({ Authorization: "Bearer access-token" });
  });

  it("fails when local logout is not confirmed with HTTP 204", async () => {
    const fakeFetch = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes("/token?grant_type=password") && JSON.parse(String(init?.body)).password.endsWith("-invalid")) return new Response("{}", { status: 400 });
      if (url.includes("/token?grant_type=password")) return new Response(JSON.stringify({ access_token: "access-token", user: { id: "user-id" } }), { status: 200 });
      if (url.includes("admin_memberships")) return new Response(JSON.stringify([{ role: "owner", is_active: true, stores: { slug: "bunker-burger" } }]), { status: 200 });
      return new Response(null, { status: 500 });
    });

    await expect(run(fakeFetch, env, false)).resolves.toMatchObject({ passed: false });
  });

  describe("GitHub status provenance fixtures", () => {
    const repository = "Bunker-Burger/bunker";
    const reviewedSha = "a".repeat(40);
    const workflow = ".github/workflows/admin-auth-reviewed.yml";
    const runUrl = `https://github.com/${repository}/actions/runs/123456789`;
    const successRun = {
      head_sha: reviewedSha,
      status: "completed",
      conclusion: "success",
      path: workflow
    };
    const successStatus = {
      context: "cloud/admin-auth-reviewed",
      state: "success",
      creator: { login: "github-actions[bot]" },
      target_url: runUrl,
      updated_at: "2026-10-09T12:00:00Z"
    };

    it("accepts the newest status from the real statuses endpoint shape", () => {
      const combinedStatus = {
        state: "success",
        total_count: 1,
        statuses: []
      };
      const statuses = [
        successStatus,
        { ...successStatus, state: "failure", updated_at: "2026-10-09T11:00:00Z" },
        { ...successStatus, context: "cloud/pgTAP-reviewed" }
      ];
      expect(selectLatestStatus(statuses, "cloud/admin-auth-reviewed")).toBe(successStatus);
      expect(selectLatestStatus(statuses, "cloud/missing")).toBeNull();
      expect("sha" in combinedStatus).toBe(false);
      expect("creator" in combinedStatus).toBe(false);
      expect(successStatus.creator.login).toBe("github-actions[bot]");
    });

    it.each([
      ["success", successStatus, successRun, "github-actions[bot]", true],
      ["missing", null, successRun, "github-actions[bot]", false],
      ["failure", { ...successStatus, state: "failure" }, successRun, "github-actions[bot]", false],
      ["stale run SHA", successStatus, { ...successRun, head_sha: "b".repeat(40) }, "github-actions[bot]", false],
      ["wrong URL", { ...successStatus, target_url: `https://example.test/${reviewedSha}` }, successRun, "github-actions[bot]", false],
      ["wrong workflow", successStatus, { ...successRun, path: ".github/workflows/other.yml" }, "github-actions[bot]", false],
      ["incomplete run", successStatus, { ...successRun, status: "in_progress" }, "github-actions[bot]", false],
      ["untrusted creator", { ...successStatus, creator: { login: "triager" } }, successRun, "triager", false],
      ["maintainer creator", { ...successStatus, creator: { login: "maintainer" } }, successRun, "maintain", true]
    ])("rejects or accepts provenance fixture: %s", (_name, status, runData, permission, expected) => {
      expect(isAuthorizedStatus({
        status,
        run: runData,
        repository,
        expectedSha: reviewedSha,
        expectedWorkflow: workflow,
        creatorPermission: permission
      })).toBe(expected);
    });

    it("requires a numeric Actions run URL tied to the repository", () => {
      expect(extractActionsRunId(runUrl, repository)).toBe("123456789");
      expect(extractActionsRunId(`${runUrl}/attempts/2`, repository)).toBeNull();
      expect(extractActionsRunId(`https://github.com/other/repo/actions/runs/123456789`, repository)).toBeNull();
      expect(extractActionsRunId("https://github.com/Bunker-Burger/bunker/actions/runs/not-a-number", repository)).toBeNull();
    });

    it("does not treat an older success as current after a newer failure", () => {
      const statuses = [
        { ...successStatus, state: "failure", updated_at: "2026-10-09T13:00:00Z" },
        successStatus
      ];
      const newest = selectLatestStatus(statuses, successStatus.context);
      expect(isAuthorizedStatus({
        status: newest,
        run: successRun,
        repository,
        expectedSha: reviewedSha,
        expectedWorkflow: workflow
      })).toBe(false);
    });

    it("keeps the run checks sensitive to a wrong SHA", () => {
      expect(isTrustedActionsRun(successRun, reviewedSha, workflow)).toBe(true);
      expect(isTrustedActionsRun(successRun, "c".repeat(40), workflow)).toBe(false);
    });
  });
});
