export interface KeyboardBinding {
  readonly action: string;
  readonly keys: readonly string[];
  readonly label: string;
}

const BINDINGS: readonly KeyboardBinding[] = [
  { action: "intake.continue", keys: ["ctrl+enter"], label: "Continue project intake" },
  { action: "help", keys: ["ctrl+alt+h"], label: "Open contextual help" },
  { action: "alternatives", keys: ["ctrl+alt+a"], label: "Inspect alternatives" },
  { action: "confirm", keys: ["ctrl+alt+y"], label: "Confirm exact displayed versions" },
  { action: "reject", keys: ["ctrl+alt+n"], label: "Reject displayed decision" },
  { action: "defer", keys: ["ctrl+alt+d"], label: "Defer displayed decision" },
  { action: "inspect", keys: ["ctrl+alt+i"], label: "Inspect evidence" },
  { action: "viewer", keys: ["ctrl+alt+v"], label: "Request local viewer" },
  { action: "cancel-run", keys: ["ctrl+alt+c"], label: "Cancel run or contract" },
  { action: "status", keys: ["ctrl+alt+s"], label: "Show live work status" },
  { action: "access-path", keys: ["ctrl+alt+x"], label: "Qualify terminal access path" },
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
