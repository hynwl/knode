import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** Tailwind 클래스 병합 헬퍼. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
