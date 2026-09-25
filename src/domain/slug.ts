import { randomString } from './random'

export const SLUG_ALPHABET = '23456789abcdefghjkmnpqrstuvwxyz'
export const SLUG_LENGTH = 6
export const SLUG_PATTERN = '[2-9a-hjkmnp-z]{6}'
export const ID_PATTERN = '[2-9a-hjkmnp-z]{8}'

export function generateSlug(): string {
  return randomString(SLUG_LENGTH, SLUG_ALPHABET)
}

const ID_LENGTH = 8

export function newId(): string {
  return randomString(ID_LENGTH, SLUG_ALPHABET)
}
