export interface KeyboardBinding {
  readonly action: string;
  readonly keys: readonly string[];
  readonly label: string;
}

const BINDINGS: readonly KeyboardBinding[] = [
  { action: "intake.continue", keys: ["Enter"], label: "Continue project intake" },
  { action: "help", keys: ["?"], label: "Open contextual help" },
  { action: "alternatives", keys: ["a"], label: "Inspect alternatives" },
  { action: "confirm", keys: ["y"], label: "Confirm exact displayed versions" },
  { action: "reject", keys: ["n"], label: "Reject displayed decision" },
  { action: "defer", keys: ["d"], label: "Defer displayed decision" },
  { action: "inspect", keys: ["i"], label: "Inspect evidence" },
  { action: "viewer", keys: ["v"], label: "Request local viewer" },
  { action: "cancel-run", keys: ["c"], label: "Cancel run" },
  { action: "focus-next", keys: ["Tab"], label: "Focus next control" },
  { action: "focus-previous", keys: ["Shift+Tab"], label: "Focus previous control" }
];

export function keyboardMap(): readonly KeyboardBinding[] {
  return BINDINGS.map((binding) => ({ ...binding, keys: [...binding.keys] }));
}

export function keyboardMapText(): string {
  return keyboardMap().map((binding) => `${binding.keys.join("/")}: ${binding.label}`).join("\n");
}
