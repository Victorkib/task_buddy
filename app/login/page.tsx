import type { Metadata, Viewport } from 'next'
import { redirect } from 'next/navigation'
import { LoginForm } from '@/components/auth/login-form'
import { LoginHero } from '@/components/auth/login-hero'
import { LoginLogo } from '@/components/auth/login-logo'
import { LoginSignedOutNotice } from '@/components/auth/login-signed-out'
import { PRODUCT_NAME, mailProductLabel, productTitle } from '@/lib/branding'
import { getAuthSession } from '@/lib/auth/session'
import { getUserById } from '@/lib/db/queries'

export const metadata: Metadata = {
  title: productTitle('Sign in'),
  description: `Secure sign in to ${PRODUCT_NAME} to manage work, projects, and collaboration.`,
}

export const viewport: Viewport = {
  colorScheme: 'dark',
  themeColor: '#020617',
  width: 'device-width',
  initialScale: 1,
}

function safeCallbackUrl(value: string | undefined) {
  if (!value || !value.startsWith('/') || value.startsWith('//')) return '/'
  return value
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ callbackUrl?: string; signedOut?: string }>
}) {
  const params = await searchParams
  const callbackUrl = safeCallbackUrl(params.callbackUrl)
  const signedOut = params.signedOut === '1'

  if (!signedOut) {
    const session = await getAuthSession()
    if (session?.user?.id) {
      const person = await getUserById(session.user.id)
      if (person && person.status === 'active') {
        const roleKeys = person.roles?.map((entry) => entry.role.key) ?? []
        if (callbackUrl !== '/') {
          redirect(callbackUrl)
        }
        if (roleKeys.includes('admin') || roleKeys.includes('managing_director')) {
          redirect('/?view=Home')
        }
        if (roleKeys.includes('department_head') || roleKeys.includes('manager')) {
          redirect('/?view=Departments')
        }
        redirect('/?view=My%20tasks')
      }
    }
  }

  return (
    <main className="auth-shell scheme-dark flex min-h-dvh w-full overflow-y-auto bg-slate-950 lg:h-dvh lg:overflow-hidden">
      <LoginHero />

      <section className="flex w-full flex-1 flex-col justify-center px-6 py-10 pb-[max(2.5rem,env(safe-area-inset-bottom))] sm:px-10 lg:overflow-y-auto lg:px-16 xl:px-24">
        <div className="mx-auto w-full max-w-md">
          <div className="mb-8 lg:hidden">
            <LoginLogo size="md" />
          </div>

          <div className="rounded-2xl border border-slate-800 bg-slate-900/80 p-6 shadow-2xl shadow-black/20 backdrop-blur-sm sm:p-8">
            <div className="mb-8">
              <h2 className="text-2xl font-semibold tracking-tight text-white">Welcome back</h2>
              <p className="mt-2 text-sm text-slate-400">
                Sign in to access tasks, projects, and the company reporting workspace.
              </p>
            </div>

            <LoginSignedOutNotice signedOut={signedOut} />
            <LoginForm callbackUrl={callbackUrl} />
          </div>

          <p className="mt-6 text-center text-xs text-slate-600">
            © 2026 {mailProductLabel()}. All rights reserved.
          </p>
        </div>
      </section>
    </main>
  )
}
