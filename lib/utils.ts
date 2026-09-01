import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export const COLORS = [
  "#dc2626", "#d97706", "#65a30d", "#16a34a", "#059669",
  "#0891b2", "#0284c7", "#4f46e5", "#7c3aed", "#c026d3",
  "#db2777", "#e11d48", "#9333ea", "#4f46e5", "#0ea5e9",
]

export function getUserColor(id: string) {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = id.charCodeAt(i) + ((hash << 5) - hash);
  }
  const index = Math.abs(hash) % COLORS.length;
  return COLORS[index];
}
