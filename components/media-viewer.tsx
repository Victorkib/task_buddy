'use client'

import { useEffect, useId, useRef } from 'react'
import { ExternalLink, X } from 'lucide-react'
import { canInlinePreview, type MediaItem } from '@/lib/media-kind'

export function MediaViewer({
  item,
  onClose,
  onOpenTask,
}: {
  item: MediaItem
  onClose: () => void
  onOpenTask?: (taskId: string) => void
}) {
  const panelRef = useRef<HTMLElement | null>(null)
  const restoreFocusRef = useRef<HTMLElement | null>(null)
  const headingId = useId()
  const inline = canInlinePreview(item.kind)

  useEffect(() => {
    restoreFocusRef.current = document.activeElement as HTMLElement | null
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    panelRef.current?.focus()
    return () => {
      document.body.style.overflow = previousOverflow
      restoreFocusRef.current?.focus?.()
    }
  }, [])

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.stopPropagation()
        onClose()
      }
    }
    document.addEventListener('keydown', onKeyDown, true)
    return () => document.removeEventListener('keydown', onKeyDown, true)
  }, [onClose])

  return (
    <div className="media-viewer-scrim" role="presentation" onMouseDown={onClose}>
      <aside
        ref={panelRef}
        className="media-viewer-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
        tabIndex={-1}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="media-viewer-head">
          <div>
            <h2 id={headingId}>{item.title}</h2>
            <p>
              {item.sourceLabel ?? (item.kind === 'link' ? 'Link' : item.kind.toUpperCase())}
              {item.taskTitle ? ` · from ${item.taskTitle}` : ''}
            </p>
          </div>
          <div className="media-viewer-actions">
            {item.taskId && onOpenTask ? (
              <button type="button" className="ghost-button" onClick={() => onOpenTask(item.taskId!)}>
                Open task
              </button>
            ) : null}
            <a className="ghost-button" href={item.url} target="_blank" rel="noopener noreferrer">
              <ExternalLink aria-hidden="true" />
              Open
            </a>
            <button type="button" className="close-button" aria-label="Close preview" onClick={onClose}>
              <X aria-hidden="true" />
            </button>
          </div>
        </header>
        <div className="media-viewer-body">
          {item.kind === 'image' ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={item.url} alt={item.title} className="media-viewer-image" />
          ) : item.kind === 'video' ? (
            <video className="media-viewer-frame" src={item.url} controls playsInline />
          ) : inline ? (
            <iframe
              className="media-viewer-frame"
              title={item.title}
              src={item.url}
              sandbox="allow-scripts allow-same-origin allow-popups allow-forms"
              referrerPolicy="no-referrer"
            />
          ) : (
            <div className="media-viewer-fallback">
              <p>This file type cannot be previewed here.</p>
              <a className="create-button" href={item.url} target="_blank" rel="noopener noreferrer">
                Download / open file
              </a>
            </div>
          )}
        </div>
      </aside>
    </div>
  )
}
