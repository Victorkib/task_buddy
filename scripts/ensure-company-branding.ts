/**
 * Updates companies.name / shortName to Globecon Convergence Solutions / GCS.
 * Safe to re-run. Usage: pnpm exec tsx scripts/ensure-company-branding.ts
 */
import { config } from 'dotenv'
import { eq } from 'drizzle-orm'
import { neon } from '@neondatabase/serverless'
import { drizzle } from 'drizzle-orm/neon-http'
import { COMPANY_LEGAL_NAME, COMPANY_SHORT_NAME } from '../lib/branding'
import { companies } from '../lib/db/schema'

config({ path: '.env.local' })
config()

const url = process.env.DATABASE_URL ?? process.env.DATABASE_URL_UNPOOLED
if (!url) {
  throw new Error('DATABASE_URL is not set.')
}

const db = drizzle({ client: neon(url) })

async function main() {
  const rows = await db.select({ id: companies.id, name: companies.name, shortName: companies.shortName }).from(companies)
  if (rows.length === 0) {
    console.log('No companies found. Run pnpm db:seed first.')
    return
  }

  let updated = 0
  for (const row of rows) {
    if (row.name === COMPANY_LEGAL_NAME && row.shortName === COMPANY_SHORT_NAME) {
      console.log(`Already set: ${row.name} (${row.shortName})`)
      continue
    }
    await db
      .update(companies)
      .set({ name: COMPANY_LEGAL_NAME, shortName: COMPANY_SHORT_NAME })
      .where(eq(companies.id, row.id))
    updated += 1
    console.log(`Updated ${row.name} → ${COMPANY_LEGAL_NAME} (${COMPANY_SHORT_NAME})`)
  }

  console.log(`Done. ${updated} compan${updated === 1 ? 'y' : 'ies'} updated.`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
