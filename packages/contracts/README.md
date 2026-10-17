# Shared contracts

`schemas/` is authoritative JSON Schema (draft-07); `src/generated.ts` is generated
and committed. Run `pnpm contracts:generate` after editing schemas and review the
diff. Runtime JS validation uses Ajv without coercion or property removal.

The current event is schema v2, with exactly seven required top-level fields.
The retained `/api/devices/v1/stream` route name is not the payload version.
The confidence pair must also sum to one within 1e-6; `isInferenceEvent` enforces
this cross-field rule. Never add extra required fields without a spec decision.

`fixtures/inference-events.json` is synthetic, portable JSON for native QNX parity
tests. Chloe must implement a native validator or equivalent rules, run the same
fixtures on QNX and record evidence. Generated TS and desktop tests do not prove
native compatibility. Room geometry is a provisional DTO; Kiro must agree its
coordinate units and layout semantics before a floor-plan implementation.
