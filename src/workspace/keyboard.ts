export interface KeyboardBinding {
  readonly action: string;
  readonly keys: readonly string[];
  readonly label: string;
}

const BINDINGS: readonly KeyboardBinding[] = [
  { action: "intake.continue", keys: ["ctrl+enter"], label: "Continue project intake" },
  { action: "help", keys: ["alt+h"], label: "Open contextual help" },
  { action: "alternatives", keys: ["alt+a"], label: "Inspect alternatives" },
  { action: "confirm", keys: ["alt+y"], label: "Confirm exact displayed versions" },
  { action: "reject", keys: ["alt+n"], label: "Reject displayed decision" },
  { action: "defer", keys: ["alt+d"], label: "Defer displayed decision" },
  { action: "inspect", keys: ["alt+i"], label: "Inspect evidence" },
  { action: "viewer", keys: ["alt+v"], label: "Request local viewer" },
  { action: "cancel-run", keys: ["alt+c"], label: "Cancel run or contract" },
  { action: "status", keys: ["alt+s"], label: "Show live work status" },
  { action: "access-path", keys: ["alt+x"], label: "Qualify terminal access path" },
  { action: "focus-next", keys: ["ctrl+alt+right"], label: "Focus next workspace control" },
  { action: "focus-previous", keys: ["ctrl+alt+left"], label: "Focus previous workspace control" }
];

const REQUIRED_ACTIONS = new Set(BINDINGS.map((binding) => binding.action));

export function keyboardMapComplete(): boolean {
  return REQUIRED_ACTIONS.size === 13 && BINDINGS.every((binding) => binding.keys.length > 0);
}

export function keyboardMap(): readonly KeyboardBinding[] {
  return BINDINGS.map((binding) => ({ ...binding, keys: [...binding.keys] }));
}

export function keyboardMapText(): string {
  return keyboardMap().map((binding) => `${binding.keys.join("/")}: ${binding.label}`).join("\n");
}
