export function buildAcceptedChunkOrders(
  canonicalOrder: readonly string[],
  acceptedOrders: readonly string[][] | undefined,
): string[][] {
  const out: string[][] = [];
  const seen = new Set<string>();
  for (const order of [canonicalOrder, ...(acceptedOrders ?? [])]) {
    if (order.length === 0) continue;
    if (!hasSameMembers(order, canonicalOrder)) continue;
    const key = order.join('\u0000');
    if (seen.has(key)) continue;
    seen.add(key);
    out.push([...order]);
  }
  return out;
}

export function isAcceptedChunkPrefix(
  acceptedOrders: readonly string[][],
  prefix: readonly string[],
): boolean {
  return acceptedOrders.some(
    (order) => prefix.length <= order.length && prefix.every((id, index) => order[index] === id),
  );
}

export function pickNextAcceptedChunkId(
  acceptedOrders: readonly string[][],
  prefix: readonly string[],
  candidateIds: readonly string[],
): string | undefined {
  for (const order of acceptedOrders) {
    if (!isAcceptedChunkPrefix([order], prefix)) continue;
    const next = order[prefix.length];
    if (next && candidateIds.includes(next)) return next;
  }
  return undefined;
}

export function isCompleteAcceptedOrder(
  acceptedOrders: readonly string[][],
  order: readonly string[],
): boolean {
  return acceptedOrders.some((candidate) => arraysEqual(candidate, order));
}

function hasSameMembers(order: readonly string[], canonicalOrder: readonly string[]): boolean {
  if (order.length !== canonicalOrder.length) return false;
  const canonicalIds = new Set(canonicalOrder);
  return order.every((id) => canonicalIds.has(id)) && new Set(order).size === canonicalIds.size;
}

function arraysEqual(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}
