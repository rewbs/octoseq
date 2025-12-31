/**
 * Lifecycle and helper function entries for the API registry.
 *
 * Includes:
 * - Lifecycle functions: init(), update()
 * - Helper functions: help(), doc(), describe()
 */

import type { RegistryEntry } from "../types";

export const LIFECYCLE_ENTRIES: RegistryEntry[] = [
  // ============================================================================
  // init - Script initialization function
  // ============================================================================
  {
    kind: "lifecycle",
    name: "init",
    path: "init",
    description:
      "Script initialization function. Called once after script load. Create scene objects, initialize particle systems, set up feedback configuration, and define signal variables here.",
    properties: [],
    methods: [],
    example: `fn init(ctx) {
  let cube = mesh.cube();
  scene.add(cube);
}`,
  },

  // ============================================================================
  // update - Per-frame update function
  // ============================================================================
  {
    kind: "lifecycle",
    name: "update",
    path: "update",
    description:
      "Per-frame update function. Called each frame with delta time and frame inputs. Update entity properties here - Signal assignments are evaluated automatically at render time.",
    properties: [],
    methods: [],
    example: `fn update(dt, frame_inputs) {
  cube.rotation.y = cube.rotation.y + dt;
}`,
  },

  // ============================================================================
  // describe - Structured value description
  // ============================================================================
  {
    kind: "helper",
    name: "describe",
    path: "describe",
    description:
      "Host-assisted introspection. Returns a structured description of a value or type as a map.",
    properties: [],
    methods: [
      {
        name: "describe",
        path: "describe",
        description: "Get a structured description of a value or type.",
        params: [
          {
            name: "value",
            type: "any",
            description: "Value or type to describe.",
          },
        ],
        returns: "Map",
        example: "log.info(describe(inputs.amplitude));",
      },
    ],
  },

  // ============================================================================
  // help - Human-readable help
  // ============================================================================
  {
    kind: "helper",
    name: "help",
    path: "help",
    description: "Human-readable help. Returns a short formatted summary of a value or type.",
    properties: [],
    methods: [
      {
        name: "help",
        path: "help",
        description: "Get human-readable help for a value or type.",
        params: [
          {
            name: "value",
            type: "any",
            description: "Value or type to get help for.",
          },
        ],
        returns: "string",
        example: "log.info(help(mesh));",
      },
    ],
  },

  // ============================================================================
  // doc - Targeted documentation lookup
  // ============================================================================
  {
    kind: "helper",
    name: "doc",
    path: "doc",
    description:
      'Targeted documentation lookup. Look up documentation by path string (e.g., "Signal.smooth.exponential").',
    properties: [],
    methods: [
      {
        name: "doc",
        path: "doc",
        description: "Look up documentation by path.",
        params: [
          {
            name: "path",
            type: "string",
            description: 'Documentation path (e.g., "Signal.smooth.exponential").',
          },
        ],
        returns: "Map | void",
        example: 'log.info(doc("Signal.smooth.exponential"));',
      },
    ],
  },

  // ============================================================================
  // particles - Particle system namespace
  // ============================================================================
  {
    kind: "namespace",
    name: "particles",
    path: "particles",
    description: "Particle system factory namespace. Create event-driven or continuous particle emitters.",
    properties: [],
    methods: [
      {
        name: "from_events",
        path: "particles.from_events",
        description: "Create a particle system driven by an event stream.",
        params: [
          {
            name: "events",
            type: "EventStream",
            description: "Event stream to drive particle emission.",
          },
          {
            name: "options",
            type: "ParticlesFromEventsOptions",
            description: "Particle system options.",
          },
        ],
        returns: "ParticleSystemHandle",
        chainsTo: "ParticleSystemHandle",
        example: 'let ps = particles.from_events(events, #{ lifetime_beats: 1.0, color: #{ r: 1.0, g: 0.5, b: 0.0, a: 1.0 } });',
      },
      {
        name: "stream",
        path: "particles.stream",
        description: "Create a continuous particle stream driven by a signal.",
        params: [
          {
            name: "signal",
            type: "Signal",
            description: "Signal to drive particle emission rate.",
          },
          {
            name: "options",
            type: "ParticlesStreamOptions",
            description: "Particle stream options.",
          },
        ],
        returns: "ParticleSystemHandle",
        chainsTo: "ParticleSystemHandle",
        example: 'let ps = particles.stream(inputs.amplitude, #{ rate_per_beat: 10.0 });',
      },
    ],
  },

  // ============================================================================
  // time - Time namespace (alternative access to time signals)
  // ============================================================================
  {
    kind: "namespace",
    name: "time",
    path: "time",
    description: "Time-related signals namespace. Alternative access to time values.",
    properties: [
      {
        name: "seconds",
        path: "time.seconds",
        type: "Signal",
        description: "Elapsed time in seconds.",
        readonly: true,
      },
      {
        name: "frames",
        path: "time.frames",
        type: "Signal",
        description: "Frame counter.",
        readonly: true,
      },
      {
        name: "beats",
        path: "time.beats",
        type: "Signal",
        description: "Musical beat position.",
        readonly: true,
      },
      {
        name: "phase",
        path: "time.phase",
        type: "Signal",
        description: "Beat phase (0-1).",
        readonly: true,
      },
      {
        name: "bpm",
        path: "time.bpm",
        type: "Signal",
        description: "Current tempo.",
        readonly: true,
      },
      {
        name: "dt",
        path: "time.dt",
        type: "Signal",
        description: "Delta time per frame.",
        readonly: true,
      },
    ],
    methods: [],
  },
];
