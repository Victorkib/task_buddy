'use client'

import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { Button } from '@/components/ui/button'

/** Page confirms sit on the confirm layer. Drawer confirms sit just above the drawer they were opened from. */
export type ConfirmLayer = 'page' | 'drawer'

let openConfirms = 0

export function confirmLayerOpen() {
  return openConfirms > 0
}

export function ConfirmDialog({
  title,
  description,
  confirmLabel,
  pending = false,
  destructive = true,
  layer = 'page',
  onCancel,
  onConfirm,
  children,
}: {
  title: string
  description: string
  confirmLabel: string
  pending?: boolean
  destructive?: boolean
  layer?: ConfirmLayer
  onCancel: () => void
  onConfirm: () => void
  children?: ReactNode
}) {
  const dialogRef = useRef<HTMLDivElement>(null)
  const titleId = useId()
  const descriptionId = useId()
  const onCancelRef = useRef(onCancel)
  onCancelRef.current = onCancel

  useEffect(() => {
    openConfirms += 1
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    dialogRef.current?.querySelector<HTMLButtonElement>('[data-confirm-cancel]')?.focus()

    function onKey(event: KeyboardEvent) {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      onCancelRef.current()
    }

    window.addEventListener('keydown', onKey, true)
    return () => {
      openConfirms = Math.max(0, openConfirms - 1)
      window.removeEventListener('keydown', onKey, true)
      document.body.style.overflow = previousOverflow
      previouslyFocused?.focus?.()
    }
  }, [])

  function trapTab(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key !== 'Tab') return
    const root = dialogRef.current
    if (!root) return
    const items = [...root.querySelectorAll<HTMLElement>('button:not(:disabled), [href], input, select, textarea')].filter(
      (item) => !item.hasAttribute('disabled'),
    )
    if (items.length === 0) return
    const first = items[0]
    const last = items[items.length - 1]
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }

  if (typeof document === 'undefined') return null

  return createPortal(
    <div
      className="modal-backdrop confirm-backdrop"
      data-layer={layer}
      role="presentation"
      onMouseDown={(event) => {
        event.stopPropagation()
        if (!pending) onCancel()
      }}
    >
      <div
        ref={dialogRef}
        className="create-modal confirm-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        onMouseDown={(event) => event.stopPropagation()}
        onKeyDown={trapTab}
      >
        <div className="modal-heading">
          <div>
            <span className="eyebrow">{destructive ? 'Please confirm' : 'Confirm'}</span>
            <h2 id={titleId}>{title}</h2>
          </div>
          <button className="close-button" type="button" aria-label="Close dialog" onClick={onCancel} disabled={pending}>
            <X aria-hidden="true" />
          </button>
        </div>
        <p id={descriptionId} className="confirm-copy">
          {description}
        </p>
        {children}
        <div className="modal-actions">
          <Button data-confirm-cancel="" variant="outline" type="button" onClick={onCancel} disabled={pending}>
            Cancel
          </Button>
          <Button
            className={destructive ? undefined : 'create-button'}
            variant={destructive ? 'destructive' : 'default'}
            type="button"
            disabled={pending}
            onClick={onConfirm}
          >
            {pending ? 'Working…' : confirmLabel}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  )
}

export type ConfirmRequest = {
  title: string
  description: string
  confirmLabel: string
  destructive?: boolean
  layer?: ConfirmLayer
  onConfirm: () => void
}

export function useConfirm() {
  const [request, setRequest] = useState<ConfirmRequest | null>(null)
  const ask = useCallback((next: ConfirmRequest) => setRequest(next), [])
  const dialog = request ? (
    <ConfirmDialog
      title={request.title}
      description={request.description}
      confirmLabel={request.confirmLabel}
      destructive={request.destructive ?? true}
      layer={request.layer ?? 'page'}
      onCancel={() => setRequest(null)}
      onConfirm={() => {
        const run = request.onConfirm
        setRequest(null)
        run()
      }}
    />
  ) : null
  return { ask, dialog }
}
