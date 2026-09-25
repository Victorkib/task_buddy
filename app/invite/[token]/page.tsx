import type { Metadata, Viewport } from 'next'
import Link from 'next/link'
import { AcceptInviteForm } from '@/components/auth/accept-invite-form'
import { LoginHero } from '@/components/auth/login-hero'
import { LoginLogo } from '@/components/auth/login-logo'
import { PRODUCT_NAME, productTitle } from '@/lib/branding'
import { getInvitePreview } from '@/app/invite-actions'

export const metadata: Metadata = {
  title: productTitle('Accept invite'),
  description: `Activate your ${PRODUCT_NAME} account and choose a password.`,
}

export const viewport: Viewport = {
  colorScheme: 'dark',
  themeColor: '#020617',
  width: 'device-width',
  initialScale: 1,
}

export default async function InviteAcceptPage({
  params,
}: {
  params: Promise<{ token: string }>
}) {
  const { token } = await params
  const preview = await getInvitePreview(token)
  const valid = 'ok' in preview && preview.ok

  return (
    <main className="auth-shell scheme-dark flex min-h-dvh w-full overflow-y-auto bg-slate-950 lg:h-dvh lg:overflow-hidden">
      <LoginHero />
      <section className="flex w-full flex-1 flex-col justify-center px-5 py-8 pb-[max(2rem,env(safe-area-inset-bottom))] sm:px-10 lg:overflow-y-auto lg:px-16 xl:px-24">
        <div className="mx-auto w-full max-w-md">
          <div className="mb-7 lg:hidden">
            <LoginLogo size="md" />
          </div>
          <div className="rounded-2xl border border-slate-800 bg-slate-900/80 p-5 shadow-2xl shadow-black/20 backdrop-blur-sm sm:p-8">
            <div className="mb-7">
              <p className="text-xs font-semibold tracking-[0.12em] text-emerald-400/90 uppercase">
                {valid ? 'Invitation' : 'Invite'}
              </p>
              <h2 className="mt-2 text-2xl font-semibold tracking-tight text-white sm:text-[1.7rem]">
                {valid ? `Welcome, ${preview.firstName}` : 'Invite unavailable'}
              </h2>
              <p className="mt-2 text-sm leading-relaxed text-slate-400">
                {valid
                  ? `Set your password to join${preview.departmentName ? ` ${preview.departmentName}` : ` ${PRODUCT_NAME}`}${preview.jobTitle ? ` as ${preview.jobTitle}` : ''}.`
                  : preview.error}
              </p>
            </div>

            {valid ? (
              <AcceptInviteForm
                token={token}
                email={preview.email}
                firstName={preview.firstName}
                jobTitle={preview.jobTitle}
                departmentName={preview.departmentName}
              />
            ) : (
              <div className="space-y-3">
                <Link
                  href="/login"
                  className="inline-flex h-11 w-full items-center justify-center rounded-lg bg-blue-600 text-base font-medium text-white transition-colors hover:bg-blue-500"
                >
                  Back to sign in
                </Link>
                <p className="text-center text-xs text-slate-500">
                  Ask your administrator to resend a fresh invite if this link expired.
                </p>
              </div>
            )}
          </div>
        </div>
      </section>
    </main>
  )
}
