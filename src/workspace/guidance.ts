// story: e19s01

import type { WorkspaceSession } from "./workspace-types.js";

export interface LaunchGuidance {
  readonly identity: string;
  readonly supervisorRole: string;
  readonly nextAction: string;
  readonly nextActions: readonly [string];
  readonly returning: boolean;
  readonly restrictedNotice: string;
  readonly text: string;
  readonly initialMessage: string;
  readonly initialMessages: readonly [string];
}

export function composeLaunchGuidance(session: WorkspaceSession): LaunchGuidance {
  const returning = session.intake.lateEntry;
  const identity = "Ganesh is a local-first research workspace.";
  const supervisorRole = "The Ganesh Supervisor is a bounded coordinating Supervisor role, not a scholarly authority.";
  const nextAction = returning
    ? "Next safe action: review current records with /ganesh-help."
    : "Next safe action: start with /ganesh-orient when you are ready to frame the research problem.";
  const restrictedNotice = "Restricted records are omitted from this context; authorized inspection is required.";
  const onboarding = returning ? "" : "First launch: your project is ready; no wizard or stage pipeline is required.\n";
  const text = `${identity}\n${supervisorRole}\n${onboarding}${nextAction}\n${restrictedNotice}`;
  return {
    identity,
    supervisorRole,
    nextAction,
    nextActions: [nextAction],
    returning,
    restrictedNotice,
    text,
    initialMessage: text,
    initialMessages: [nextAction]
  };
}
