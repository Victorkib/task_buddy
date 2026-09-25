'use client'

import { useActionState, useState, useSyncExternalStore, type FormEvent } from 'react'
import Link from 'next/link'
import { Eye, EyeOff, Loader2, Lock, Mail, ShieldCheck } from 'lucide-react'
import { authenticate, type LoginActionState } from '@/app/login/actions'
import { COMPANY_SHORT_NAME, PRODUCT_NAME } from '@/lib/branding'

const EMAIL_STORAGE_KEY = 'gcs-workhub-remember-email'
const initialState: LoginActionState = {}

function subscribeRememberedEmail() {
  return () => {}
}

function getRememberedEmail() {
  return window.localStorage.getItem(EMAIL_STORAGE_KEY) ?? ''
}

export function LoginForm({ callbackUrl }: { callbackUrl: string }) {
  const [showPassword, setShowPassword] = useState(false)
  const [remember, setRemember] = useState(true)
  const [notice, setNotice] = useState<string | null>(null)
  const rememberedEmail = useSyncExternalStore(subscribeRememberedEmail, getRememberedEmail, () => '')
  const [state, formAction, pending] = useActionState(authenticate, initialState)
  const error = state.error

  function persistEmail(event: FormEvent<HTMLFormElement>) {
    setNotice(null)
    const nextEmail = String(new FormData(event.currentTarget).get('email') ?? '').trim()
    if (remember && nextEmail) {
      window.localStorage.setItem(EMAIL_STORAGE_KEY, nextEmail)
    } else {
      window.localStorage.removeItem(EMAIL_STORAGE_KEY)
    }
  }

  return (
    <form action={formAction} onSubmit={persistEmail} className="space-y-5" aria-busy={pending}>
      <input type="hidden" name="callbackUrl" value={callbackUrl} />

      <div className="space-y-2">
        <label htmlFor="email" className="block text-sm font-medium text-slate-200">
          Work email
        </label>
        <div className="relative">
          <Mail className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-slate-500" aria-hidden="true" />
          <input
            id="email"
            key={rememberedEmail || 'email'}
            name="email"
            type="email"
            autoComplete="email"
            autoCapitalize="none"
            spellCheck={false}
            defaultValue={rememberedEmail}
            placeholder="you@globeconcs.com"
            disabled={pending}
            required
            enterKeyHint="next"
            className="h-11 w-full rounded-lg border border-slate-700 bg-slate-950/60 pr-3 pl-10 text-base text-white placeholder:text-slate-500 outline-none focus-visible:border-blue-500 focus-visible:ring-2 focus-visible:ring-blue-500/40 disabled:opacity-60 sm:text-sm"
          />
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between gap-3">
          <label htmlFor="password" className="block text-sm font-medium text-slate-200">
            Password
          </label>
          <Link href="/forgot-password" className="text-xs text-slate-400 transition-colors hover:text-slate-200">
            Forgot password?
          </Link>
        </div>
        <div className="relative">
          <Lock className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-slate-500" aria-hidden="true" />
          <input
            id="password"
            name="password"
            type={showPassword ? 'text' : 'password'}
            autoComplete="current-password"
            placeholder="Enter your password"
            disabled={pending}
            required
            minLength={8}
            enterKeyHint="go"
            className="h-11 w-full rounded-lg border border-slate-700 bg-slate-950/60 pr-10 pl-10 text-base text-white placeholder:text-slate-500 outline-none focus-visible:border-blue-500 focus-visible:ring-2 focus-visible:ring-blue-500/40 disabled:opacity-60 sm:text-sm"
          />
          <button
            type="button"
            className="absolute top-1/2 right-3 -translate-y-1/2 text-slate-500 transition-colors hover:text-slate-300"
            aria-label={showPassword ? 'Hide password' : 'Show password'}
            disabled={pending}
            onClick={() => setShowPassword((value) => !value)}
          >
            {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </div>
      </div>

      <label className="flex items-center gap-2 text-sm text-slate-300">
        <input
          type="checkbox"
          name="remember"
          checked={remember}
          disabled={pending}
          onChange={(event) => setRemember(event.target.checked)}
          className="h-4 w-4 rounded border-slate-600 accent-blue-500"
        />
        Remember my email on this device
      </label>

      {notice ? (
        <div role="status" className="rounded-lg border border-blue-500/30 bg-blue-500/10 px-4 py-3 text-sm text-blue-100">
          {notice}
        </div>
      ) : null}

      {error && !notice ? (
        <div role="alert" aria-live="assertive" className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          {error}
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
            Signing in…
          </>
        ) : (
          `Sign in to ${PRODUCT_NAME}`
        )}
      </button>

      <p className="flex items-center justify-center gap-2 text-center text-xs text-slate-500">
        <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
        Role-based access · {COMPANY_SHORT_NAME} personnel only
      </p>

      <p className="text-center text-xs text-slate-500">
        Don&apos;t have an account?{' '}
        <button
          className="text-slate-300 transition-colors hover:text-white"
          type="button"
          onClick={() => setNotice(`Ask your ${PRODUCT_NAME} administrator to provision your account.`)}
        >
          Contact your administrator
        </button>
      </p>
    </form>
  )
}
