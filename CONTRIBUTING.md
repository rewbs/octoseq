# Contributing to Octoseq

Thank you for your interest in contributing to Octoseq! This document provides guidelines and information to help you contribute effectively.

## Table of Contents

- [Getting Started](#getting-started)
- [Development Workflow](#development-workflow)
- [Code Style and Conventions](#code-style-and-conventions)
- [Testing](#testing)
- [Pull Request Process](#pull-request-process)
- [Architectural Principles](#architectural-principles)
- [Common Tasks](#common-tasks)

## Getting Started

### Prerequisites

- Node.js 20+ and pnpm 10+
- Rust 1.70+ (for WASM visualiser package)
- Git

### Initial Setup

1. **Clone the repository**

   ```bash
   git clone https://github.com/your-org/octoseq.git
   cd octoseq
   ```

2. **Install dependencies**

   ```bash
   pnpm install
   ```

3. **Build WASM packages**

   ```bash
   pnpm build:wasm
   ```

4. **Start development server**

   ```bash
   pnpm dev
   ```

5. **Open the app**
   Navigate to `http://localhost:3000`

## Development Workflow

### Branch Strategy

- `main` - Production branch, protected
- Feature branches - `feature/description` or `fix/description`
- Create PRs against `main`

### Making Changes

1. **Create a feature branch**

   ```bash
   git checkout -b feature/your-feature-name
   ```

2. **Make your changes**
   - Follow code style guidelines (see below)
   - Add tests for new functionality
   - Update documentation as needed

3. **Run quality checks**

   ```bash
   pnpm typecheck  # TypeScript type checking
   pnpm lint       # ESLint
   pnpm test       # Run tests
   ```

4. **Commit your changes**

   ```bash
   git add .
   git commit -m "feat: add new feature"
   ```

   Follow [Conventional Commits](https://www.conventionalcommits.org/):
   - `feat:` - New feature
   - `fix:` - Bug fix
   - `docs:` - Documentation only
   - `style:` - Code style changes (formatting, etc.)
   - `refactor:` - Code refactoring
   - `perf:` - Performance improvements
   - `test:` - Adding or updating tests
   - `chore:` - Build process or auxiliary tool changes

5. **Push and create a PR**
   ```bash
   git push origin feature/your-feature-name
   ```

### Working with WASM

If you modify `packages/visualiser/` (Rust code), rebuild WASM:

```bash
pnpm build:wasm
```

For faster iteration during Rust development:

```bash
cd packages/visualiser
cargo check  # Fast type checking
cargo test   # Run tests
```

## Code Style and Conventions

### TypeScript / React

- **Formatting**: 2-space indentation, 100-character line width
- **Naming**:
  - `camelCase` for variables and functions
  - `PascalCase` for components and types
  - `UPPER_SNAKE_CASE` for constants
- **Imports**:
  - Use type imports: `import type { Foo } from './foo'`
  - Group imports: external packages, then internal modules
- **Components**:
  - Use functional components with hooks
  - Prefer composition over inheritance
  - Extract complex logic to custom hooks
  - Use `React.memo()` for expensive components

**Example:**

```typescript
import type { FC } from 'react';
import { useState, useCallback } from 'react';
import { useAudioStore } from '@/lib/stores/audioStore';

interface MyComponentProps {
  value: number;
  onChange: (value: number) => void;
}

export const MyComponent: FC<MyComponentProps> = ({ value, onChange }) => {
  const [isActive, setIsActive] = useState(false);

  const handleClick = useCallback(() => {
    setIsActive(prev => !prev);
    onChange(value + 1);
  }, [value, onChange]);

  return (
    <button onClick={handleClick}>
      {isActive ? 'Active' : 'Inactive'}: {value}
    </button>
  );
};
```

### Rust

- **Edition**: 2021
- **Formatting**: Use `rustfmt` (run `cargo fmt`)
- **Style**: Follow [Rust API Guidelines](https://rust-lang.github.io/api-guidelines/)
- **Error Handling**: Use `anyhow::Result` for fallible functions
- **Platform Code**: Use `#[cfg(target_arch = "wasm32")]` for WASM-specific code

**Example:**

```rust
use anyhow::{Result, Context};

#[cfg(target_arch = "wasm32")]
pub fn init_logging() {
    console_log::init_with_level(log::Level::Info).unwrap();
}

#[cfg(not(target_arch = "wasm32"))]
pub fn init_logging() {
    env_logger::init();
}

pub fn process_data(input: &[f32]) -> Result<Vec<f32>> {
    if input.is_empty() {
        anyhow::bail!("Input cannot be empty");
    }

    let result = input.iter()
        .map(|&x| x * 2.0)
        .collect();

    Ok(result)
}
```

### State Management (Zustand)

- Place store definitions in `apps/web/src/lib/stores/`
- Export actions as hooks in `apps/web/src/lib/stores/hooks/`
- Use selectors to prevent unnecessary re-renders

**Example:**

```typescript
// stores/myStore.ts
import { create } from "zustand";

interface MyState {
  count: number;
  increment: () => void;
  decrement: () => void;
}

export const useMyStore = create<MyState>((set) => ({
  count: 0,
  increment: () => set((state) => ({ count: state.count + 1 })),
  decrement: () => set((state) => ({ count: state.count - 1 })),
}));

// In component:
const count = useMyStore((state) => state.count); // Only re-renders when count changes
const increment = useMyStore((state) => state.increment); // Stable reference
```

## Testing

### Running Tests

```bash
# All tests
pnpm test

# Specific package
pnpm --filter @octoseq/mir test
pnpm --filter web test

# Rust tests
cd packages/visualiser
cargo test
```

### Writing Tests

- Place test files adjacent to source files: `foo.test.ts` or `foo.test.tsx`
- Use descriptive test names: `it('should calculate RMS energy correctly', ...)`
- Test edge cases: empty inputs, null values, boundary conditions
- Mock external dependencies (audio files, network requests)

**Example:**

```typescript
import { describe, it, expect } from "vitest";
import { calculateRMS } from "./audio";

describe("calculateRMS", () => {
  it("should return 0 for empty array", () => {
    expect(calculateRMS([])).toBe(0);
  });

  it("should calculate RMS correctly for known values", () => {
    const samples = [1, -1, 1, -1];
    expect(calculateRMS(samples)).toBeCloseTo(1.0, 5);
  });

  it("should handle DC offset", () => {
    const samples = [2, 2, 2, 2];
    expect(calculateRMS(samples)).toBe(2.0);
  });
});
```

## Pull Request Process

1. **Ensure quality checks pass**

   ```bash
   pnpm typecheck
   pnpm lint
   pnpm test
   ```

2. **Update documentation**
   - Add/update JSDoc comments for public APIs
   - Update README.md if adding major features
   - Update ARCHITECTURE.md for architectural changes

3. **Create descriptive PR**
   - Use a clear title following Conventional Commits
   - Describe what changed and why
   - Reference related issues: "Fixes #123"
   - Include screenshots for UI changes

4. **Request review**
   - PRs require at least one approval
   - Address review feedback promptly
   - Keep PRs focused and reasonably sized

5. **CI must pass**
   - All tests must pass
   - Type checking must succeed
   - No linting errors

## Architectural Principles

Octoseq follows key design principles that all contributions should respect:

### 1. Determinism First

**All outputs must be deterministic.** Same inputs → identical results, every time.

- Use explicit seeds for random values
- Avoid `Math.random()`, `Date.now()`, or other non-deterministic sources
- Ensure frame-by-frame reproducibility

**Example:**

```typescript
// ❌ Bad - non-deterministic
const jitter = Math.random() * 10;

// ✅ Good - seeded randomness
const rng = seedrandom("my-seed-123");
const jitter = rng() * 10;
```

### 2. Signals Everywhere

**All numeric parameters should accept Signals.** A Signal resolves to a number at runtime, enabling audio-reactive control.

When implementing APIs:

- If a parameter is `number`/`f32`, it should accept `Signal | number`
- Document which parameters support Signals
- Evaluate Signals during scene sync, before rendering

**Example:**

```typescript
// ❌ Limited
function setOpacity(value: number) { ... }

// ✅ Flexible
function setOpacity(value: Signal | number) { ... }

// Usage:
setOpacity(0.5);  // Static value
setOpacity(myBand.rms);  // Audio-reactive
```

### 3. Human-in-the-Loop

**Automation proposes; humans decide.**

- Auto-generated bands are "proposed" (ephemeral)
- Users must explicitly promote/accept proposals
- Don't make irreversible changes automatically
- Provide undo/redo where possible

### 4. Whole-Track Analysis

**MIR has access to entire audio** with lookahead/lookbehind for perceptually meaningful features.

- Don't limit analysis to current playback position
- Use context from surrounding audio
- Generate features that align with musical structure

### 5. Functional and Immutable

**Prefer pure functions and immutable data.**

- Avoid side effects where possible
- Use `const` by default
- Return new objects instead of mutating
- Use Zustand's immutable state updates

**Example:**

```typescript
// ❌ Mutation
function updateBand(band: Band, newValue: number) {
  band.value = newValue;
  return band;
}

// ✅ Immutable
function updateBand(band: Band, newValue: number): Band {
  return { ...band, value: newValue };
}
```

## Common Tasks

### Adding a New MIR Feature

1. Implement the algorithm in `packages/mir/src/dsp/`
2. Add GPU compute shader if needed in `packages/mir/src/gpu/`
3. Integrate into runner in `packages/mir/src/runner/`
4. Add unit tests
5. Update TypeScript types
6. Document in JSDoc comments

### Adding a New Visualiser Feature

1. Implement in Rust in `packages/visualiser/src/`
2. Expose WASM bindings in `lib.rs`
3. Update TypeScript types in `packages/visualiser/pkg/`
4. Rebuild WASM: `pnpm build:wasm`
5. Use in React components

### Adding a UI Component

1. Create in appropriate domain folder: `apps/web/src/components/[domain]/`
2. Use Tailwind CSS for styling
3. Add proper TypeScript types
4. Wrap error-prone components with `<ErrorBoundary>`
5. Use semantic HTML and ARIA attributes for accessibility
6. Add to appropriate page or parent component

### Debugging WASM Issues

1. **Check browser console** - WASM errors appear there
2. **Enable debug logging**:
   ```rust
   log::info!("Debug value: {:?}", value);
   ```
3. **Use profiling build**:
   ```bash
   wasm-pack build --profiling
   ```
4. **Check memory limits** - WASM has 4GB limit
5. **Verify imports/exports** - Check `pkg/visualiser.d.ts`

### Database Migrations

1. Update schema: `apps/web/prisma/schema.prisma`
2. Generate migration:
   ```bash
   cd apps/web
   pnpm prisma migrate dev --name your_migration_name
   ```
3. Update TypeScript types:
   ```bash
   pnpm db:generate
   ```

## Getting Help

- **Documentation**: Check [ARCHITECTURE.md](ARCHITECTURE.md) and [CLAUDE.md](CLAUDE.md)
- **Issues**: Search existing GitHub issues or create a new one
- **Questions**: Open a discussion on GitHub Discussions

## License

By contributing, you agree that your contributions will be licensed under the same license as the project.
