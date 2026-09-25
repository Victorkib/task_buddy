import { mailProductLabel } from '@/lib/branding'

export function LoginBrandMark({ className = '' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 48 48" fill="none" aria-hidden="true">
      <path
        d="M15.2 7.2h11.4l5.7 9.9-5.7 9.9H15.2L9.5 17.1 15.2 7.2Z"
        stroke="#60a5fa"
        strokeWidth="3.6"
        strokeLinejoin="round"
      />
      <path
        d="M21.4 21h11.4l5.7 9.9-5.7 9.9H21.4l-5.7-9.9L21.4 21Z"
        stroke="#22c55e"
        strokeWidth="3.6"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export function LoginLogo({ size = 'lg' }: { size?: 'md' | 'lg' }) {
  const title = size === 'lg' ? 'text-lg' : 'text-base'
  return (
    <div className="flex items-center gap-3">
      <div className={`relative flex shrink-0 items-center justify-center overflow-hidden rounded-xl bg-gradient-to-br from-blue-500/20 to-emerald-600/15 ring-1 ring-white/10 shadow-lg shadow-blue-900/30 ${size === 'lg' ? 'size-12' : 'size-10'}`}>
        <LoginBrandMark className={size === 'lg' ? 'h-8 w-8' : 'h-7 w-7'} />
      </div>
      <div className="min-w-0">
        <p className={`${title} font-semibold leading-tight tracking-tight text-white`}>{mailProductLabel()}</p>
        <p className="text-xs font-medium text-emerald-400">Operational workspace</p>
      </div>
    </div>
  )
}
