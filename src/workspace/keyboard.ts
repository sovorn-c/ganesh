export interface KeyboardBinding {
  readonly action: string;
  readonly keys: readonly string[];
  readonly label: string;
}

const BINDINGS: readonly KeyboardBinding[] = [
  { action: "help", keys: ["?"], label: "Open contextual help" },
  { action: "alternatives", keys: ["a"], label: "Inspect alternatives" },
  { action: "confirm", keys: ["y"], label: "Confirm exact displayed versions" },
  { action: "reject", keys: ["n"], label: "Reject displayed decision" },
  { action: "defer", keys: ["d"], label: "Defer displayed decision" },
  { action: "inspect", keys: ["i"], label: "Inspect evidence" },
  { action: "viewer", keys: ["v"], label: "Request local viewer" },
  { action: "cancel-run", keys: ["c"], label: "Cancel run or contract" },
  { action: "status", keys: ["s"], label: "Show live work status" },
  { action: "access-path", keys: ["x"], label: "Qualify terminal access path" },
];

export function keyboardMap(): readonly KeyboardBinding[] {
  return BINDINGS.map((binding) => ({ ...binding, keys: [...binding.keys] }));
}

export function keyboardMapText(): string {
  return keyboardMap().map((binding) => `${binding.keys.join("/")}: ${binding.label}`).join("\n");
}
