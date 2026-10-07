import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  deriveAvailability,
  parseProjectSnapshot,
  planAvailabilityUpdates,
} from "@/automation/project-readiness";

describe("deriveAvailability", () => {
  it("marks a closed issue as finished regardless of stale project fields", () => {
    expect(
      deriveAvailability({
        issueState: "CLOSED",
        status: "Todo",
        openBlockerCount: 1,
      }),
    ).toBe("Terminada");
  });

  it("preserves active work as in progress", () => {
    expect(
      deriveAvailability({
        issueState: "OPEN",
        status: "In Progress",
        openBlockerCount: 1,
      }),
    ).toBe("En curso");
  });

  it("marks an open issue as ready when the dependency summary has no open blockers", () => {
    expect(
      deriveAvailability({
        issueState: "OPEN",
        status: "Todo",
        openBlockerCount: 0,
      }),
    ).toBe("Lista");
  });

  it("marks an open issue without dependencies as ready", () => {
    expect(
      deriveAvailability({
        issueState: "OPEN",
        status: "Todo",
        openBlockerCount: 0,
      }),
    ).toBe("Lista");
  });

  it("keeps an issue blocked when the complete summary reports an open blocker", () => {
    expect(
      deriveAvailability({
        issueState: "OPEN",
        status: "Todo",
        openBlockerCount: 1,
      }),
    ).toBe("Bloqueada");
  });
});

describe("planAvailabilityUpdates", () => {
  it("returns only stale issues from the configured repository", () => {
    const updates = planAvailabilityUpdates(
      [
        {
          itemId: "item-3",
          issueNumber: 3,
          repository: "Bunker-Burger/bunker",
          issueState: "CLOSED",
          openBlockerCount: 0,
          status: "Done",
          availability: "Lista",
        },
        {
          itemId: "item-4",
          issueNumber: 4,
          repository: "Bunker-Burger/bunker",
          issueState: "OPEN",
          openBlockerCount: 0,
          status: "Todo",
          availability: "Bloqueada",
        },
        {
          itemId: "already-correct",
          issueNumber: 5,
          repository: "Bunker-Burger/bunker",
          issueState: "OPEN",
          openBlockerCount: 1,
          status: "Todo",
          availability: "Bloqueada",
        },
        {
          itemId: "foreign-item",
          issueNumber: 99,
          repository: "another/repository",
          issueState: "CLOSED",
          openBlockerCount: 0,
          status: "Done",
          availability: "Lista",
        },
      ],
      "Bunker-Burger/bunker",
    );

    expect(updates).toEqual([
      { itemId: "item-3", issueNumber: 3, from: "Lista", to: "Terminada" },
      { itemId: "item-4", issueNumber: 4, from: "Bloqueada", to: "Lista" },
    ]);
  });
});

describe("parseProjectSnapshot", () => {
  it("extracts the complete blocker summary and named project fields", () => {
    const snapshot = parseProjectSnapshot({
      id: "project-id",
      fields: {
        nodes: [
          {
            id: "availability-field",
            name: "Disponibilidad",
            options: [
              { id: "ready-option", name: "Lista" },
              { id: "blocked-option", name: "Bloqueada" },
              { id: "active-option", name: "En curso" },
              { id: "finished-option", name: "Terminada" },
            ],
          },
        ],
      },
      items: {
        nodes: [
          {
            id: "item-4",
            content: {
              __typename: "Issue",
              number: 4,
              state: "OPEN",
              repository: { nameWithOwner: "Bunker-Burger/bunker" },
              issueDependenciesSummary: { blockedBy: 1, totalBlockedBy: 101 },
            },
            statusField: { name: "Todo" },
            availabilityField: { name: "Lista" },
          },
          {
            id: "item-5",
            content: {
              __typename: "Issue",
              number: 5,
              state: "OPEN",
              repository: { nameWithOwner: "Bunker-Burger/bunker" },
              issueDependenciesSummary: { blockedBy: 0, totalBlockedBy: 0 },
            },
            statusField: { name: "In Progress" },
            availabilityField: { name: "Lista" },
          },
          { id: "draft", content: { __typename: "DraftIssue" } },
        ],
      },
    });

    expect(snapshot).toEqual({
      projectId: "project-id",
      availabilityFieldId: "availability-field",
      optionIds: {
        Lista: "ready-option",
        Bloqueada: "blocked-option",
        "En curso": "active-option",
        Terminada: "finished-option",
      },
      items: [
        {
          itemId: "item-4",
          issueNumber: 4,
          repository: "Bunker-Burger/bunker",
          issueState: "OPEN",
          openBlockerCount: 1,
          status: "Todo",
          availability: "Lista",
        },
        {
          itemId: "item-5",
          issueNumber: 5,
          repository: "Bunker-Burger/bunker",
          issueState: "OPEN",
          openBlockerCount: 0,
          status: "In Progress",
          availability: "Lista",
        },
      ],
    });

    expect(
      planAvailabilityUpdates(snapshot.items, "Bunker-Burger/bunker"),
    ).toEqual([
      { itemId: "item-4", issueNumber: 4, from: "Lista", to: "Bloqueada" },
      { itemId: "item-5", issueNumber: 5, from: "Lista", to: "En curso" },
    ]);
  });

  it("queries complete dependency counts and fields by name instead of truncated connections", () => {
    const source = readFileSync(
      resolve(process.cwd(), "src/automation/project-readiness.ts"),
      "utf8",
    );

    expect(source).toContain("issueDependenciesSummary");
    expect(source).not.toMatch(/blockedBy\s*\(\s*first\s*:/);
    expect(source).not.toMatch(/fieldValues\s*\(\s*first\s*:/);
    expect(source).toContain('statusField: fieldValueByName(name: "Status")');
    expect(source).toContain(
      'availabilityField: fieldValueByName(name: "Disponibilidad")',
    );
  });
});
