/** Bump when the operator catalogue narrows. Missing epochs are preserved, but never trusted. */
export const AGENT_CONTRACT_EPOCH = 2;
export function currentAgentContract(row: { contractEpoch?: number }): boolean {
  return row.contractEpoch === AGENT_CONTRACT_EPOCH;
}
