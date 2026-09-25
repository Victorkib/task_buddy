'use client'

import { useActionState, useMemo, useState } from 'react'
import { Check, Eye, EyeOff, Loader2, Lock, ShieldCheck } from 'lucide-react'
import { acceptInvite } from '@/app/invite-actions'
import { PRODUCT_NAME } from '@/lib/branding'
import Link from 'next/link'

type AcceptState = { error?: string; ok?: true; signedIn?: false; email?: string }

const initialState: AcceptState = {}

function passwordScore(value: string) {
  let score = 0
  if (value.length >= 8) score += 1
  if (value.length >= 12) score += 1
  if (/[A-Z]/.test(value) && /[a-z]/.test(value)) score += 1
  if (/\d/.test(value)) score += 1
  if (/[^A-Za-z0-9]/.test(value)) score += 1
  return Math.min(score, 4)
}

export function AcceptInviteForm({
  token,
  email,
  firstName,
  jobTitle,
  departmentName,
}: {
  token: string
  email: string
  firstName: string
  jobTitle?: string | null
  departmentName?: string | null
}) {
  const [showPassword, setShowPassword] = useState(false)
  const [password, setPassword] = useState('')
  const score = useMemo(() => passwordScore(password), [password])
  const scoreLabel = ['Too short', 'Weak', 'Okay', 'Strong', 'Excellent'][score] ?? 'Too short'
  const [state, formAction, pending] = useActionState(
    async (_prev: AcceptState, formData: FormData): Promise<AcceptState> => {
      const result = await acceptInvite(formData)
      if (result && 'error' in result && result.error) return { error: result.error }
      if (result && 'ok' in result) return result
      return {}
    },
    initialState,
  )

  if (state.ok && state.signedIn === false) {
    return (
      <div className="space-y-5">
        <div role="status" className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-4 text-sm text-emerald-100">
          <div className="mb-1 flex items-center gap-2 font-semibold text-emerald-50">
            <Check className="h-4 w-4" aria-hidden="true" />
            Account activated
          </div>
          Welcome, {firstName}. Sign in with {state.email ?? email} to open {PRODUCT_NAME}.
        </div>
        <Link
          href="/login"
          className="inline-flex h-11 w-full items-center justify-center rounded-lg bg-blue-600 text-base font-medium text-white transition-colors hover:bg-blue-500"
        >
          Continue to sign in
        </Link>
      </div>
    )
  }

  return (
    <form action={formAction} className="space-y-5" aria-busy={pending}>
      <input type="hidden" name="token" value={token} />

      <div className="rounded-xl border border-slate-700/80 bg-slate-950/45 p-4">
        <p className="text-xs font-semibold tracking-[0.08em] text-slate-500 uppercase">Your account</p>
        <p className="mt-2 text-sm font-medium text-white">{email}</p>
        <p className="mt-1 text-xs text-slate-400">
          {[jobTitle, departmentName].filter(Boolean).join(' · ') || PRODUCT_NAME}
        </p>
      </div>

      <div className="space-y-2">
        <label htmlFor="password" className="block text-sm font-medium text-slate-200">
          Create password
        </label>
        <div className="relative">
          <Lock className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-slate-500" aria-hidden="true" />
          <input
            id="password"
            name="password"
            type={showPassword ? 'text' : 'password'}
            autoComplete="new-password"
            required
            minLength={8}
            disabled={pending}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="At least 8 characters"
            className="h-11 w-full rounded-lg border border-slate-700 bg-slate-950/60 pr-10 pl-10 text-base text-white placeholder:text-slate-500 outline-none focus-visible:border-blue-500 focus-visible:ring-2 focus-visible:ring-blue-500/40 disabled:opacity-60 sm:text-sm"
          />
          <button
            type="button"
            className="absolute top-1/2 right-3 -translate-y-1/2 text-slate-500 transition-colors hover:text-slate-300"
            aria-label={showPassword ? 'Hide password' : 'Show password'}
            onClick={() => setShowPassword((value) => !value)}
          >
            {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </div>
        <div className="flex items-center gap-3 pt-1" aria-live="polite">
          <div className="grid flex-1 grid-cols-4 gap-1">
            {[0, 1, 2, 3].map((index) => (
              <span
                key={index}
                className={`h-1 rounded-full ${score > index ? 'bg-emerald-400' : 'bg-slate-700'}`}
              />
            ))}
          </div>
          <span className="text-xs text-slate-400">{password ? scoreLabel : 'Min 8 characters'}</span>
        </div>
      </div>

      <div className="space-y-2">
        <label htmlFor="confirmPassword" className="block text-sm font-medium text-slate-200">
          Confirm password
        </label>
        <input
          id="confirmPassword"
          name="confirmPassword"
          type={showPassword ? 'text' : 'password'}
          autoComplete="new-password"
          required
          minLength={8}
          disabled={pending}
          placeholder="Repeat your password"
          className="h-11 w-full rounded-lg border border-slate-700 bg-slate-950/60 px-3 text-base text-white placeholder:text-slate-500 outline-none focus-visible:border-blue-500 focus-visible:ring-2 focus-visible:ring-blue-500/40 disabled:opacity-60 sm:text-sm"
        />
      </div>

      {state.error ? (
        <div role="alert" className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          {state.error}
        </div>
      ) : null}

      <button
        type="submit"
        disabled={pending}
        className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-blue-600 text-base font-medium text-white transition-colors hover:bg-blue-500 disabled:cursor-wait disabled:opacity-80"
      >
        {pending ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            Activating…
          </>
        ) : (
          `Activate and open ${PRODUCT_NAME}`
        )}
      </button>

      <p className="flex items-center justify-center gap-2 text-center text-xs text-slate-500">
        <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
        Secure invite · expires after use
      </p>
    </form>
  )
}
