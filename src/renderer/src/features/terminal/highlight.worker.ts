import { HighlightEngine } from './highlight-engine'
import type { HighlightRule } from '../../../../shared/highlight-rules'
const engine = new HighlightEngine()
self.onmessage = (event: MessageEvent<{ text: string; rules: HighlightRule[] }>) => {
  self.postMessage(engine.transform(event.data.text, event.data.rules))
}
