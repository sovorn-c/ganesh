// story: e05s05
import type { CandidateSubmission, SpecialistSessionPort, SpecialistSessionResult } from "./work-types.js";

export interface AgentSessionLike {
  readonly id?: string;
  subscribe?(listener: (event: unknown) => void): (() => void) | { unsubscribe(): void };
  prompt?(input: string): Promise<unknown>;
  abort?(): Promise<void> | void;
}

export interface AgentSessionRuntimeLike {
  session: AgentSessionLike;
  bindExtensions?(): void | Promise<void>;
}

export interface PiSessionAdapterOptions {
  readonly runtime: AgentSessionRuntimeLike;
  readonly prompt?: (request: unknown, session: AgentSessionLike) => Promise<SpecialistSessionResult>;
}

function sessionId(session: AgentSessionLike): string {
  return session.id ?? `session-${Math.random().toString(36).slice(2)}`;
}

export function createPiSessionAdapter(options: PiSessionAdapterOptions): SpecialistSessionPort {
  let session = options.runtime.session;
  let unsubscribe: (() => void) | undefined;
  const detach = (): void => {
    unsubscribe?.();
    unsubscribe = undefined;
  };
  const bind = (): void => {
    detach();
    if (session.subscribe) {
      const result = session.subscribe(() => undefined);
      unsubscribe = typeof result === "function" ? result : () => result.unsubscribe();
    }
    void options.runtime.bindExtensions?.();
  };
  bind();
  return {
    async start(request) {
      const result = options.prompt ? await options.prompt(request, session) : { status: "ok" as const, sessionId: sessionId(session) };
      return { ...result, sessionId: result.sessionId ?? sessionId(session) };
    },
    async prompt(request) {
      if (options.prompt) {return options.prompt(request, session);}
      const text = JSON.stringify(request);
      const result = session.prompt ? await session.prompt(text) : { status: "ok" as const };
      const normalized = result && typeof result === "object" ? result as SpecialistSessionResult : { status: "ok" as const };
      return { ...normalized, sessionId: normalized.sessionId ?? sessionId(session) };
    },
    async cancel() {
      await session.abort?.();
    },
    rebind() {
      session = options.runtime.session;
      bind();
    },
    submit(submission: CandidateSubmission) {
      return { ...submission, sessionId: sessionId(session) };
    }
  };
}