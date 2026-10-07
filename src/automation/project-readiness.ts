import { pathToFileURL } from "node:url";

export type Availability = "Lista" | "Bloqueada" | "En curso" | "Terminada";
export type IssueState = "OPEN" | "CLOSED";

type AvailabilityInput = {
  issueState: IssueState;
  status?: string;
  blockerStates: IssueState[];
};

export type ProjectIssueSnapshot = AvailabilityInput & {
  itemId: string;
  issueNumber: number;
  repository: string;
  availability?: Availability;
};

export type AvailabilityUpdate = {
  itemId: string;
  issueNumber: number;
  from: Availability | undefined;
  to: Availability;
};

type GraphField = {
  id?: string;
  name?: string;
  options?: Array<{ id?: string; name?: string }>;
};

type GraphFieldValue = {
  name?: string;
  field?: { name?: string };
};

type GraphProjectItem = {
  id?: string;
  content?: {
    __typename?: string;
    number?: number;
    state?: IssueState;
    repository?: { nameWithOwner?: string };
    blockedBy?: { nodes?: Array<{ state?: IssueState }> };
  };
  fieldValues?: { nodes?: GraphFieldValue[] };
};

type GraphProject = {
  id?: string;
  fields?: { nodes?: GraphField[] };
  items?: { nodes?: GraphProjectItem[] };
};

const availabilityValues: Availability[] = ["Lista", "Bloqueada", "En curso", "Terminada"];

export function deriveAvailability({
  issueState,
  status,
  blockerStates,
}: AvailabilityInput): Availability {
  if (issueState === "CLOSED") return "Terminada";
  if (status === "In Progress") return "En curso";
  return blockerStates.every((state) => state === "CLOSED") ? "Lista" : "Bloqueada";
}

export function planAvailabilityUpdates(
  items: ProjectIssueSnapshot[],
  repository: string,
): AvailabilityUpdate[] {
  return items.flatMap((item) => {
    if (item.repository !== repository) return [];

    const desired = deriveAvailability(item);
    if (desired === item.availability) return [];

    return [
      {
        itemId: item.itemId,
        issueNumber: item.issueNumber,
        from: item.availability,
        to: desired,
      },
    ];
  });
}

export function parseProjectSnapshot(project: GraphProject) {
  if (!project.id) throw new Error("GitHub no devolvió el ID del Project.");

  const availabilityField = project.fields?.nodes?.find(
    (field) => field.name === "Disponibilidad",
  );
  if (!availabilityField?.id) {
    throw new Error('El Project no contiene el campo single-select "Disponibilidad".');
  }

  const optionIds = Object.fromEntries(
    availabilityValues.map((value) => {
      const option = availabilityField.options?.find((candidate) => candidate.name === value);
      if (!option?.id) throw new Error(`Falta la opción de Disponibilidad "${value}".`);
      return [value, option.id];
    }),
  ) as Record<Availability, string>;

  const items = (project.items?.nodes ?? []).flatMap<ProjectIssueSnapshot>((item) => {
    const content = item.content;
    if (
      !item.id ||
      content?.__typename !== "Issue" ||
      typeof content.number !== "number" ||
      !content.state ||
      !content.repository?.nameWithOwner
    ) {
      return [];
    }

    const values = content.blockedBy?.nodes ?? [];
    const blockerStates = values.flatMap<IssueState>((blocker) =>
      blocker.state ? [blocker.state] : [],
    );
    const fields = item.fieldValues?.nodes ?? [];
    const status = fields.find((value) => value.field?.name === "Status")?.name;
    const availability = fields.find(
      (value) => value.field?.name === "Disponibilidad",
    )?.name as Availability | undefined;

    return [
      {
        itemId: item.id,
        issueNumber: content.number,
        repository: content.repository.nameWithOwner,
        issueState: content.state,
        blockerStates,
        ...(status ? { status } : {}),
        ...(availability ? { availability } : {}),
      },
    ];
  });

  return {
    projectId: project.id,
    availabilityFieldId: availabilityField.id,
    optionIds,
    items,
  };
}

type GraphResponse<T> = {
  data?: T;
  errors?: Array<{ message: string }>;
};

const projectQuery = `
  query ProjectReadiness($organization: String!, $projectNumber: Int!) {
    organization(login: $organization) {
      projectV2(number: $projectNumber) {
        id
        fields(first: 100) {
          nodes {
            ... on ProjectV2SingleSelectField {
              id
              name
              options { id name }
            }
          }
        }
        items(first: 100) {
          pageInfo { hasNextPage }
          nodes {
            id
            content {
              __typename
              ... on Issue {
                number
                state
                repository { nameWithOwner }
                blockedBy(first: 50) {
                  nodes { state }
                }
              }
            }
            fieldValues(first: 50) {
              nodes {
                ... on ProjectV2ItemFieldSingleSelectValue {
                  name
                  field {
                    ... on ProjectV2SingleSelectField { name }
                  }
                }
              }
            }
          }
        }
      }
    }
  }
`;

const updateMutation = `
  mutation UpdateAvailability(
    $projectId: ID!
    $itemId: ID!
    $fieldId: ID!
    $optionId: String!
  ) {
    updateProjectV2ItemFieldValue(
      input: {
        projectId: $projectId
        itemId: $itemId
        fieldId: $fieldId
        value: { singleSelectOptionId: $optionId }
      }
    ) {
      projectV2Item { id }
    }
  }
`;

async function githubGraphql<T>(
  token: string,
  query: string,
  variables: Record<string, unknown>,
): Promise<T> {
  const response = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "X-GitHub-Api-Version": "2026-03-10",
    },
    body: JSON.stringify({ query, variables }),
  });

  const payload = (await response.json()) as GraphResponse<T>;
  if (!response.ok || payload.errors?.length) {
    const details = payload.errors?.map((error) => error.message).join("; ") ?? response.statusText;
    throw new Error(`GitHub GraphQL rechazó la sincronización: ${details}`);
  }
  if (!payload.data) throw new Error("GitHub GraphQL respondió sin datos.");
  return payload.data;
}

export async function syncProjectReadiness({
  token,
  organization,
  projectNumber,
  repository,
}: {
  token: string;
  organization: string;
  projectNumber: number;
  repository: string;
}): Promise<AvailabilityUpdate[]> {
  const data = await githubGraphql<{
    organization?: {
      projectV2?: GraphProject & { items?: { pageInfo?: { hasNextPage?: boolean } } };
    };
  }>(token, projectQuery, { organization, projectNumber });
  const project = data.organization?.projectV2;
  if (!project) throw new Error(`No se encontró ${organization} Project #${projectNumber}.`);
  if (project.items?.pageInfo?.hasNextPage) {
    throw new Error("El Project superó 100 elementos; agregá paginación antes de continuar.");
  }

  const snapshot = parseProjectSnapshot(project);
  const updates = planAvailabilityUpdates(snapshot.items, repository);

  for (const update of updates) {
    await githubGraphql(token, updateMutation, {
      projectId: snapshot.projectId,
      itemId: update.itemId,
      fieldId: snapshot.availabilityFieldId,
      optionId: snapshot.optionIds[update.to],
    });
    console.log(
      `BB-${String(update.issueNumber).padStart(2, "0")}: ${update.from ?? "sin valor"} → ${update.to}`,
    );
  }

  console.log(
    updates.length === 0
      ? "El Board ya estaba sincronizado."
      : `Board sincronizado: ${updates.length} tarea(s) actualizada(s).`,
  );
  return updates;
}

async function main() {
  const token = process.env.PROJECT_SYNC_TOKEN;
  if (!token) throw new Error("Falta el secret PROJECT_SYNC_TOKEN.");

  await syncProjectReadiness({
    token,
    organization: process.env.PROJECT_ORGANIZATION ?? "Bunker-Burger",
    projectNumber: Number(process.env.PROJECT_NUMBER ?? "1"),
    repository: process.env.PROJECT_REPOSITORY ?? "Bunker-Burger/bunker",
  });
}

const isEntrypoint = process.argv[1]
  ? import.meta.url === pathToFileURL(process.argv[1]).href
  : false;

if (isEntrypoint) await main();
