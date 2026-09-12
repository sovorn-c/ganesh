export type AccessPathReason =
  | "no-keyboard"
  | "colour-only-status"
  | "non-text-terminal"
  | "non-utf8-terminal"
  | "missing-keyboard-map"
  | "pointer-only"
  | "unsupported-screen-reader-pairing";

export interface AccessPathInput {
  readonly keyboard: boolean;
  readonly textStatus: boolean;
  readonly utf8: boolean;
  readonly keyboardMapComplete?: boolean;
  readonly textTerminal?: boolean;
  readonly pointerOnly?: boolean;
  readonly screenReader?: string;
  readonly terminal?: string;
}

export interface AccessPathResult {
  readonly status: "supported" | "blocked";
  readonly accessible: boolean;
  readonly keyboard: boolean;
  readonly textStatus: boolean;
  readonly utf8: boolean;
  readonly reason?: AccessPathReason;
}

const SUPPORTED_SCREEN_READER_TERMINALS = new Set(["VoiceOver:Terminal.app", "VoiceOver:iTerm2"]);

export function qualifyAccessPath(input: AccessPathInput): AccessPathResult {
  let reason: AccessPathReason | undefined;
  if (!input.keyboard) {
    reason = "no-keyboard";
  } else if (!input.textStatus) {
    reason = "colour-only-status";
  } else if (!input.utf8) {
    reason = "non-utf8-terminal";
  } else if (input.textTerminal !== true || input.terminal === "dumb" || (input.terminal !== undefined && input.terminal.trim() === "")) {
    reason = "non-text-terminal";
  } else if (input.keyboardMapComplete !== true) {
    reason = "missing-keyboard-map";
  } else if (input.pointerOnly !== false) {
    reason = "pointer-only";
  } else if (input.screenReader !== undefined && input.terminal !== undefined && !SUPPORTED_SCREEN_READER_TERMINALS.has(`${input.screenReader}:${input.terminal}`)) {
    reason = "unsupported-screen-reader-pairing";
  }
  return {
    status: reason === undefined ? "supported" : "blocked",
    accessible: reason === undefined,
    keyboard: input.keyboard,
    textStatus: input.textStatus,
    utf8: input.utf8,
    ...(reason === undefined ? {} : { reason })
  };
}
