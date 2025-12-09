// Global debug configuration
export const DEBUG = true;

// Logger function that respects the global DEBUG setting
export function log(...args) {
  if (DEBUG) {
    console.log(...args);
  }
}