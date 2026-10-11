import type { SupabaseClient } from "@supabase/supabase-js";
import { vi } from "vitest";
import type { Database } from "@/server/supabase/database.types";

/*
 * Test-only: a Supabase client whose PostgREST/Storage transport is faked. Every `from(table)`
 * chain is recorded as a call with its operations (an `rpc(fn, args)` as table `rpc:<fn>` with
 * one `rpc` operation), and `reply` decides what it resolves to.
 */

export interface Call {
  table: string;
  ops: unknown[][];
}

export type Reply = { data?: unknown; error?: unknown; status?: number } | Error;

export function fakeClient(reply: (call: Call) => Reply) {
  const calls: Call[] = [];
  const storage = {
    upload: vi.fn<(path: string, body: Uint8Array, options: object) => Promise<{ data: object; error: unknown }>>(async () => ({ data: {}, error: null })),
    remove: vi.fn<(paths: string[]) => Promise<{ data: unknown[]; error: unknown }>>(async () => ({ data: [], error: null }))
  };
  function chain(call: Call) {
    calls.push(call);
    const builder: Record<string, unknown> = new Proxy(
      {},
      {
        get(_target, prop) {
          if (prop === "then") {
            return (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => {
              const result = reply(call);
              return result instanceof Error ? Promise.reject(result).then(resolve, reject) : Promise.resolve({ data: null, error: null, status: 200, ...result }).then(resolve, reject);
            };
          }
          return (...args: unknown[]) => {
            call.ops.push([prop, ...args]);
            return builder;
          };
        }
      }
    );
    return builder;
  }
  const client = {
    from: (table: string) => chain({ table, ops: [] }),
    rpc: (fn: string, args: unknown) => chain({ table: `rpc:${fn}`, ops: [["rpc", args]] }),
    storage: { from: vi.fn(() => storage) }
  };
  return { client: client as unknown as SupabaseClient<Database>, calls, storage };
}

export const op = (call: Call | undefined, name: string) => call?.ops.filter((entry) => entry[0] === name) ?? [];
