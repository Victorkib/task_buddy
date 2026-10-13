'use client'

import { useState, useTransition } from 'react'
import { KeyRound, X } from 'lucide-react'
import { sendPersonPasswordReset, setPersonTemporaryPassword } from '@/app/invite-actions'
import { Button } from '@/components/ui/button'
import { fullName } from '@/lib/format'

type Target = {
  id: string
  email: string
  firstName: string
  lastName: string
}

export function ResetPersonPasswordDialog({ person, onClose }: { person: Target; onClose: () => void }) {
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [resetUrl, setResetUrl] = useState<string | null>(null)
  const [temporaryPassword, setTemporaryPassword] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const name = fullName(person)

  function emailLink() {
    setError(null)
    startTransition(async () => {
      const result = await sendPersonPasswordReset(person.id)
      if (result && 'error' in result && result.error) {
        setError(result.error)
        return
      }
      if (result && 'ok' in result && result.ok) {
        setMessage(result.message)
        setResetUrl(result.resetUrl)
        setTemporaryPassword(null)
      }
    })
  }

  function temporary() {
    setError(null)
    startTransition(async () => {
      const result = await setPersonTemporaryPassword(person.id)
      if (result && 'error' in result && result.error) {
        setError(result.error)
        return
      }
      if (result && 'ok' in result && result.ok) {
        setMessage(result.message)
        setTemporaryPassword(result.temporaryPassword)
        setResetUrl(null)
      }
    })
  }

  async function copy(value: string) {
    try {
      await navigator.clipboard.writeText(value)
    } catch {
      setError('Copy failed. Select the value and copy it manually.')
    }
  }

  return (
    <div className="modal-backdrop confirm-backdrop" role="presentation" onMouseDown={onClose}>
      <div
        className="create-modal remove-person-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="reset-person-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="modal-heading">
          <div>
            <span className="eyebrow">People</span>
            <h2 id="reset-person-title">Reset password for {name}</h2>
            <p>Email a link, or set a temporary password they must replace at the next sign-in.</p>
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Close">
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
        <div className="modal-body">
          <p className="text-sm text-slate-600">
            This applies to <strong>{person.email}</strong>. A temporary password signs them out of every current session.
          </p>
          {message ? <p className="form-ok">{message}</p> : null}
          {resetUrl ? (
            <div className="profile-fields">
              <label className="span-2">
                Reset link
                <input readOnly value={resetUrl} onFocus={(event) => event.currentTarget.select()} />
              </label>
              <Button type="button" variant="outline" onClick={() => copy(resetUrl)}>
                Copy link
              </Button>
            </div>
          ) : null}
          {temporaryPassword ? (
            <div className="profile-fields">
              <label className="span-2">
                Temporary password
                <input readOnly value={temporaryPassword} onFocus={(event) => event.currentTarget.select()} />
              </label>
              <Button type="button" variant="outline" onClick={() => copy(temporaryPassword)}>
                Copy password
              </Button>
            </div>
          ) : null}
          {error ? (
            <p className="form-error" role="alert">
              {error}
            </p>
          ) : null}
        </div>
        <div className="modal-actions">
          <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
            Close
          </Button>
          <Button type="button" variant="outline" onClick={emailLink} disabled={pending}>
            <KeyRound data-icon="inline-start" />
            Email reset link
          </Button>
          <Button type="button" onClick={temporary} disabled={pending}>
            {pending ? 'Saving…' : 'Set temporary password'}
          </Button>
        </div>
      </div>
    </div>
  )
}
