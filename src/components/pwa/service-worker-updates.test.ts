import { describe, expect, it, vi } from "vitest";
import { registerServiceWorker, SKIP_WAITING, type WorkerContainer } from "./service-worker-updates";

type Listener = () => void;

function fakeWorker(state: ServiceWorkerState = "installing") {
  const listeners: Listener[] = [];
  return {
    state,
    postMessage: vi.fn(),
    addEventListener: (_type: string, listener: Listener) => listeners.push(listener),
    become(next: ServiceWorkerState) {
      this.state = next;
      for (const listener of listeners) listener();
    }
  };
}

function fakeContainer({ controlled, waiting = null }: { controlled: boolean; waiting?: ReturnType<typeof fakeWorker> | null }) {
  const controllerChange: Listener[] = [];
  const updateFound: Listener[] = [];
  const registration = {
    waiting: waiting as ReturnType<typeof fakeWorker> | null,
    installing: null as ReturnType<typeof fakeWorker> | null,
    addEventListener: (_type: "updatefound", listener: Listener) => updateFound.push(listener)
  };
  const container = {
    controller: controlled ? {} : null,
    register: vi.fn(async () => registration),
    addEventListener: (_type: "controllerchange", listener: Listener) => controllerChange.push(listener)
  };
  return {
    container: container as unknown as WorkerContainer & { register: typeof container.register },
    registration,
    foundUpdate(worker: ReturnType<typeof fakeWorker>) {
      registration.installing = worker;
      for (const listener of updateFound) listener();
    },
    takeOver() {
      container.controller = {};
      for (const listener of controllerChange) listener();
    }
  };
}

function callbacks() {
  return { onUpdateReady: vi.fn<(apply: () => void) => void>(), onControllerChange: vi.fn<(acceptedHere: boolean) => void>() };
}

describe("registerServiceWorker", () => {
  it("registers the root worker and always checks the network for a new one", async () => {
    const { container } = fakeContainer({ controlled: false });
    await registerServiceWorker(container, callbacks());
    expect(container.register).toHaveBeenCalledWith("/sw.js", { scope: "/", updateViaCache: "none" });
  });

  it("offers an installed update and activates it only when accepted, then reloads", async () => {
    const fake = fakeContainer({ controlled: true });
    const handlers = callbacks();
    await registerServiceWorker(fake.container, handlers);
    const next = fakeWorker();
    fake.foundUpdate(next);
    expect(handlers.onUpdateReady).not.toHaveBeenCalled();

    next.become("installed");
    expect(handlers.onUpdateReady).toHaveBeenCalledTimes(1);
    expect(next.postMessage).not.toHaveBeenCalled();

    const apply = handlers.onUpdateReady.mock.calls[0]![0];
    apply();
    expect(next.postMessage).toHaveBeenCalledWith(SKIP_WAITING);
    fake.takeOver();
    expect(handlers.onControllerChange).toHaveBeenCalledWith(true);
  });

  it("offers a version that was already waiting when the page opened", async () => {
    const waiting = fakeWorker("installed");
    const fake = fakeContainer({ controlled: true, waiting });
    const handlers = callbacks();
    await registerServiceWorker(fake.container, handlers);
    handlers.onUpdateReady.mock.calls[0]![0]();
    expect(waiting.postMessage).toHaveBeenCalledWith(SKIP_WAITING);
  });

  it("tells the page when another tab accepted the update, without reloading it by itself", async () => {
    const fake = fakeContainer({ controlled: true });
    const handlers = callbacks();
    await registerServiceWorker(fake.container, handlers);
    fake.takeOver();
    expect(handlers.onControllerChange).toHaveBeenCalledWith(false);
  });

  it("does nothing on the first install: there is no older shell to protect", async () => {
    const fake = fakeContainer({ controlled: false });
    const handlers = callbacks();
    await registerServiceWorker(fake.container, handlers);
    const first = fakeWorker();
    fake.foundUpdate(first);
    first.become("installed");
    fake.takeOver();
    expect(handlers.onUpdateReady).not.toHaveBeenCalled();
    expect(handlers.onControllerChange).not.toHaveBeenCalled();
  });

  it("still offers later versions in the tab where the first install happened", async () => {
    const fake = fakeContainer({ controlled: false });
    const handlers = callbacks();
    await registerServiceWorker(fake.container, handlers);
    const first = fakeWorker();
    fake.foundUpdate(first);
    first.become("installed");
    fake.takeOver(); // clientsClaim: the first worker now controls this tab

    const next = fakeWorker();
    fake.foundUpdate(next);
    next.become("installed");
    expect(handlers.onUpdateReady).toHaveBeenCalledTimes(1);
    handlers.onUpdateReady.mock.calls[0]![0]();
    expect(next.postMessage).toHaveBeenCalledWith(SKIP_WAITING);
    fake.takeOver();
    expect(handlers.onControllerChange).toHaveBeenCalledTimes(1);
    expect(handlers.onControllerChange).toHaveBeenCalledWith(true);
  });
});
