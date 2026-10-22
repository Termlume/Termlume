import { useState } from 'react'
import Markdown from 'react-markdown'
import { releaseNotesText } from './release-notes'

export function ReleaseNotes({ text }: { text: string }) {
  const [error, setError] = useState('')
  const source =
    /<\/?(?:h[1-6]|p|ul|ol|li|div|br)\b/i.test(text) && !/^(?:#{1,6} |[-*] |```|> )/m.test(text)
      ? releaseNotesText(text)
      : text.slice(0, 100000)
  return (
    <div className="release-markdown">
      <Markdown
        skipHtml
        disallowedElements={['img']}
        components={{
          a: ({ href, children }) =>
            href && /^https?:\/\//i.test(href) ? (
              <a
                href={href}
                onClick={(event) => {
                  event.preventDefault()
                  void window.terminalApi.app
                    .openUrl(href)
                    .catch(() => setError('Не удалось открыть ссылку.'))
                }}
              >
                {children}
              </a>
            ) : (
              <span>{children}</span>
            ),
        }}
      >
        {source}
      </Markdown>
      {error && <p role="status">{error}</p>}
    </div>
  )
}
