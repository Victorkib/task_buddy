import type { Metadata, Viewport } from 'next'
import Link from 'next/link'
import { getPasswordResetPreview } from '@/app/invite-actions'
import { ResetPasswordForm } from '@/components/auth/reset-password-form'
import { LoginHero } from '@/components/auth/login-hero'
import { LoginLogo } from '@/components/auth/login-logo'
import { PRODUCT_NAME, productTitle } from '@/lib/branding'

export const metadata: Metadata = {
  title: productTitle('Reset password'),
  description: `Choose a new password for your ${PRODUCT_NAME} account.`,
}

export const viewport: Viewport = {
  colorScheme: 'dark',
  themeColor: '#020617',
  width: 'device-width',
  initialScale: 1,
}

export default async function ResetPasswordPage({
  params,
}: {
  params: Promise<{ token: string }>
}) {
  const { token } = await params
  const preview = await getPasswordResetPreview(token)

  return (
    <main className="auth-shell scheme-dark flex min-h-dvh w-full overflow-y-auto bg-slate-950 lg:h-dvh lg:overflow-hidden">
      <LoginHero />
      <section className="flex w-full flex-1 flex-col justify-center px-6 py-10 sm:px-10 lg:overflow-y-auto lg:px-16 xl:px-24">
        <div className="mx-auto w-full max-w-md">
          <div className="mb-8 lg:hidden">
            <LoginLogo size="md" />
          </div>
          <div className="rounded-2xl border border-slate-800 bg-slate-900/80 p-6 shadow-2xl shadow-black/20 backdrop-blur-sm sm:p-8">
            <div className="mb-8">
              <h2 className="text-2xl font-semibold tracking-tight text-white">
                {'ok' in preview ? `Hi ${preview.firstName}` : 'Reset link unavailable'}
              </h2>
              <p className="mt-2 text-sm text-slate-400">
                {'ok' in preview ? `Choose a new password for your ${PRODUCT_NAME} account.` : preview.error}
              </p>
            </div>
            {'ok' in preview && preview.ok ? (
              <ResetPasswordForm token={token} email={preview.email} />
            ) : (
              <div className="space-y-3">
                <Link href="/forgot-password" className="inline-flex h-11 w-full items-center justify-center rounded-lg bg-blue-600 text-base font-medium text-white hover:bg-blue-500">
                  Request a new link
                </Link>
                <Link href="/login" className="inline-flex h-11 w-full items-center justify-center rounded-lg border border-slate-700 text-base font-medium text-slate-200 hover:bg-slate-800">
                  Back to sign in
                </Link>
              </div>
            )}
          </div>
        </div>
      </section>
    </main>
  )
}
