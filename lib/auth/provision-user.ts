import { eq } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { authAccount, authSession, authUser, users } from '@/lib/db/schema'
import { fullName } from '@/lib/format'

export async function provisionAuthIdentity(input: {
  userId: string
  email: string
  name: string
  passwordHash: string
}) {
  const db = getDb()
  const email = input.email.toLowerCase()
  const now = new Date()

  const [existingUser] = await db.select({ id: authUser.id }).from(authUser).where(eq(authUser.id, input.userId)).limit(1)
  if (!existingUser) {
    await db.insert(authUser).values({
      id: input.userId,
      name: input.name,
      email,
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
    })
  } else {
    await db
      .update(authUser)
      .set({ name: input.name, email, emailVerified: true, updatedAt: now })
      .where(eq(authUser.id, input.userId))
  }

  const accounts = await db
    .select({ id: authAccount.id, providerId: authAccount.providerId })
    .from(authAccount)
    .where(eq(authAccount.userId, input.userId))
  const existingAccount = accounts.find((account) => account.providerId === 'credential') ?? accounts[0]

  if (existingAccount) {
    await db
      .update(authAccount)
      .set({
        accountId: input.userId,
        providerId: 'credential',
        issuer: 'local:credential',
        password: input.passwordHash,
        updatedAt: now,
      })
      .where(eq(authAccount.id, existingAccount.id))
    return
  }

  await db.insert(authAccount).values({
    id: crypto.randomUUID(),
    userId: input.userId,
    accountId: input.userId,
    providerId: 'credential',
    issuer: 'local:credential',
    password: input.passwordHash,
    createdAt: now,
    updatedAt: now,
  })
}

export async function revokeAuthSessions(userId: string) {
  await getDb().delete(authSession).where(eq(authSession.userId, userId))
}

export async function deleteAuthIdentity(userId: string) {
  const db = getDb()
  await db.delete(authSession).where(eq(authSession.userId, userId))
  await db.delete(authAccount).where(eq(authAccount.userId, userId))
  await db.delete(authUser).where(eq(authUser.id, userId))
}

export async function provisionAuthIdentityForWorkhubUser(userId: string) {
  const row = await getDb().query.users.findFirst({
    where: eq(users.id, userId),
  })
  if (!row?.passwordHash) return
  await provisionAuthIdentity({
    userId: row.id,
    email: row.email,
    name: fullName(row),
    passwordHash: row.passwordHash,
  })
}
