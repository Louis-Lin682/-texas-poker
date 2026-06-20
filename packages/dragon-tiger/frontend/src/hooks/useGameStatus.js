// Standalone: game is always open, no status check needed
export function useGameStatus() {
  return { status: 'open', notice: '' }
}
