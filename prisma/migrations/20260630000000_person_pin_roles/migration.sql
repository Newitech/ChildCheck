-- Atomic migration: move PIN from User.pinHash to Person.pinHash, and roles
-- from UserRole to a new PersonRole table. All data copy steps run BEFORE the
-- corresponding drops so existing data is preserved.

-- 1. Add Person.pinHash column.
ALTER TABLE "Person" ADD COLUMN "pinHash" TEXT;

-- 2. Create the PersonRole table (FK to Person, @@unique([personId, role]), @@index([role])).
CREATE TABLE "PersonRole" (
    "id" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "scope" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PersonRole_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "PersonRole_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person" ("id") ON DELETE CASCADE
);

CREATE UNIQUE INDEX "PersonRole_personId_role_key" ON "PersonRole"("personId", "role");
CREATE INDEX "PersonRole_role_idx" ON "PersonRole"("role");

-- 3. Copy roles: UserRole -> PersonRole (joining User.personId).
INSERT OR IGNORE INTO "PersonRole" ("id", "personId", "role", "scope", "createdAt")
SELECT LOWER(HEX(RANDOMBLOB(12))), "U"."personId", "UR"."role", "UR"."scope", COALESCE("UR"."createdAt", CURRENT_TIMESTAMP)
FROM "UserRole" "UR"
JOIN "User" "U" ON "U"."id" = "UR"."userId";

-- 4. Copy PINs: User.pinHash -> Person.pinHash.
UPDATE "Person"
SET "pinHash" = (
    SELECT "U"."pinHash" FROM "User" "U" WHERE "U"."personId" = "Person"."id" AND "U"."pinHash" IS NOT NULL
)
WHERE EXISTS (
    SELECT 1 FROM "User" "U" WHERE "U"."personId" = "Person"."id" AND "U"."pinHash" IS NOT NULL
);

-- 5. Drop the now-redundant User.pinHash column.
ALTER TABLE "User" DROP COLUMN "pinHash";

-- 6. Drop the UserRole table (data now lives in PersonRole).
DROP TABLE "UserRole";
