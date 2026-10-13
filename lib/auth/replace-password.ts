import bcrypt from 'bcryptjs'
import { and, eq } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { authAccount, users } from '@/lib/db/schema'
import { provisionAuthIdentity } from '@/lib/auth/provision-user'

async function passwordIsStored(userId: string, password: string) {
  const db = getDb()
  const [person] = await db.select({ passwordHash: users.passwordHash }).from(users).where(eq(users.id, userId)).limit(1)
  const [account] = await db
    .select({
      password: authAccount.password,
      providerId: authAccount.providerId,
      issuer: authAccount.issuer,
      accountId: authAccount.accountId,
    })
    .from(authAccount)
    .where(and(eq(authAccount.userId, userId), eq(authAccount.providerId, 'credential')))
    .limit(1)

  const userOk = Boolean(person?.passwordHash && (await bcrypt.compare(password, person.passwordHash)))
  const accountOk = Boolean(account?.password && (await bcrypt.compare(password, account.password)))
  const identityOk =
    account?.providerId === 'credential' && account.issuer === 'local:credential' && account.accountId === userId
  return userOk && accountOk && identityOk && person?.passwordHash === account?.password
}

export async function replaceCredentialPassword(input: {
  userId: string
  email: string
  name: string
  password: string
  mustChangePassword?: boolean
}) {
  const db = getDb()
  const [existing] = await db
    .select({ passwordHash: users.passwordHash, mustChangePassword: users.mustChangePassword })
    .from(users)
    .where(eq(users.id, input.userId))
    .limit(1)

  const previousHash = existing?.passwordHash ?? null
  const previousMustChange = existing?.mustChangePassword ?? false
  const passwordHash = await bcrypt.hash(input.password, 10)
  const mustChangePassword = input.mustChangePassword ?? false

  async function restore() {
    await db
      .update(users)
      .set({ passwordHash: previousHash, mustChangePassword: previousMustChange })
      .where(eq(users.id, input.userId))
    if (!previousHash) return
    await provisionAuthIdentity({
      userId: input.userId,
      email: input.email,
      name: input.name,
      passwordHash: previousHash,
    })
  }

  await db.update(users).set({ passwordHash, mustChangePassword }).where(eq(users.id, input.userId))
  await provisionAuthIdentity({
    userId: input.userId,
    email: input.email,
    name: input.name,
    passwordHash,
  })

  if (!(await passwordIsStored(input.userId, input.password))) {
    await restore()
    throw new Error('The new password could not be stored.')
  }

  return { restore }
}
