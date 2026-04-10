/** Label attached by the `/architecture` pipeline to RFC issues it creates. */
export const ARCHITECTURE_LABEL = "architecture" as const;

/** Labels that `/implement-all` picks up from upstream producers. */
export const IMPLEMENT_ALL_LABELS = ["auto-generated", ARCHITECTURE_LABEL] as const;
