/**
 * Re-export shim. The canonical mock lives at `mocks/anthropic.ts` per
 * Slice 80 (productized for demo mode). Tests can import from here OR from
 * the new location; both work. New tests should prefer the canonical path.
 */
export { createMockAnthropic, type MockState, type MockOptions } from "../../mocks/anthropic";
