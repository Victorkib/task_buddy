/** Product and company display names — single source for UI, email, and metadata. */
export const PRODUCT_NAME = 'Task Buddy'
export const PRODUCT_NAME_SHORT = 'Task Buddy'
export const PRODUCT_TAGLINE = 'Operational clarity for every team'

export const COMPANY_LEGAL_NAME = 'Globecon Convergence Solutions'
export const COMPANY_SHORT_NAME = 'GCS'
export const COMPANY_DISPLAY_NAME = `${COMPANY_LEGAL_NAME} (${COMPANY_SHORT_NAME})`

export function productTitle(suffix?: string) {
  return suffix ? `${PRODUCT_NAME} | ${suffix}` : PRODUCT_NAME
}

export function mailProductLabel() {
  return `${COMPANY_SHORT_NAME} ${PRODUCT_NAME}`
}
