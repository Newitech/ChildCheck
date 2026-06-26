import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient
  prismaV2?: PrismaClient
  prismaV3?: PrismaClient
  prismaV4?: PrismaClient
  prismaV5?: PrismaClient
  prismaV6?: PrismaClient
}

// Use a fresh cache key to break out of any stale global instance cached by
// the dev server before the latest `bun run db:generate` / `db:push`. Bump
// the key (v2 → v3 → …) whenever a schema migration adds new models so the
// old client instance (which doesn't know about them) is replaced.
//
// EM (Task EM — SMTP/email): bumped v5 → v6 after adding the SmtpConfig model
// so the dev server picks up the regenerated Prisma Client (with smtpConfig).
export const db =
  globalForPrisma.prismaV6 ??
  new PrismaClient({
    log: ['query'],
  })

if (process.env.NODE_ENV !== 'production') globalForPrisma.prismaV6 = db
