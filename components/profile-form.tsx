'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Loader2, Eye, EyeOff } from 'lucide-react'
import {
  changeOwnPassword,
  removeOwnAvatar,
  setOwnAvatar,
  updateNotificationPreferences,
  updateOwnProfile,
} from '@/app/actions'
import { FileDropzone } from '@/components/uploads/file-dropzone'
import { UserAvatar } from '@/components/user-avatar'
import { PRODUCT_NAME } from '@/lib/branding'
import { AVATAR_COLORS } from '@/lib/constants'
import { signOutToLogin } from '@/lib/auth/sign-out-client'

type Prefs = {
  deadlineAlerts: number
  escalationAlerts: number
  approvalAlerts: number
  managementRequestAlerts: number
  dailySummary: number
}

export function ProfileForm({
  user,
  preferences,
  departmentName,
  roleLabels,
  lastLoginLabel,
}: {
  user: {
    id: string
    firstName: string
    lastName: string
    jobTitle: string
    email: string
    initials: string
    avatarColor: string
    avatarUrl?: string | null
  }
  preferences: Prefs
  departmentName: string | null
  roleLabels: string[]
  lastLoginLabel: string
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [photoBusy, setPhotoBusy] = useState(false)
  const [signingOut, setSigningOut] = useState(false)
  const [avatarUrl, setAvatarUrl] = useState(user.avatarUrl ?? null)
  const [initials, setInitials] = useState(user.initials)
  const [color, setColor] = useState(user.avatarColor)
  const [profileError, setProfileError] = useState<string | null>(null)
  const [profileOk, setProfileOk] = useState<string | null>(null)
  const [passwordError, setPasswordError] = useState<string | null>(null)
  const [passwordOk, setPasswordOk] = useState<string | null>(null)
  const [photoError, setPhotoError] = useState<string | null>(null)
  const [prefsOk, setPrefsOk] = useState<string | null>(null)

  return (
    <div className="profile-grid">
      <section className="panel profile-card">
        <div className="panel-heading">
          <div>
            <h2>Photo</h2>
            <p>Shown in the top bar, task rows, comments, and people lists.</p>
          </div>
        </div>
        <div className="profile-photo-row">
          <UserAvatar initials={initials} url={avatarUrl} color={color} size="lg" />
          <div className="profile-photo-copy">
            <strong>
              {user.firstName} {user.lastName}
            </strong>
            <span>{user.jobTitle}</span>
            {photoError ? (
              <p className="form-error" role="alert">
                {photoError}
              </p>
            ) : null}
            <FileDropzone
              kind="user_avatar"
              entityId={user.id}
              disabled={photoBusy || pending}
              label={avatarUrl ? 'Replace photo' : 'Upload photo'}
              onUploaded={async (file) => {
                setPhotoBusy(true)
                setPhotoError(null)
                const result = await setOwnAvatar({ url: file.url, publicId: file.publicId })
                setPhotoBusy(false)
                if (result && 'error' in result && result.error) {
                  setPhotoError(result.error)
                  return
                }
                setAvatarUrl(file.url)
                router.refresh()
              }}
            />
            {avatarUrl ? (
              <button
                type="button"
                className="text-back"
                disabled={photoBusy || pending}
                onClick={() => {
                  setPhotoBusy(true)
                  setPhotoError(null)
                  startTransition(async () => {
                    const result = await removeOwnAvatar()
                    setPhotoBusy(false)
                    if (result && 'error' in result && result.error) {
                      setPhotoError(result.error)
                      return
                    }
                    setAvatarUrl(null)
                    router.refresh()
                  })
                }}
              >
                Remove photo
              </button>
            ) : null}
          </div>
        </div>
      </section>

      <section className="panel profile-card">
        <div className="panel-heading">
          <div>
            <h2>Workspace identity</h2>
            <p>This is how colleagues see you across {PRODUCT_NAME}.</p>
          </div>
        </div>
        <form
          className="profile-form"
          onSubmit={(event) => {
            event.preventDefault()
            const form = event.currentTarget
            const payload = {
              firstName: String(new FormData(form).get('firstName') ?? ''),
              lastName: String(new FormData(form).get('lastName') ?? ''),
              jobTitle: String(new FormData(form).get('jobTitle') ?? ''),
              email: String(new FormData(form).get('email') ?? ''),
              avatarColor: color,
            }
            setProfileError(null)
            setProfileOk(null)
            startTransition(async () => {
              const result = await updateOwnProfile(payload)
              if (result && 'error' in result && result.error) {
                setProfileError(result.error)
                return
              }
              if (result && 'initials' in result && result.initials) setInitials(result.initials)
              setProfileOk('Saved. Your name and details now show across the workspace.')
              router.refresh()
            })
          }}
        >
          <div className="profile-fields">
            <label>
              First name
              <input name="firstName" defaultValue={user.firstName} required autoComplete="given-name" />
            </label>
            <label>
              Last name
              <input name="lastName" defaultValue={user.lastName} required autoComplete="family-name" />
            </label>
            <label className="span-2">
              Job title
              <input name="jobTitle" defaultValue={user.jobTitle} required autoComplete="organization-title" />
            </label>
            <label className="span-2">
              Work email
              <input name="email" type="email" defaultValue={user.email} required autoComplete="email" />
            </label>
          </div>
          <fieldset className="avatar-color-set">
            <legend>Avatar color</legend>
            <p>Used when you do not have a photo.</p>
            <div className="avatar-color-options">
              {AVATAR_COLORS.map((option) => (
                <button
                  key={option}
                  type="button"
                  className={`avatar-color-choice${color === option ? ' is-selected' : ''}`}
                  onClick={() => setColor(option)}
                  aria-pressed={color === option}
                  aria-label={option}
                >
                  <UserAvatar initials={initials} url={null} color={option} />
                  <span>{option}</span>
                </button>
              ))}
            </div>
          </fieldset>
          {profileError ? (
            <p className="form-error" role="alert">
              {profileError}
            </p>
          ) : null}
          {profileOk ? <p className="form-ok">{profileOk}</p> : null}
          <button className="create-button" type="submit" disabled={pending}>
            {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
            Save details
          </button>
        </form>
      </section>

      <section className="panel profile-card">
        <div className="panel-heading">
          <div>
            <h2>Password</h2>
            <p>At least 8 characters. You stay signed in after a successful change.</p>
          </div>
        </div>
        <form
          className="profile-form"
          onSubmit={(event) => {
            event.preventDefault()
            const form = event.currentTarget
            const data = new FormData(form)
            setPasswordError(null)
            setPasswordOk(null)
            startTransition(async () => {
              const result = await changeOwnPassword({
                currentPassword: String(data.get('currentPassword') ?? ''),
                nextPassword: String(data.get('nextPassword') ?? ''),
                confirmPassword: String(data.get('confirmPassword') ?? ''),
              })
              if (result && 'error' in result && result.error) {
                setPasswordError(result.error)
                return
              }
              form.reset()
              setPasswordOk('Password updated.')
            })
          }}
        >
          <div className="profile-fields">
            <PasswordField
              className="span-2"
              name="currentPassword"
              label="Current password"
              autoComplete="current-password"
            />
            <PasswordField name="nextPassword" label="New password" autoComplete="new-password" minLength={8} />
            <PasswordField
              name="confirmPassword"
              label="Confirm new password"
              autoComplete="new-password"
              minLength={8}
            />
          </div>
          {passwordError ? (
            <p className="form-error" role="alert">
              {passwordError}
            </p>
          ) : null}
          {passwordOk ? <p className="form-ok">{passwordOk}</p> : null}
          <button className="create-button" type="submit" disabled={pending}>
            Update password
          </button>
        </form>
      </section>

      <section className="panel profile-card">
        <div className="panel-heading">
          <div>
            <h2>Alert preferences</h2>
            <p>These also appear in Settings and the profile menu on the main workspace.</p>
          </div>
        </div>
        <form
          className="notification-preferences settings-preferences"
          action={(formData) => {
            setPrefsOk(null)
            startTransition(async () => {
              await updateNotificationPreferences(formData)
              setPrefsOk('Alert preferences saved.')
              router.refresh()
            })
          }}
        >
          <label>
            <input type="checkbox" name="deadlineAlerts" defaultChecked={Boolean(preferences.deadlineAlerts)} /> Deadline
            alerts
          </label>
          <label>
            <input type="checkbox" name="escalationAlerts" defaultChecked={Boolean(preferences.escalationAlerts)} />{' '}
            Escalation alerts
          </label>
          <label>
            <input type="checkbox" name="approvalAlerts" defaultChecked={Boolean(preferences.approvalAlerts)} /> Approval
            alerts
          </label>
          <label>
            <input
              type="checkbox"
              name="managementRequestAlerts"
              defaultChecked={Boolean(preferences.managementRequestAlerts)}
            />{' '}
            Management request alerts
          </label>
          <label>
            <input type="checkbox" name="dailySummary" defaultChecked={Boolean(preferences.dailySummary)} /> Daily and
            periodic summaries
          </label>
          {prefsOk ? <p className="form-ok">{prefsOk}</p> : null}
          <button className="create-button" type="submit" disabled={pending}>
            Save preferences
          </button>
        </form>
      </section>

      <section className="panel profile-card profile-meta">
        <div className="panel-heading">
          <div>
            <h2>Account</h2>
            <p>Read-only details from this workspace.</p>
          </div>
        </div>
        <dl className="profile-dl">
          <div>
            <dt>Department</dt>
            <dd>{departmentName ?? 'Unassigned'}</dd>
          </div>
          <div>
            <dt>Roles</dt>
            <dd>{roleLabels.length ? roleLabels.join(' · ') : 'Employee'}</dd>
          </div>
          <div>
            <dt>Last sign-in</dt>
            <dd>{lastLoginLabel}</dd>
          </div>
        </dl>
        <div className="profile-account-actions">
          <Link className="text-back" href="/?view=Home">
            Open Home
          </Link>
          <button
            type="button"
            className="profile-sign-out"
            disabled={signingOut}
            onClick={() => {
              if (signingOut) return
              setSigningOut(true)
              signOutToLogin()
            }}
          >
            {signingOut ? 'Signing out…' : 'Sign out'}
          </button>
        </div>
      </section>
    </div>
  )
}

function PasswordField({
  name,
  label,
  autoComplete,
  minLength,
  className,
}: {
  name: string
  label: string
  autoComplete: string
  minLength?: number
  className?: string
}) {
  const [visible, setVisible] = useState(false)
  return (
    <label className={className} htmlFor={name}>
      {label}
      <span className="password-field">
        <input
          id={name}
          name={name}
          type={visible ? 'text' : 'password'}
          autoComplete={autoComplete}
          minLength={minLength}
          required
        />
        <button
          type="button"
          className="password-toggle"
          aria-label={visible ? `Hide ${label.toLowerCase()}` : `Show ${label.toLowerCase()}`}
          aria-pressed={visible}
          onClick={() => setVisible((value) => !value)}
        >
          {visible ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
        </button>
      </span>
    </label>
  )
}
