export type SafeDataContextSummary = {
  totalEntries: number;
  sensitiveEntries: number;
  nonSensitiveEntries: number;
  availableKeys: Array<{
    key: string;
    source: string;
    sensitive: boolean;
  }>;
};
