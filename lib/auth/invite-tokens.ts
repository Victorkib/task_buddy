import { createHash, randomBytes } from 'crypto'
import { and, eq, gt, isNull } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { userInvites, userInvitePurposeEnum } from '@/lib/db/schema'

export const INVITE_SETUP_DAYS = 7
export const PASSWORD_RESET_HOURS = 24

type InvitePurpose = (typeof userInvitePurposeEnum.enumValues)[number]

export function hashInviteToken(rawToken: string) {
  return createHash('sha256').update(rawToken).digest('hex')
}

export function generateInviteToken() {
  return randomBytes(32).toString('base64url')
}

/** Pronounceable enough to type, strong enough for a one-time starter. */
export function generateTemporaryPassword() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@$%'
  const bytes = randomBytes(14)
  let password = ''
  for (const byte of bytes) {
    password += alphabet[byte % alphabet.length]
  }
  return password
}

export async function invalidateOpenInvites(userId: string, purpose?: InvitePurpose) {
  const db = getDb()
  const conditions = [eq(userInvites.userId, userId), isNull(userInvites.consumedAt)]
  if (purpose) conditions.push(eq(userInvites.purpose, purpose))
  await db
    .update(userInvites)
    .set({ consumedAt: new Date() })
    .where(and(...conditions))
}

export async function createUserInvite(input: {
  userId: string
  invitedById: string | null
  purpose: InvitePurpose
  expiresAt: Date
}) {
  const rawToken = generateInviteToken()
  const tokenHash = hashInviteToken(rawToken)
  const now = new Date()

  await invalidateOpenInvites(input.userId, input.purpose)

  const [row] = await getDb()
    .insert(userInvites)
    .values({
      userId: input.userId,
      invitedById: input.invitedById,
      purpose: input.purpose,
      tokenHash,
      expiresAt: input.expiresAt,
      lastSentAt: now,
    })
    .returning()

  return { invite: row, rawToken }
}

export async function findOpenInviteByToken(rawToken: string, purpose?: InvitePurpose) {
  const tokenHash = hashInviteToken(rawToken)
  const now = new Date()
  const conditions = [
    eq(userInvites.tokenHash, tokenHash),
    isNull(userInvites.consumedAt),
    gt(userInvites.expiresAt, now),
  ]
  if (purpose) conditions.push(eq(userInvites.purpose, purpose))

  return getDb().query.userInvites.findFirst({
    where: and(...conditions),
    with: {
      user: {
        with: {
          department: true,
          roles: { with: { role: true } },
        },
      },
    },
  })
}

export async function markInviteConsumed(inviteId: string) {
  await getDb()
    .update(userInvites)
    .set({ consumedAt: new Date() })
    .where(eq(userInvites.id, inviteId))
}

export async function touchInviteSent(inviteId: string) {
  await getDb()
    .update(userInvites)
    .set({ lastSentAt: new Date() })
    .where(eq(userInvites.id, inviteId))
}

export async function getLatestOpenSetupInvite(userId: string) {
  const now = new Date()
  return getDb().query.userInvites.findFirst({
    where: and(
      eq(userInvites.userId, userId),
      eq(userInvites.purpose, 'setup'),
      isNull(userInvites.consumedAt),
      gt(userInvites.expiresAt, now),
    ),
    orderBy: (table, { desc }) => [desc(table.createdAt)],
  })
}
