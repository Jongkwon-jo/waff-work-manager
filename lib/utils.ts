import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function keepIfShallowEqual<T>(prev: T[], next: T[]): T[] {
  if (prev === next) return prev
  if (prev.length !== next.length) return next
  for (let i = 0; i < prev.length; i += 1) {
    if (prev[i] !== next[i]) return next
  }
  return prev
}
