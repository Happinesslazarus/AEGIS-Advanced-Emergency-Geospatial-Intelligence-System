export function validateReport(data: any): { valid: boolean; errors: string[] } {
  const errors: string[] = []
  if (!data.description || data.description.length < 10) errors.push('Description must be at least 10 characters')
  if (data.description && data.description.length > 2000) errors.push('Description must be under 2000 characters')
  if (!data.location || data.location.length < 3) errors.push('Location is required')
  if (!data.severity || !['Low','Medium','High'].includes(data.severity)) errors.push('Severity is required')
  if (!data.trappedPersons || !['yes','property','no'].includes(data.trappedPersons)) errors.push('Trapped persons status is required')
  if (!data.incidentCategory) errors.push('Incident category is required')
  return { valid: errors.length === 0, errors }
}
export function validateEmail(e: string): boolean { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) }
export function sanitizeInput(s: string): string { return s.replace(/[<>'"]/g, '') }
