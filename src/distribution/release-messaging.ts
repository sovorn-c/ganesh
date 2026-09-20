// story: e19s05

export type ReleaseState = "maintained-local-tarball" | "private-unpublished" | "shipment-blocked";

export interface ReleaseStateItem {
  readonly id: ReleaseState;
  readonly label: string;
  readonly description: string;
}

export interface ReleaseStateView {
  readonly current: ReleaseState;
  readonly states: readonly ReleaseStateItem[];
  readonly text: string;
}

const STATES: readonly ReleaseStateItem[] = [
  {
    id: "maintained-local-tarball",
    label: "Maintained local npm tarball",
    description: "The verified distribution artifact is a maintained local npm tarball, not a registry publication."
  },
  {
    id: "private-unpublished",
    label: "Private/unpublished",
    description: "The distribution remains private and unpublished; no npm publication authorization has been granted."
  },
  {
    id: "shipment-blocked",
    label: "Shipment-blocked",
    description: "Shipment is blocked by B06 human review, publication authorization, and production-readiness gates."
  }
];

export function presentReleaseStates(): ReleaseStateView {
  return {
    current: "shipment-blocked",
    states: STATES,
    text: STATES.map((state) => `${state.label}: ${state.description}`).join("\n")
  };
}
