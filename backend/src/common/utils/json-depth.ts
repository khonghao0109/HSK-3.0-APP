/**
 * Iterative JSON depth check shared by the request-body backstop and by domain
 * validators that must bound their own payload (F2). It uses an explicit stack,
 * so the check itself cannot overflow on a hostile payload.
 */
export function exceedsJsonDepth(value: unknown, maxDepth: number): boolean {
  const pending: Array<{ value: unknown; depth: number }> = [
    { value, depth: 0 },
  ];
  while (pending.length > 0) {
    const current = pending.pop();
    if (current === undefined) break;
    const children = childValues(current.value);
    if (children === null) continue;
    if (current.depth + 1 > maxDepth) return true;
    for (const child of children) {
      pending.push({ value: child, depth: current.depth + 1 });
    }
  }
  return false;
}

function childValues(value: unknown): unknown[] | null {
  if (Array.isArray(value)) return value as unknown[];
  if (value !== null && typeof value === 'object') {
    return Object.values(value as Record<string, unknown>);
  }
  return null;
}
