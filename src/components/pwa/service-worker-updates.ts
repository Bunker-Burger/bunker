/*
 * Service worker registration with a safe update (BB-16). A new version installs in the
 * background and waits; it only takes over when the person accepts, and then the page reloads so
 * the shell and its assets always come from the same build.
 */

export const SKIP_WAITING = { type: "SKIP_WAITING" } as const;

type Worker = Pick<ServiceWorker, "state" | "postMessage" | "addEventListener">;

interface Registration {
  waiting: Worker | null;
  installing: Worker | null;
  addEventListener(type: "updatefound", listener: () => void): void;
}

export interface WorkerContainer {
  controller: unknown;
  register(url: string, options: RegistrationOptions): Promise<Registration>;
  addEventListener(type: "controllerchange", listener: () => void): void;
}

export interface UpdateCallbacks {
  /** A new version is installed and waiting; `apply` activates it. */
  onUpdateReady(apply: () => void): void;
  /** The page now runs under a new version (accepted here or in another tab). */
  onControllerChange(acceptedHere: boolean): void;
}

export async function registerServiceWorker(container: WorkerContainer, callbacks: UpdateCallbacks) {
  // Without a controller this is the first install: there is no older shell to protect.
  const hadController = Boolean(container.controller);
  let acceptedHere = false;

  const offer = (worker: Worker) => {
    if (!hadController) return;
    callbacks.onUpdateReady(() => {
      acceptedHere = true;
      worker.postMessage(SKIP_WAITING);
    });
  };

  container.addEventListener("controllerchange", () => {
    if (hadController) callbacks.onControllerChange(acceptedHere);
  });

  const registration = await container.register("/sw.js", { scope: "/", updateViaCache: "none" });
  if (registration.waiting) offer(registration.waiting);
  registration.addEventListener("updatefound", () => {
    const installing = registration.installing;
    if (!installing) return;
    installing.addEventListener("statechange", () => {
      if (installing.state === "installed") offer(installing);
    });
  });
  return registration;
}
