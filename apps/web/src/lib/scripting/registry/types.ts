/**
 * TypeScript API Registry Types
 *
 * These types define the editor contract for Monaco IDE features.
 * The registry is the single source of truth for all IDE-facing information.
 *
 * Key principle: TypeScript defines the editor contract; Rust defines runtime behavior.
 */

/**
 * Entry kinds in the registry.
 * Each kind determines how the entry appears in autocomplete and hover.
 */
export type RegistryEntryKind =
  | "namespace" // Top-level global object (mesh, fx, feedback)
  | "builder" // Fluent builder (FeedbackBuilder, WarpBuilder)
  | "method" // Function on a type
  | "property" // Readable/writable field
  | "config-map" // Config-map function (accepts #{ ... })
  | "type" // Standalone type (Vec3, Color, Signal)
  | "lifecycle" // init(), update()
  | "helper"; // help(), doc(), describe()

/**
 * Parameter definition for methods and config-map keys.
 */
export interface RegistryParam {
  /** Parameter name */
  name: string;
  /** Type annotation (e.g., "float | Signal", "Color") */
  type: string;
  /** Human-readable description */
  description: string;
  /** Whether this parameter is optional */
  optional?: boolean;
  /** Default value (for display in hints) */
  default?: unknown;
  /** Valid numeric range, if applicable (editor hint only) */
  range?: { min: number; max: number };
  /** Valid enum values, if applicable */
  enumValues?: string[];
}

/**
 * Method/function signature.
 */
export interface RegistryMethod {
  /** Method name */
  name: string;
  /** Fully qualified path (e.g., "Signal.smooth.exponential") */
  path: string;
  /** Human-readable description */
  description: string;
  /** Method parameters */
  params: RegistryParam[];
  /** Return type */
  returns: string;
  /** Chaining target - what type this method returns for fluent chains */
  chainsTo?: string;
  /** Overload identifier for methods with multiple signatures */
  overloadId?: string;
  /** Example code snippet */
  example?: string;
  /** Additional notes */
  notes?: string;
}

/**
 * Property definition.
 */
export interface RegistryProperty {
  /** Property name */
  name: string;
  /** Fully qualified path */
  path: string;
  /** Type annotation */
  type: string;
  /** Human-readable description */
  description: string;
  /** Whether this property is read-only */
  readonly?: boolean;
  /** Valid numeric range, if applicable (editor hint only) */
  range?: { min: number; max: number };
  /** Valid enum values, if applicable */
  enumValues?: string[];
}

/**
 * A registry entry (namespace, type, builder, etc.).
 */
export interface RegistryEntry {
  /** Entry kind */
  kind: RegistryEntryKind;
  /** Entry name (e.g., "mesh", "Signal", "FeedbackBuilder") */
  name: string;
  /** Fully qualified path (e.g., "mesh", "Signal.smooth") */
  path: string;
  /** Human-readable description */
  description: string;
  /** Properties accessible via dot notation */
  properties: RegistryProperty[];
  /** Methods callable on this entry */
  methods: RegistryMethod[];
  /** For config-map entries: valid keys in #{ ... } */
  configMapKeys?: RegistryParam[];
  /** Parent type for chaining context (e.g., "Signal" for SmoothBuilder) */
  parent?: string;
  /** Example code snippet */
  example?: string;
}

/**
 * The complete API registry.
 */
export interface ApiRegistry {
  /** Registry version */
  version: string;
  /** All entries indexed by path */
  entries: Map<string, RegistryEntry>;
  /** Index: entry name -> paths (for fast lookup by name) */
  byName: Map<string, string[]>;
  /** Index: kind -> paths */
  byKind: Map<RegistryEntryKind, string[]>;
}

/**
 * Result of resolving a chain of segments to a type.
 */
export interface ChainResolution {
  /** Whether resolution was successful */
  success: boolean;
  /** Resolved entry, if found */
  entry?: RegistryEntry;
  /** Resolved method, if the chain ends with a method call */
  method?: RegistryMethod;
  /** Resolved property, if the chain ends with a property access */
  property?: RegistryProperty;
  /** The type name that would follow in a chain (for completion) */
  nextType?: string;
  /** Error message if resolution failed */
  error?: string;
}

/**
 * Entry definition for use in entry files.
 * This is the format used when defining entries statically.
 */
export interface RegistryEntryDefinition extends Omit<RegistryEntry, "path"> {
  /** Path can be omitted in definitions; will be inferred from name */
  path?: string;
}

/**
 * Helper type for defining methods with inferred paths.
 */
export type RegistryMethodDefinition = Omit<RegistryMethod, "path">;

/**
 * Helper type for defining properties with inferred paths.
 */
export type RegistryPropertyDefinition = Omit<RegistryProperty, "path">;
