export function hasRandomSuffix(projectId: string): boolean {
  const suffix = projectId.split('-').pop() ?? ''
  return suffix.length >= 4 && /[a-z]/.test(suffix) && /[0-9]/.test(suffix)
}
