import { createInterface } from 'node:readline/promises'

export async function ask(message: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  try {
    const answer = await rl.question(message)
    return answer.trim().toLowerCase() === 'y'
  } finally {
    rl.close()
  }
}

export async function confirm(message: string): Promise<void> {
  const proceed = await ask(message)
  if (!proceed) {
    throw new Error('Aborted.')
  }
}
