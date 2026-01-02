/**
 * Entity entries for the API registry.
 *
 * Entities are scene objects like meshes, lines, and particle systems.
 */

import type { RegistryEntry } from "../types";

export const ENTITY_ENTRIES: RegistryEntry[] = [
  // ============================================================================
  // MeshEntity - Mesh entity
  // ============================================================================
  {
    kind: "type",
    name: "MeshEntity",
    path: "MeshEntity",
    description: "A mesh entity created by mesh.cube() or mesh.plane().",
    properties: [
      {
        name: "position",
        path: "MeshEntity.position",
        type: "Vec3",
        description: "Position in 3D space.",
      },
      {
        name: "rotation",
        path: "MeshEntity.rotation",
        type: "Vec3",
        description: "Euler rotation in radians.",
      },
      {
        name: "scale",
        path: "MeshEntity.scale",
        type: "float | Signal",
        description: "Uniform scale factor.",
      },
      {
        name: "visible",
        path: "MeshEntity.visible",
        type: "bool",
        description: "Visibility flag.",
      },
      {
        name: "material",
        path: "MeshEntity.material",
        type: "string",
        description:
          'Material ID (e.g., "default", "emissive", "wire_glow", "wire", "soft_additive", "gradient").',
      },
      {
        name: "materialParams",
        path: "MeshEntity.materialParams",
        type: "MaterialParams",
        description: "Material parameters map. Keys depend on the selected material.",
      },
      {
        name: "color",
        path: "MeshEntity.color",
        type: "Color",
        description: "Entity color (RGBA 0.0-1.0). Channels can be Signals.",
      },
      {
        name: "deformations",
        path: "MeshEntity.deformations",
        type: "array<DeformDescriptor>",
        description: "Array of deformation descriptors to apply.",
      },
      {
        name: "lit",
        path: "MeshEntity.lit",
        type: "bool",
        description: "Whether this mesh is affected by global lighting. Default: true.",
      },
      {
        name: "emissive",
        path: "MeshEntity.emissive",
        type: "Signal | f32",
        description: "Emissive intensity multiplier. Adds glow unaffected by lighting. Default: 0.0.",
      },
      {
        name: "shadow",
        path: "MeshEntity.shadow",
        type: "BlobShadowConfig",
        description: "Blob shadow configuration. Set shadow.enabled = true to enable.",
      },
    ],
    methods: [
      {
        name: "instance",
        path: "MeshEntity.instance",
        description:
          "Create a new entity that shares geometry with this one but has independent properties.",
        params: [],
        returns: "MeshEntity",
        chainsTo: "MeshEntity",
        example: `let base = mesh.cube();
base.position.x = 1.0;
let copy = base.instance();  // Copies current property values
copy.position.x = -1.0;      // Independent transform
scene.add(base);
scene.add(copy);`,
        notes:
          "Geometry is shared (no duplication). Properties are copied as-is: if a Signal is assigned, " +
          "the Signal reference is copied and evaluated independently per instance. Deformations array is copied empty.",
      },
    ],
  },

  // ============================================================================
  // BlobShadowConfig - Blob shadow configuration
  // ============================================================================
  {
    kind: "type",
    name: "BlobShadowConfig",
    path: "BlobShadowConfig",
    description:
      "Configuration for blob/contact shadows. Renders a soft ellipse on a ground plane beneath the entity.",
    properties: [
      {
        name: "enabled",
        path: "BlobShadowConfig.enabled",
        type: "bool",
        description: "Enable/disable the shadow. Default: false.",
      },
      {
        name: "plane_y",
        path: "BlobShadowConfig.plane_y",
        type: "Signal | f32",
        description: "Y position of the shadow plane. Default: 0.0.",
      },
      {
        name: "opacity",
        path: "BlobShadowConfig.opacity",
        type: "Signal | f32",
        description: "Shadow opacity (0.0-1.0). Default: 0.5.",
      },
      {
        name: "radius",
        path: "BlobShadowConfig.radius",
        type: "Signal | f32",
        description: "Uniform shadow radius. Sets both radius_x and radius_z. Default: 1.0.",
      },
      {
        name: "radius_x",
        path: "BlobShadowConfig.radius_x",
        type: "Signal | f32",
        description: "Shadow radius in X direction. Default: 1.0.",
      },
      {
        name: "radius_z",
        path: "BlobShadowConfig.radius_z",
        type: "Signal | f32",
        description: "Shadow radius in Z direction. Default: 1.0.",
      },
      {
        name: "softness",
        path: "BlobShadowConfig.softness",
        type: "Signal | f32",
        description: "Shadow edge softness (0.0 = hard, 1.0 = very soft). Default: 0.3.",
      },
      {
        name: "offset_x",
        path: "BlobShadowConfig.offset_x",
        type: "Signal | f32",
        description: "Shadow X offset from entity position. Default: 0.0.",
      },
      {
        name: "offset_z",
        path: "BlobShadowConfig.offset_z",
        type: "Signal | f32",
        description: "Shadow Z offset from entity position. Default: 0.0.",
      },
      {
        name: "color",
        path: "BlobShadowConfig.color",
        type: "Map { r, g, b }",
        description: "Shadow color (RGB, 0-1 range). Default: black (0, 0, 0).",
      },
    ],
    methods: [],
  },

  // ============================================================================
  // LineStripEntity - Procedural line strip
  // ============================================================================
  {
    kind: "type",
    name: "LineStripEntity",
    path: "LineStripEntity",
    description: "A procedural line strip created by line.strip(options).",
    properties: [
      {
        name: "position",
        path: "LineStripEntity.position",
        type: "Vec3",
        description: "Position in 3D space.",
      },
      {
        name: "rotation",
        path: "LineStripEntity.rotation",
        type: "Vec3",
        description: "Euler rotation in radians.",
      },
      {
        name: "scale",
        path: "LineStripEntity.scale",
        type: "float | Signal",
        description: "Uniform scale factor.",
      },
      {
        name: "visible",
        path: "LineStripEntity.visible",
        type: "bool",
        description: "Visibility flag.",
      },
      {
        name: "color",
        path: "LineStripEntity.color",
        type: "Color",
        description: "Line color.",
      },
    ],
    methods: [
      {
        name: "push",
        path: "LineStripEntity.push",
        description: "Add a 2D point to the strip.",
        params: [
          { name: "x", type: "float", description: "X coordinate." },
          { name: "y", type: "float", description: "Y coordinate." },
        ],
        returns: "void",
        example: "spark.push(inputs.time, inputs.amplitude);",
        notes: "Points are stored in a ring buffer (oldest points are overwritten when full).",
      },
      {
        name: "clear",
        path: "LineStripEntity.clear",
        description: "Clear all points from the strip.",
        params: [],
        returns: "void",
        example: "spark.clear();",
      },
    ],
  },

  // ============================================================================
  // LineTraceEntity - Signal-driven line trace
  // ============================================================================
  {
    kind: "type",
    name: "LineTraceEntity",
    path: "LineTraceEntity",
    description: "A Signal-driven line created by line.trace(signal, options).",
    properties: [
      {
        name: "position",
        path: "LineTraceEntity.position",
        type: "Vec3",
        description: "Position in 3D space.",
      },
      {
        name: "rotation",
        path: "LineTraceEntity.rotation",
        type: "Vec3",
        description: "Euler angles in radians.",
      },
      {
        name: "scale",
        path: "LineTraceEntity.scale",
        type: "float | Signal",
        description: "Uniform scale factor.",
      },
      {
        name: "visible",
        path: "LineTraceEntity.visible",
        type: "bool",
        description: "Visibility flag.",
      },
      {
        name: "color",
        path: "LineTraceEntity.color",
        type: "Color",
        description: "RGBA color (0.0-1.0 range). Channels can be Signals.",
      },
    ],
    methods: [
      {
        name: "clear",
        path: "LineTraceEntity.clear",
        description: "Clear all points from the trace.",
        params: [],
        returns: "void",
        example: "trace.clear();",
      },
    ],
  },

  // ============================================================================
  // RibbonEntity - Thick extruded line (ribbon)
  // ============================================================================
  {
    kind: "type",
    name: "RibbonEntity",
    path: "RibbonEntity",
    description:
      "A ribbon (thick extruded line) created by line.ribbon(signal, options). Supports strip (flat) and tube (cylindrical) modes.",
    properties: [
      {
        name: "position",
        path: "RibbonEntity.position",
        type: "Vec3",
        description: "Position in 3D space.",
      },
      {
        name: "rotation",
        path: "RibbonEntity.rotation",
        type: "Vec3",
        description: "Euler rotation in radians.",
      },
      {
        name: "scale",
        path: "RibbonEntity.scale",
        type: "float | Signal",
        description: "Uniform scale factor.",
      },
      {
        name: "visible",
        path: "RibbonEntity.visible",
        type: "bool",
        description: "Visibility flag.",
      },
      {
        name: "color",
        path: "RibbonEntity.color",
        type: "Color",
        description: "Ribbon color (RGBA 0.0-1.0). Channels can be Signals.",
      },
      {
        name: "width",
        path: "RibbonEntity.width",
        type: "float | Signal",
        description: "Width of the ribbon (or diameter for tube mode).",
      },
      {
        name: "twist",
        path: "RibbonEntity.twist",
        type: "float | Signal",
        description: "Twist rate along the ribbon length (radians per unit distance).",
      },
    ],
    methods: [
      {
        name: "clear",
        path: "RibbonEntity.clear",
        description: "Clear all points from the ribbon.",
        params: [],
        returns: "void",
        example: "ribbon.clear();",
      },
    ],
  },

  // ============================================================================
  // RadialWaveEntity - Radial wave entity
  // ============================================================================
  {
    kind: "type",
    name: "RadialWaveEntity",
    path: "RadialWaveEntity",
    description: "A signal-modulated radial wave entity created by radial.wave().",
    properties: [
      {
        name: "position",
        path: "RadialWaveEntity.position",
        type: "Vec3",
        description: "Position in 3D space.",
      },
      {
        name: "rotation",
        path: "RadialWaveEntity.rotation",
        type: "Vec3",
        description: "Euler rotation in radians.",
      },
      {
        name: "scale",
        path: "RadialWaveEntity.scale",
        type: "float | Signal",
        description: "Uniform scale factor.",
      },
      {
        name: "visible",
        path: "RadialWaveEntity.visible",
        type: "bool",
        description: "Visibility flag.",
      },
      {
        name: "color",
        path: "RadialWaveEntity.color",
        type: "Color",
        description: "Wave color (RGBA 0.0-1.0). Channels can be Signals.",
      },
    ],
    methods: [],
  },

  // ============================================================================
  // PointCloudEntity - Point cloud entity
  // ============================================================================
  {
    kind: "type",
    name: "PointCloudEntity",
    path: "PointCloudEntity",
    description: "A point cloud entity created by points.cloud().",
    properties: [
      {
        name: "position",
        path: "PointCloudEntity.position",
        type: "Vec3",
        description: "Position in 3D space.",
      },
      {
        name: "rotation",
        path: "PointCloudEntity.rotation",
        type: "Vec3",
        description: "Euler rotation in radians.",
      },
      {
        name: "scale",
        path: "PointCloudEntity.scale",
        type: "float | Signal",
        description: "Uniform scale factor.",
      },
      {
        name: "visible",
        path: "PointCloudEntity.visible",
        type: "bool",
        description: "Visibility flag.",
      },
      {
        name: "color",
        path: "PointCloudEntity.color",
        type: "Color",
        description: "Point color (RGBA 0.0-1.0). Channels can be Signals.",
      },
      {
        name: "point_size",
        path: "PointCloudEntity.point_size",
        type: "float | Signal",
        description: "Size of each point in pixels.",
      },
    ],
    methods: [],
  },

  // ============================================================================
  // PostEffect - Post-processing effect instance
  // ============================================================================
  {
    kind: "type",
    name: "PostEffect",
    path: "PostEffect",
    description: "A post-processing effect instance. Properties can be modified dynamically.",
    properties: [
      {
        name: "enabled",
        path: "PostEffect.enabled",
        type: "bool",
        description: "Enable/disable the effect.",
      },
      {
        name: "__id",
        path: "PostEffect.__id",
        type: "int",
        description: "Internal effect ID (for ordering).",
        readonly: true,
      },
    ],
    methods: [],
  },

  // ============================================================================
  // ParticleSystemHandle - Particle system
  // ============================================================================
  {
    kind: "type",
    name: "ParticleSystemHandle",
    path: "ParticleSystemHandle",
    description: "A handle to a particle system created by particles.from_events or particles.stream.",
    properties: [
      {
        name: "visible",
        path: "ParticleSystemHandle.visible",
        type: "bool",
        description: "Visibility flag.",
      },
      {
        name: "position",
        path: "ParticleSystemHandle.position",
        type: "Vec3",
        description: "Base position (x, y, z).",
      },
      {
        name: "color",
        path: "ParticleSystemHandle.color",
        type: "Color",
        description: "Base color (r, g, b, a).",
      },
      {
        name: "scale",
        path: "ParticleSystemHandle.scale",
        type: "float | Signal",
        description: "Uniform scale.",
      },
    ],
    methods: [
      {
        name: "instance_count",
        path: "ParticleSystemHandle.instance_count",
        description: "Get active particle count.",
        params: [],
        returns: "int",
        example: "let n = particles.instance_count();",
      },
      {
        name: "reset",
        path: "ParticleSystemHandle.reset",
        description: "Clear all particles.",
        params: [],
        returns: "void",
        example: "particles.reset();",
      },
    ],
  },

  // ============================================================================
  // DeformDescriptor - Deformation descriptor (opaque)
  // ============================================================================
  {
    kind: "type",
    name: "DeformDescriptor",
    path: "DeformDescriptor",
    description: "A deformation descriptor created by deform.twist, deform.bend, etc.",
    properties: [],
    methods: [],
  },

  // ============================================================================
  // MaterialParams - Material parameters map
  // ============================================================================
  {
    kind: "type",
    name: "MaterialParams",
    path: "MaterialParams",
    description:
      "Material parameters map. Keys and types depend on the selected material. Use dbg.describeMaterial() to see available parameters.",
    properties: [],
    methods: [],
  },

  // ============================================================================
  // FeedbackConfig - Feedback configuration
  // ============================================================================
  {
    kind: "type",
    name: "FeedbackConfig",
    path: "FeedbackConfig",
    description: "Feedback configuration (result of builder.build()).",
    properties: [],
    methods: [],
  },
];
