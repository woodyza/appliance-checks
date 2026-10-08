export interface EmailMessage {
  to: string
  subject: string
  text: string
  html: string
  attachments?: { filename: string; content: Buffer }[]
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
