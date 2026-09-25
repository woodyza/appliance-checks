export function randomString(length: number, alphabet: string): string {
  const maxValid = Math.floor(256 / alphabet.length) * alphabet.length
  const buffer = new Uint8Array(1)
  let result = ''
  while (result.length < length) {
    crypto.getRandomValues(buffer)
    const value = buffer[0]
    if (value >= maxValid) continue
    result += alphabet[value % alphabet.length]
  }
  return result
}
