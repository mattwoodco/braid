/**
 * Slice 20 §2.A4 — single adapter for Anthropic SDK surfaces the published
 * TypeScript types don't yet expose.
 *
 * Background: Memory stores and dreams are part of the Managed Agents beta
 * surface (`managed-agents-2026-04-01` and `dreaming-2026-04-21` beta
 * headers). The @anthropic-ai/sdk@0.96.0 types don't yet include
 * `c.beta.memoryStores`, so call sites would otherwise sprinkle
 * `(c.beta as unknown as { ... })` casts throughout the codebase. Each
 * additional cast is a future-breakage surface.
 *
 * This module is the ONLY place a `c.beta as unknown` cast appears for the
 * memory-store API. When the SDK adds first-class types, only this file
 * changes.
 *
 * Authoritative beta surface:
 *   https://platform.claude.com/docs/en/managed-agents/quickstart
 *   beta header: `managed-agents-2026-04-01`
 */

import Anthropic from "@anthropic-ai/sdk";

export type CreatedMemoryStore = { id: string };
export type CreatedMemory = { id: string };

type MemoryStoresApi = {
  create: (args: { name: string }) => Promise<CreatedMemoryStore>;
  memories: {
    create: (
      storeId: string,
      args: { path: string; content: string },
    ) => Promise<CreatedMemory>;
  };
};

/** Internal: narrow `c.beta` to the typed memory-store surface. The only
 * `as unknown as` cast in the codebase against `c.beta.memoryStores`. */
function memoryStoresApi(client: Anthropic): MemoryStoresApi {
  return (client.beta as unknown as { memoryStores: MemoryStoresApi })
    .memoryStores;
}

/** Create a memory store with the given display name. */
export async function createMemoryStore(
  client: Anthropic,
  name: string,
): Promise<CreatedMemoryStore> {
  return memoryStoresApi(client).create({ name });
}

/** Write a memory entry into an existing store at the given path. */
export async function createMemory(
  client: Anthropic,
  storeId: string,
  args: { path: string; content: string },
): Promise<CreatedMemory> {
  return memoryStoresApi(client).memories.create(storeId, args);
}
