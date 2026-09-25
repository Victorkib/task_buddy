import { PRODUCT_NAME, PRODUCT_TAGLINE, productTitle } from '@/lib/branding'
import { Inter } from 'next/font/google'
import type { Metadata, Viewport } from 'next'
import { SignOutOverlay } from '@/components/auth/sign-out-overlay'
import { getMetadataBase } from '@/lib/env'
import './globals.css'

const inter = Inter({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-inter',
})

const metadataBase = getMetadataBase()

export const metadata: Metadata = {
  title: productTitle(PRODUCT_TAGLINE),
  description: `${PRODUCT_NAME} is the single source of truth for responsibilities, tasks, deadlines, and department progress at Globecon Convergence Solutions.`,
  generator: PRODUCT_NAME,
  ...(metadataBase ? { metadataBase } : {}),
}

export const viewport: Viewport = {
  colorScheme: 'light',
  themeColor: '#123056',
  width: 'device-width',
  initialScale: 1,
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${inter.variable} ${inter.className}`}>
      <body className="antialiased">
        {children}
        <SignOutOverlay />
      </body>
    </html>
  )
}
