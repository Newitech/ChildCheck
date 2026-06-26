/**
 * ChildCheck — Demo data seeder.
 *
 * Usage:  bun run scripts/seed-demo.ts
 *
 * Seeds a rich set of test data into the dev/preview environment so the app
 * is immediately explorable after setup. IDEMPOTENT: safe to re-run (checks
 * for existing data by email/name before creating).
 *
 * This script is for DEVELOPMENT ONLY. Production deployments should NEVER
 * run it — it creates fake people/families with known credentials.
 *
 * The .dockerignore excludes db/, so this script + its data never ship in
 * the Docker image. The .tar download from chat.z.ai may include the dev DB
 * — operators must `rm -rf db data config` before deploying (documented in
 * docs/deployment/ + the Docker walkthrough).
 */
import { db } from "../src/lib/db";
import { hashPassword, hashPin } from "../src/lib/password";

async function seedDemo() {
  console.log("[seed-demo] Starting demo data seeding...");

  // -----------------------------------------------------------------------
  // 0. Guard: only seed if an org + admin already exist (post-setup).
  // -----------------------------------------------------------------------
  const org = await db.organisation.findFirst();
  if (!org) {
    console.error("[seed-demo] No organisation found. Run /setup first.");
    process.exit(1);
  }
  const adminUser = await db.user.findFirst({ where: { username: "admin" } });
  if (!adminUser) {
    console.error("[seed-demo] No admin user found. Run /setup first.");
    process.exit(1);
  }
  console.log(`[seed-demo] Org: ${org.appName}, Admin: ${adminUser.username}`);

  let created = 0;
  let skipped = 0;

  // Helper: find-or-create a Person.
  async function person(data: {
    firstName: string;
    lastName: string;
    middleName?: string;
    email?: string;
    phone?: string;
    personType: string;
    dateOfBirth?: Date;
    schoolGrade?: string;
    gender?: string;
    allergies?: string;
    medicalNotes?: string;
    dietaryNotes?: string;
    isVisitor?: boolean;
  }) {
    // Match by firstName + lastName + email (if present).
    const existing = await db.person.findFirst({
      where: {
        AND: [
          { firstName: data.firstName },
          { lastName: data.lastName },
          ...(data.email ? [{ email: data.email }] : []),
        ],
      },
    });
    if (existing) {
      skipped++;
      return existing;
    }
    const p = await db.person.create({ data: { ...data, isActive: true } });
    created++;
    return p;
  }

  // Helper: find-or-create a Family.
  async function family(familyName: string, notes?: string) {
    const existing = await db.family.findFirst({ where: { familyName } });
    if (existing) {
      skipped++;
      return existing;
    }
    const f = await db.family.create({
      data: { familyName, notes, isActive: true },
    });
    created++;
    return f;
  }

  // Helper: add a person to a family with a role (idempotent).
  async function member(familyId: string, personId: string, role: string) {
    const existing = await db.familyMember.findUnique({
      where: { familyId_personId: { familyId, personId } },
    });
    if (existing) {
      skipped++;
      return;
    }
    await db.familyMember.create({ data: { familyId, personId, role } });
    created++;
  }

  // -----------------------------------------------------------------------
  // 1. Rooms
  // -----------------------------------------------------------------------
  console.log("[seed-demo] Seeding rooms...");
  const room1 = await db.room.upsert({
    where: { id: "demo-room-1" },
    create: { id: "demo-room-1", name: "Room 1", code: "R1", building: "Main", capacity: 20 },
    update: {},
  });
  const room2 = await db.room.upsert({
    where: { id: "demo-room-2" },
    create: { id: "demo-room-2", name: "Room 2", code: "R2", building: "Main", capacity: 15 },
    update: {},
  });
  const hall = await db.room.upsert({
    where: { id: "demo-room-hall" },
    create: { id: "demo-room-hall", name: "Hall", code: "HAL", building: "Main", capacity: 100 },
    update: {},
  });
  console.log("[seed-demo] Rooms: 3");

  // -----------------------------------------------------------------------
  // 2. Smith family (the main test family)
  // -----------------------------------------------------------------------
  console.log("[seed-demo] Seeding Smith family...");
  const john = await person({
    firstName: "John",
    lastName: "Smith",
    email: "john.smith@example.com",
    phone: "0412345678",
    personType: "Adult",
    gender: "Male",
  });
  const mary = await person({
    firstName: "Mary",
    lastName: "Smith",
    dateOfBirth: new Date("2018-05-10"),
    schoolGrade: "Grade 3",
    personType: "Child",
    gender: "Female",
    allergies: "Peanuts",
    medicalNotes: "Asthma — carries an inhaler",
    dietaryNotes: "Vegetarian",
  });
  const tom = await person({
    firstName: "Tom",
    lastName: "Smith",
    dateOfBirth: new Date("2010-01-01"),
    schoolGrade: "Grade 8",
    personType: "Child",
    gender: "Male",
  });
  const smithFamily = await family("Smith", "The main test family");
  await member(smithFamily.id, john.id, "PrimaryCarer");
  await member(smithFamily.id, mary.id, "Child");
  await member(smithFamily.id, tom.id, "Child");

  // -----------------------------------------------------------------------
  // 3. Robert Grandparent (Authorised Guardian for Smith family)
  // -----------------------------------------------------------------------
  console.log("[seed-demo] Seeding Robert Grandparent (guardian)...");
  const robert = await person({
    firstName: "Robert",
    lastName: "Grandparent",
    middleName: "Bobby",
    email: "robert.grand@example.com",
    phone: "0498765432",
    personType: "Adult",
    gender: "Male",
    dateOfBirth: new Date("1955-03-20"),
  });
  await member(smithFamily.id, robert.id, "AuthorisedGuardian");

  // Give Robert his own family too (he's a primary carer in his own household)
  const grandparentFamily = await family("Grandparent");
  await member(grandparentFamily.id, robert.id, "PrimaryCarer");

  // -----------------------------------------------------------------------
  // 4. Doe family (from Elvanto import testing)
  // -----------------------------------------------------------------------
  console.log("[seed-demo] Seeding Doe family...");
  const johnDoe = await person({
    firstName: "John",
    lastName: "Doe",
    email: "john.doe@example.com",
    phone: "0412345678",
    personType: "Adult",
    gender: "Male",
  });
  const janeDoe = await person({
    firstName: "Jane",
    lastName: "Doe",
    email: "jane.doe@example.com",
    phone: "0498765432",
    personType: "Adult",
    gender: "Female",
  });
  const jimmyDoe = await person({
    firstName: "Jimmy",
    lastName: "Doe",
    dateOfBirth: new Date("2015-11-30"),
    schoolGrade: "Grade 3",
    personType: "Child",
    gender: "Male",
    allergies: "Milk",
    medicalNotes: "Asthma",
  });
  const doeFamily = await family("Doe", "Imported via Elvanto connector");
  await member(doeFamily.id, johnDoe.id, "PrimaryCarer");
  await member(doeFamily.id, janeDoe.id, "PrimaryCarer");
  await member(doeFamily.id, jimmyDoe.id, "Child");

  // -----------------------------------------------------------------------
  // 5. Blacklist entries for Smith family
  // -----------------------------------------------------------------------
  console.log("[seed-demo] Seeding blacklist entries...");
  const creepPerson = await person({
    firstName: "Creep",
    lastName: "Person",
    personType: "Adult",
  });
  // Family-level block (free-text unknown male)
  const existingBlock1 = await db.blacklistEntry.findFirst({
    where: { familyId: smithFamily.id, collectorName: "Unknown male ~40s" },
  });
  if (!existingBlock1) {
    await db.blacklistEntry.create({
      data: {
        familyId: smithFamily.id,
        collectorName: "Unknown male ~40s",
        collectorDescription: "Restraining order #2024-0456 in effect",
        reason: "Restraining order",
        severity: "blocked",
      },
    });
    created++;
  } else { skipped++; }

  // Child-level block (known person — Creep Person blocked from collecting Mary)
  const existingBlock2 = await db.blacklistEntry.findFirst({
    where: { childId: mary.id, personId: creepPerson.id },
  });
  if (!existingBlock2) {
    await db.blacklistEntry.create({
      data: {
        childId: mary.id,
        familyId: smithFamily.id,
        personId: creepPerson.id,
        reason: "Non-custodial parent — no collection rights",
        severity: "blocked",
      },
    });
    created++;
  } else { skipped++; }

  // -----------------------------------------------------------------------
  // 6. Assign rooms to classes
  // -----------------------------------------------------------------------
  console.log("[seed-demo] Assigning rooms to classes...");
  const sabbathSchool = await db.program.findUnique({ where: { slug: "sabbath_school" } });
  if (sabbathSchool) {
    const beginner = await db.groupClass.findFirst({
      where: { programId: sabbathSchool.id, slug: "beginner" },
    });
    if (beginner && !beginner.roomId) {
      await db.groupClass.update({ where: { id: beginner.id }, data: { roomId: room1.id } });
    }
    const primary = await db.groupClass.findFirst({
      where: { programId: sabbathSchool.id, slug: "primary" },
    });
    if (primary && !primary.roomId) {
      await db.groupClass.update({ where: { id: primary.id }, data: { roomId: room2.id } });
    }
  }

  // -----------------------------------------------------------------------
  // 7. A test event
  // -----------------------------------------------------------------------
  console.log("[seed-demo] Seeding a test event...");
  const existingEvent = await db.event.findFirst({ where: { name: "Community Fun Day" } });
  if (!existingEvent) {
    await db.event.create({
      data: {
        name: "Community Fun Day",
        description: "Annual community outreach event with games, food, and a short program.",
        date: new Date(),
        location: "Hall",
        isActive: true,
        rooms: { create: [{ roomId: hall.id }] },
      },
    });
    created++;
  } else { skipped++; }

  // -----------------------------------------------------------------------
  // 8. Create a Teacher user (for testing the volunteer dashboard)
  // -----------------------------------------------------------------------
  console.log("[seed-demo] Seeding a Teacher user...");
  const teacherPerson = await person({
    firstName: "Sarah",
    lastName: "Teacher",
    email: "sarah.teacher@example.com",
    personType: "Adult",
    gender: "Female",
  });
  const existingTeacherUser = await db.user.findFirst({ where: { username: "teacher" } });
  if (!existingTeacherUser) {
    const teacherUser = await db.user.create({
      data: {
        personId: teacherPerson.id,
        username: "teacher",
        passwordHash: await hashPassword("password123"),
        pinHash: await hashPin("1234"),
        status: "Active",
        roles: { create: [{ role: "Teacher" }] },
      },
    });
    await db.auditLog.create({
      data: {
        actorUserId: adminUser.id,
        action: "user.create",
        entity: "User",
        entityId: teacherUser.id,
        details: JSON.stringify({ username: "teacher", roles: ["Teacher"], seeded: true }),
      },
    });
    created++;
    console.log("[seed-demo] Teacher user created: username=teacher password=password123 PIN=1234");
  } else {
    skipped++;
    console.log("[seed-demo] Teacher user already exists: username=teacher");
  }

  // -----------------------------------------------------------------------
  // 9. Create a Volunteer user
  // -----------------------------------------------------------------------
  console.log("[seed-demo] Seeding a Volunteer user...");
  const volunteerPerson = await person({
    firstName: "Mike",
    lastName: "Volunteer",
    email: "mike.volunteer@example.com",
    personType: "Adult",
    gender: "Male",
  });
  const existingVolUser = await db.user.findFirst({ where: { username: "volunteer" } });
  if (!existingVolUser) {
    const volUser = await db.user.create({
      data: {
        personId: volunteerPerson.id,
        username: "volunteer",
        passwordHash: await hashPassword("password123"),
        status: "Active",
        roles: { create: [{ role: "Volunteer" }] },
      },
    });
    await db.auditLog.create({
      data: {
        actorUserId: adminUser.id,
        action: "user.create",
        entity: "User",
        entityId: volUser.id,
        details: JSON.stringify({ username: "volunteer", roles: ["Volunteer"], seeded: true }),
      },
    });
    created++;
    console.log("[seed-demo] Volunteer user created: username=volunteer password=password123");
  } else {
    skipped++;
  }

  // -----------------------------------------------------------------------
  // 10. WWCC card for the teacher
  // -----------------------------------------------------------------------
  console.log("[seed-demo] Seeding WWCC card...");
  const flagOn = await db.featureFlag.findUnique({ where: { key: "working_with_children_tracking" } });
  if (flagOn?.value) {
    const existingWwcc = await db.workingWithChildrenCard.findFirst({
      where: { personId: teacherPerson.id },
    });
    if (!existingWwcc) {
      await db.workingWithChildrenCard.create({
        data: {
          personId: teacherPerson.id,
          cardType: "QLD Blue Card",
          jurisdiction: "AU-QLD",
          cardNumber: "BC1234567",
          status: "Verified",
          issuedAt: new Date("2024-01-15"),
          expiresAt: new Date("2027-01-15"),
          verifiedAt: new Date("2024-01-15"),
        },
      });
      created++;
    } else { skipped++; }
  }

  // -----------------------------------------------------------------------
  // 11. A test printer
  // -----------------------------------------------------------------------
  console.log("[seed-demo] Seeding a test printer...");
  const existingPrinter = await db.printer.findFirst({ where: { name: "Room 1 Label Printer" } });
  if (!existingPrinter) {
    await db.printer.create({
      data: {
        name: "Room 1 Label Printer",
        driver: "browser",
        purpose: "both",
        isDefault: true,
        isActive: true,
      },
    });
    created++;
  } else { skipped++; }

  // -----------------------------------------------------------------------
  // Summary
  // -----------------------------------------------------------------------
  console.log("");
  console.log("============================================================");
  console.log(" Demo data seeding complete.");
  console.log("============================================================");
  console.log(`  Created: ${created}   Skipped (already existed): ${skipped}`);
  console.log("");
  console.log(" Test accounts (all passwords: password123):");
  console.log("   admin      — Admin (full access)");
  console.log("   teacher    — Teacher (roster, check-in/out, headcount, reports)");
  console.log("   volunteer  — Volunteer (roster, check-in/out, headcount)");
  console.log("");
  console.log(" Test families:");
  console.log("   Smith  — John (carer), Mary (child, allergies), Tom (child), Robert (guardian)");
  console.log("   Doe    — John + Jane (carers), Jimmy (child, allergies)");
  console.log("");
  console.log(" Blacklist: 'Unknown male ~40s' (family block), 'Creep Person' (Mary block)");
  console.log(" Programs: 4 SDA defaults (Sabbath School, Pathfinders, Adventurers, Community Childcare)");
  console.log(" Rooms: Room 1, Room 2, Hall");
  console.log(" Event: Community Fun Day (today)");
  console.log("");
  console.log(" NOTE: This is DEMO data for the dev/preview environment only.");
  console.log("       Production deployments must `rm -rf db data config` before first run.");
  console.log("============================================================");
}

seedDemo()
  .catch((err) => {
    console.error("[seed-demo] ERROR:", err);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
