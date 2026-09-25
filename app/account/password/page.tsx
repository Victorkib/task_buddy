import type { Metadata, Viewport } from 'next'
import { redirect } from 'next/navigation'
import { ForcedPasswordForm } from '@/components/auth/forced-password-form'
import { LoginHero } from '@/components/auth/login-hero'
import { LoginLogo } from '@/components/auth/login-logo'
import { PRODUCT_NAME, productTitle } from '@/lib/branding'
import { getCurrentUser } from '@/lib/db/queries'

export const metadata: Metadata = {
  title: productTitle('Choose a new password'),
  description: `Replace your temporary ${PRODUCT_NAME} password before continuing.`,
}

export const viewport: Viewport = {
  colorScheme: 'dark',
  themeColor: '#020617',
  width: 'device-width',
  initialScale: 1,
}

export default async function ForcedPasswordPage() {
  const currentUser = await getCurrentUser()
  if (!currentUser) redirect('/login')
  if (!currentUser.mustChangePassword) redirect('/')

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
              <h2 className="text-2xl font-semibold tracking-tight text-white">Choose a new password</h2>
              <p className="mt-2 text-sm text-slate-400">
                Your temporary password must be replaced before you can use {PRODUCT_NAME}.
              </p>
            </div>
            <ForcedPasswordForm email={currentUser.email} />
          </div>
        </div>
      </section>
    </main>
  )
}
