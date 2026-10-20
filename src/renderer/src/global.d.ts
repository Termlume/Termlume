/// <reference types="vite/client" />
import type { TerminalApi } from '../../shared/api'
declare global {
  interface Window {
    terminalApi: TerminalApi
  }
}
export {}
