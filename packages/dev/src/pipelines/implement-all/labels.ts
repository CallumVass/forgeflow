/**
 * Label attached by the `/architecture` pipeline to RFC issues it creates.
 * Exported so the producer (architecture) and the consumer (`/implement-all`)
 * share a single source of truth.
 */
export const ARCHITECTURE_LABEL = "architecture" as const;

/**
 * Labels that `/implement-all` picks up. Must stay in sync with the labels
 * applied by upstream producers (issue-creator agents, architecture pipeline).
 */
export const IMPLEMENT_ALL_LABELS = ["auto-generated", ARCHITECTURE_LABEL] as const;
