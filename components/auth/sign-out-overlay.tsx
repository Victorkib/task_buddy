'use client'

import { useEffect, useSyncExternalStore } from 'react'
import { LoginBrandMark } from '@/components/auth/login-logo'
import { PRODUCT_NAME } from '@/lib/branding'
import {
  getSigningOutServerSnapshot,
  getSigningOutSnapshot,
  hydrateSigningOutFromStorage,
  signOutToLogin,
  subscribeSigningOut,
} from '@/lib/auth/sign-out-client'

const OVERLAY_FALLBACK_MS = 8000

export function SignOutOverlay() {
  const signingOut = useSyncExternalStore(
    subscribeSigningOut,
    getSigningOutSnapshot,
    getSigningOutServerSnapshot,
  )

  useEffect(() => {
    hydrateSigningOutFromStorage()
    window.addEventListener('pageshow', hydrateSigningOutFromStorage)
    return () => {
      window.removeEventListener('pageshow', hydrateSigningOutFromStorage)
    }
  }, [])

  useEffect(() => {
    if (!signingOut) return
    const fallback = window.setTimeout(() => {
      signOutToLogin()
    }, OVERLAY_FALLBACK_MS)
    return () => window.clearTimeout(fallback)
  }, [signingOut])

  if (!signingOut) return null

  return (
    <div
      className="fixed inset-0 z-[300] flex items-center justify-center overflow-hidden bg-slate-950 text-slate-200"
      role="status"
      aria-live="polite"
      aria-busy="true"
      aria-label="Signing you out"
    >
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.03)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.03)_1px,transparent_1px)] bg-[size:48px_48px]" />
      <div className="pointer-events-none absolute top-[18%] left-[8%] h-72 w-72 rounded-full bg-blue-600/20 blur-3xl" />
      <div className="pointer-events-none absolute right-[6%] bottom-[10%] h-64 w-64 rounded-full bg-emerald-500/15 blur-3xl" />

      <div className="relative flex w-[min(100%,24rem)] flex-col items-center px-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] text-center">
        <div className="relative mb-5 grid size-[5.75rem] place-items-center" aria-hidden="true">
          <span className="signout-ring absolute inset-0 rounded-full border-2 border-slate-500/20 border-t-blue-500 border-r-emerald-500" />
          <div className="relative grid size-14 place-items-center rounded-2xl bg-gradient-to-br from-blue-500/20 to-emerald-600/15 shadow-lg shadow-slate-950/40 ring-1 ring-white/10">
            <LoginBrandMark className="h-8 w-8" />
          </div>
        </div>
        <h1 className="text-lg font-semibold tracking-tight text-white">Signing you out</h1>
        <p className="mt-1.5 text-sm leading-relaxed text-slate-400">
          Clearing your {PRODUCT_NAME} session. This only takes a moment.
        </p>
        <div className="mt-5 h-1 w-40 overflow-hidden rounded-full bg-slate-500/20" aria-hidden="true">
          <span className="signout-bar-fill block h-full w-2/5 rounded-full bg-gradient-to-r from-blue-600 to-emerald-500" />
        </div>
      </div>
    </div>
  )
}
