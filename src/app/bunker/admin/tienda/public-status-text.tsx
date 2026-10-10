"use client";

import type { PublicStoreStatus } from "@/domain/store-status";
import { describeStoreStatus } from "@/components/storefront/use-store-status";

/** The exact sentence the storefront shows for this status. */
export function PublicStatusText({ status }: { status: PublicStoreStatus }) {
  return <>{describeStoreStatus({ kind: "ready", status, checking: false })}</>;
}
