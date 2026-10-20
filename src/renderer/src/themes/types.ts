import type { ThemeId } from '../../../shared/contracts'
export interface Theme {
  id: ThemeId
  name: string
  light: boolean
  colors: Record<string, string>
  ansi: string[]
}
