export function isPermissionDenied(err: unknown): boolean {
  return typeof err === 'object' && err !== null && 'code' in err && err.code === 'permission-denied'
}
