export function isPendingOracleAuthority(input: { reason?: unknown }): boolean {
  return input.reason === "ORACLE_AUTHORITY_MISSING";
}
