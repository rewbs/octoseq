/**
 * Context detection types for Monaco IDE support.
 *
 * These types describe the cursor context used by all IDE providers
 * (completion, hover, signature help, diagnostics).
 */

/**
 * The kind of cursor context detected.
 */
export type CursorContextKind =
  | "top-level" // At script root, not in expression
  | "after-dot" // After a dot, expecting member completion
  | "in-config-map" // Inside #{ ... }
  | "in-band-key" // Inside inputs.bands[...] or inputs.bands["..."]
  | "in-call" // Inside function call parens
  | "in-string" // Inside string literal
  | "unknown"; // Ambiguous/incomplete

/**
 * A segment in a chain expression.
 */
export type ChainSegment =
  | { kind: "ident"; name: string } // identifier
  | { kind: "call"; name: string } // method call
  | { kind: "index"; value: string }; // bracket index

/**
 * Result of cursor context detection.
 */
export interface CursorContext {
  /** What kind of context the cursor is in */
  kind: CursorContextKind;

  /** Resolved parent type name (if after-dot or in-call) */
  resolvedType?: string;

  /** Chain segments leading to cursor (e.g., ["inputs", "bands", "Bass", "energy"]) */
  chain?: ChainSegment[];

  /** For in-config-map: function path (e.g., "fx.bloom") */
  configMapFunction?: string;

  /** For in-config-map: keys already present in the map */
  existingKeys?: string[];

  /** For in-config-map: whether cursor is in key or value position */
  configMapPosition?: "key" | "value";

  /** For in-call: active parameter index (0-based) */
  activeParameter?: number;

  /** For in-call: method being called */
  calledMethod?: string;

  /** For in-band-key: partial band key being typed */
  partialBandKey?: string;

  /** For in-band-key: whether quotes are present */
  bandKeyHasQuotes?: boolean;

  /** Prefix being typed (for filtering completions) */
  prefix?: string;

  /** Local variable types in scope: variable name -> type name */
  localVariables?: Map<string, string>;
}

/**
 * Result of call context detection for signature help.
 */
export interface CallContext {
  /** Method/function name */
  methodName: string;

  /** Chain segments leading to the method (excluding the method name) */
  chain?: ChainSegment[];

  /** Resolved owner type (e.g., "Signal", "FeedbackBuilder") */
  ownerType?: string;

  /** Index of the current argument (0-based) */
  activeParameter: number;

  /** Position of the opening parenthesis */
  openParenOffset: number;
}

/**
 * Result of config-map context detection.
 */
export interface ConfigMapContext {
  /** Function path (e.g., "fx.bloom", "line.strip") */
  functionPath: string;

  /** Keys already present in the config map */
  existingKeys: string[];

  /** Whether cursor is in key or value position */
  position: "key" | "value";

  /** Partial key being typed (if in key position) */
  partialKey?: string;
}

/**
 * Result of chain parsing.
 */
export interface ChainParseResult {
  /** Parsed segments */
  segments: ChainSegment[];

  /** Whether parsing succeeded without errors */
  valid: boolean;

  /** Error message if parsing failed */
  error?: string;
}

/**
 * Result of local variable parsing.
 */
export interface LocalVariableInfo {
  /** Variable name */
  name: string;

  /** Inferred type name */
  type: string;

  /** Line where variable is declared */
  declarationLine: number;
}
