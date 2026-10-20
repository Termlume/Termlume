export function sessionSourceText(source?: 'who' | 'loginctl' | 'process' | 'current-connection') {
  switch (source) {
    case 'who':
      return 'who'
    case 'loginctl':
      return 'Сеансы системы (loginctl)'
    case 'process':
      return 'Процессы сервера'
    case 'current-connection':
      return 'Текущее SSH-подключение'
    default:
      return 'who'
  }
}
