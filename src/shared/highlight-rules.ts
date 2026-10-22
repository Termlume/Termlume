import { buildHighlightPattern } from './highlight-builder'

export interface HighlightRule {
  id: string
  name: string
  pattern: string
  mode: 'literal' | 'regex'
  color: string
  caseSensitive: boolean
  wholeLine: boolean
  enabled: boolean
}
export const DEFAULT_HIGHLIGHT_RULES: HighlightRule[] = [
  {
    id: 'error',
    name: 'Ошибки',
    pattern: '\\b(?:ERROR|FAILED)\\b',
    mode: 'regex',
    color: '#ef6461',
    caseSensitive: false,
    wholeLine: false,
    enabled: true,
  },
  {
    id: 'warning',
    name: 'Предупреждения',
    pattern: '\\bWARN(?:ING)?\\b',
    mode: 'regex',
    color: '#e5ad4f',
    caseSensitive: false,
    wholeLine: false,
    enabled: true,
  },
  {
    id: 'ok',
    name: 'Успешные операции',
    pattern: '\\bOK\\b',
    mode: 'regex',
    color: '#4dbb86',
    caseSensitive: false,
    wholeLine: false,
    enabled: true,
  },
]
export interface HighlightPreset {
  key: string
  description: string
  example: string
  rule: Omit<HighlightRule, 'id'>
}
const preset = (
  key: string,
  name: string,
  description: string,
  example: string,
  pattern: string,
  color: string,
): HighlightPreset => ({
  key,
  description,
  example,
  rule: {
    name,
    pattern,
    color,
    mode: 'regex',
    caseSensitive: false,
    wholeLine: false,
    enabled: true,
  },
})
const words = (text: string) => buildHighlightPattern({ text, condition: 'words' })
/** Optional library: existing defaults and saved rule sets are never expanded automatically. */
export const HIGHLIGHT_PRESETS: HighlightPreset[] = [
  preset(
    'info',
    'Информация',
    'Информационные сообщения: INFO и NOTICE.',
    'INFO: service ready',
    words('INFO\nNOTICE'),
    '#79b8ff',
  ),
  preset(
    'debug',
    'Отладка',
    'Диагностика DEBUG и TRACE.',
    'DEBUG: request received',
    words('DEBUG\nTRACE'),
    '#9aa6b2',
  ),
  preset(
    'critical',
    'Критические ошибки',
    'Аварии FATAL, CRITICAL, PANIC, EMERGENCY и ALERT.',
    'FATAL: process stopped',
    words('FATAL\nCRITICAL\nPANIC\nEMERGENCY\nALERT'),
    '#ff6b85',
  ),
  preset(
    'network',
    'Сетевые ошибки',
    'Таймауты, обрывы и недоступные узлы.',
    'Connection refused',
    words('TIMEOUT\nTIMED OUT\nCONNECTION REFUSED\nUNREACHABLE\nCONNECTION RESET\nDNS ERROR'),
    '#ef9b64',
  ),
  preset(
    'access',
    'Ошибки доступа',
    'Отказ в доступе и ошибки авторизации.',
    'Permission denied',
    words('PERMISSION DENIED\nACCESS DENIED\nUNAUTHORIZED\nFORBIDDEN\nAUTHENTICATION FAILED'),
    '#ef6461',
  ),
  preset(
    'http-success',
    'HTTP: успешный ответ',
    'Коды 2xx после HTTP/1.1, HTTP/2 или метки HTTP.',
    'HTTP/1.1 200 OK',
    '\\bHTTP(?:/\\d(?:\\.\\d)?)?\\s+2\\d{2}\\b',
    '#4dbb86',
  ),
  preset(
    'http-redirect',
    'HTTP: перенаправление',
    'Коды 3xx с меткой HTTP.',
    'HTTP/2 301 Moved',
    '\\bHTTP(?:/\\d(?:\\.\\d)?)?\\s+3\\d{2}\\b',
    '#79b8ff',
  ),
  preset(
    'http-client',
    'HTTP: ошибка запроса',
    'Коды 4xx: нет страницы, доступа или неверный запрос.',
    'HTTP/1.1 404 Not Found',
    '\\bHTTP(?:/\\d(?:\\.\\d)?)?\\s+4\\d{2}\\b',
    '#e5ad4f',
  ),
  preset(
    'http-server',
    'HTTP: ошибка сервера',
    'Коды 5xx с меткой HTTP.',
    'HTTP/2 503 Unavailable',
    '\\bHTTP(?:/\\d(?:\\.\\d)?)?\\s+5\\d{2}\\b',
    '#ef6461',
  ),
  preset(
    'ipv4',
    'IP-адреса',
    'IPv4-адреса, например 192.168.1.1.',
    'peer 192.168.1.1 connected',
    '(?<![\\w.])(?:25[0-5]|2[0-4]\\d|1\\d{2}|[1-9]?\\d)(?:\\.(?:25[0-5]|2[0-4]\\d|1\\d{2}|[1-9]?\\d)){3}(?![\\w.])',
    '#c3a6ff',
  ),
  preset(
    'unix-path',
    'Пути Linux',
    'Абсолютные пути Linux; адреса сайтов исключены.',
    'open /var/log/syslog',
    '(?<![\\w:/])/(?:[A-Za-z0-9_.~-]+/)*[A-Za-z0-9_.~-]+(?![A-Za-z0-9_./~-])',
    '#56c9bf',
  ),
  preset(
    'windows-path',
    'Пути Windows',
    'Пути с буквой диска, например C:\\Windows\\Temp.',
    'open C:\\Windows\\Temp',
    '\\b[A-Za-z]:\\\\[^\\s<>:"|?*]+',
    '#56c9bf',
  ),
]
export const MAX_HIGHLIGHT_LINE = 8192
export function highlightRuleError(rule: HighlightRule): string | undefined {
  if (!rule.name.trim()) return 'Укажите название правила.'
  if (!rule.pattern || rule.pattern.length > 256)
    return 'Выражение должно содержать от 1 до 256 символов.'
  if (!/^#[0-9a-f]{6}$/i.test(rule.color)) return 'Выберите цвет подсветки.'
  if (rule.mode === 'regex') {
    try {
      new RegExp(rule.pattern, rule.caseSensitive ? 'g' : 'gi')
    } catch {
      return 'Некорректное регулярное выражение.'
    }
  }
}
