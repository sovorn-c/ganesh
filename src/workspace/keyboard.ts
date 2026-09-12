export interface KeyboardBinding {
  readonly action: string;
  readonly keys: readonly string[];
  readonly label: string;
}

const BINDINGS: readonly KeyboardBinding[] = [
  { action: "intake.continue", keys: ["ctrl+enter"], label: "Continue project intake" },
  { action: "help", keys: ["ctrl+h"], label: "Open contextual help" },
  { action: "alternatives", keys: ["ctrl+a"], label: "Inspect alternatives" },
  { action: "confirm", keys: ["ctrl+y"], label: "Confirm exact displayed versions" },
  { action: "reject", keys: ["ctrl+n"], label: "Reject displayed decision" },
  { action: "defer", keys: ["ctrl+d"], label: "Defer displayed decision" },
  { action: "inspect", keys: ["ctrl+i"], label: "Inspect evidence" },
  { action: "viewer", keys: ["ctrl+v"], label: "Request local viewer" },
  { action: "cancel-run", keys: ["ctrl+x"], label: "Cancel run or contract" },
  { action: "status", keys: ["ctrl+s"], label: "Show live work status" },
  { action: "access-path", keys: ["ctrl+shift+x"], label: "Qualify terminal access path" },
  { action: "focus-next", keys: ["tab"], label: "Focus next control (Pi editor)" },
  { action: "focus-previous", keys: ["shift+tab"], label: "Focus previous control (Pi editor)" }
];

const NATIVE_PI_ACTIONS = new Set(["intake.continue", "focus-next", "focus-previous"]);
const REQUIRED_ACTIONS = new Set(BINDINGS.map((binding) => binding.action));

export function keyboardMapComplete(): boolean {
  return REQUIRED_ACTIONS.size === 13 && BINDINGS.every((binding) => binding.keys.length > 0);
}

export function nativeKeyboardActions(): ReadonlySet<string> {
  return NATIVE_PI_ACTIONS;
}

export function keyboardMap(): readonly KeyboardBinding[] {
  return BINDINGS.map((binding) => ({ ...binding, keys: [...binding.keys] }));
}

export function keyboardMapText(): string {
  return keyboardMap().map((binding) => `${binding.keys.join("/")}: ${binding.label}`).join("\n");
}
