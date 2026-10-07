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
        blockerStates: ["OPEN"],
      }),
    ).toBe("Terminada");
  });

  it("preserves active work as in progress", () => {
    expect(
      deriveAvailability({
        issueState: "OPEN",
        status: "In Progress",
        blockerStates: ["CLOSED"],
      }),
    ).toBe("En curso");
  });

  it("marks an open issue as ready when every dependency is closed", () => {
    expect(
      deriveAvailability({
        issueState: "OPEN",
        status: "Todo",
        blockerStates: ["CLOSED", "CLOSED"],
      }),
    ).toBe("Lista");
  });

  it("marks an open issue without dependencies as ready", () => {
    expect(
      deriveAvailability({
        issueState: "OPEN",
        status: "Todo",
        blockerStates: [],
      }),
    ).toBe("Lista");
  });

  it("keeps an issue blocked while any dependency remains open", () => {
    expect(
      deriveAvailability({
        issueState: "OPEN",
        status: "Todo",
        blockerStates: ["CLOSED", "OPEN"],
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
          blockerStates: ["CLOSED"],
          status: "Done",
          availability: "Lista",
        },
        {
          itemId: "item-4",
          issueNumber: 4,
          repository: "Bunker-Burger/bunker",
          issueState: "OPEN",
          blockerStates: ["CLOSED"],
          status: "Todo",
          availability: "Bloqueada",
        },
        {
          itemId: "already-correct",
          issueNumber: 5,
          repository: "Bunker-Burger/bunker",
          issueState: "OPEN",
          blockerStates: ["OPEN"],
          status: "Todo",
          availability: "Bloqueada",
        },
        {
          itemId: "foreign-item",
          issueNumber: 99,
          repository: "another/repository",
          issueState: "CLOSED",
          blockerStates: [],
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
  it("extracts real issue state, blockers and project fields from GraphQL data", () => {
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
              blockedBy: { nodes: [{ state: "CLOSED" }] },
            },
            fieldValues: {
              nodes: [
                { name: "Todo", field: { name: "Status" } },
                { name: "Bloqueada", field: { name: "Disponibilidad" } },
              ],
            },
          },
          { id: "draft", content: { __typename: "DraftIssue" }, fieldValues: { nodes: [] } },
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
          blockerStates: ["CLOSED"],
          status: "Todo",
          availability: "Bloqueada",
        },
      ],
    });
  });
});
