/**
 * Database Seed Script
 * 
 * This script populates the database with initial data:
 * - An admin user (for system management)
 * - A supervisor user (for case management)
 * - Sample investigator users
 * - Sample cases and evidence (optional in production)
 * 
 * Run with: npm run prisma:seed
 * 
 * IMPORTANT: In production, only seed the admin user and run once!
 */

require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');
const bcrypt = require('bcryptjs');

// Create the PostgreSQL adapter
const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });

const prisma = new PrismaClient({ adapter });

// Configuration
const BCRYPT_SALT_ROUNDS = 12;

/**
 * Generate a case number
 * Format: EVD-YYYY-XXXXX (e.g., EVD-2024-00001)
 */
function generateCaseNumber(index) {
  const year = new Date().getFullYear();
  const number = String(index).padStart(5, '0');
  return `EVD-${year}-${number}`;
}

/**
 * Hash a password using bcrypt
 */
async function hashPassword(password) {
  return bcrypt.hash(password, BCRYPT_SALT_ROUNDS);
}

/**
 * Main seed function
 */
async function main() {
  console.log('🌱 Starting database seed...\n');

  // ==========================================================================
  // CREATE USERS
  // ==========================================================================
  console.log('👤 Creating users...');

  // Admin user - has full access
  const adminPassword = await hashPassword('Admin@123456');
  const admin = await prisma.user.upsert({
    where: { email: 'admin@evidence-vault.com' },
    update: {},
    create: {
      email: 'admin@evidence-vault.com',
      name: 'System Administrator',
      passwordHash: adminPassword,
      role: 'ADMIN'
    }
  });
  console.log(`  ✅ Admin: ${admin.email}`);

  // Supervisor user - can manage cases and approve evidence
  const supervisorPassword = await hashPassword('Super@123456');
  const supervisor = await prisma.user.upsert({
    where: { email: 'supervisor@evidence-vault.com' },
    update: {},
    create: {
      email: 'supervisor@evidence-vault.com',
      name: 'John Supervisor',
      passwordHash: supervisorPassword,
      role: 'SUPERVISOR'
    }
  });
  console.log(`  ✅ Supervisor: ${supervisor.email}`);

  // Investigator users
  const investigatorPassword = await hashPassword('Invest@123456');
  
  const investigator1 = await prisma.user.upsert({
    where: { email: 'investigator1@evidence-vault.com' },
    update: {},
    create: {
      email: 'investigator1@evidence-vault.com',
      name: 'Jane Investigator',
      passwordHash: investigatorPassword,
      role: 'INVESTIGATOR'
    }
  });
  console.log(`  ✅ Investigator: ${investigator1.email}`);

  const investigator2 = await prisma.user.upsert({
    where: { email: 'investigator2@evidence-vault.com' },
    update: {},
    create: {
      email: 'investigator2@evidence-vault.com',
      name: 'Bob Detective',
      passwordHash: investigatorPassword,
      role: 'INVESTIGATOR'
    }
  });
  console.log(`  ✅ Investigator: ${investigator2.email}`);

  // ==========================================================================
  // CREATE SAMPLE CASES (Development only)
  // ==========================================================================
  console.log('\n📁 Creating sample cases...');

  const case1 = await prisma.case.upsert({
    where: { caseNumber: generateCaseNumber(1) },
    update: {},
    create: {
      caseNumber: generateCaseNumber(1),
      title: 'Financial Fraud Investigation',
      description: 'Investigation into suspected embezzlement at XYZ Corporation. Multiple wire transfers flagged for review.',
      status: 'OPEN',
      priority: 1,
      createdById: supervisor.id,
      assignedInvestigatorId: investigator1.id
    }
  });
  console.log(`  ✅ Case: ${case1.caseNumber} - ${case1.title}`);

  const case2 = await prisma.case.upsert({
    where: { caseNumber: generateCaseNumber(2) },
    update: {},
    create: {
      caseNumber: generateCaseNumber(2),
      title: 'Cyber Intrusion Analysis',
      description: 'Analysis of suspected network breach at municipal government systems.',
      status: 'OPEN',
      priority: 2,
      createdById: supervisor.id,
      assignedInvestigatorId: investigator2.id
    }
  });
  console.log(`  ✅ Case: ${case2.caseNumber} - ${case2.title}`);

  const case3 = await prisma.case.upsert({
    where: { caseNumber: generateCaseNumber(3) },
    update: {},
    create: {
      caseNumber: generateCaseNumber(3),
      title: 'Digital Evidence Recovery',
      description: 'Recovery and analysis of deleted files from seized devices.',
      status: 'PENDING',
      priority: 3,
      createdById: admin.id,
      assignedInvestigatorId: null // Not yet assigned
    }
  });
  console.log(`  ✅ Case: ${case3.caseNumber} - ${case3.title}`);

  const case4 = await prisma.case.upsert({
    where: { caseNumber: generateCaseNumber(4) },
    update: {},
    create: {
      caseNumber: generateCaseNumber(4),
      title: 'Identity Theft Ring',
      description: 'Investigation completed. All evidence processed and archived.',
      status: 'CLOSED',
      priority: 2,
      createdById: supervisor.id,
      assignedInvestigatorId: investigator1.id,
      closedAt: new Date()
    }
  });
  console.log(`  ✅ Case: ${case4.caseNumber} - ${case4.title} (CLOSED)`);

  // ==========================================================================
  // CREATE SAMPLE NOTIFICATIONS
  // ==========================================================================
  console.log('\n🔔 Creating sample notifications...');

  await prisma.notification.createMany({
    data: [
      {
        userId: investigator1.id,
        title: 'New Case Assigned',
        message: `You have been assigned to case ${case1.caseNumber}: ${case1.title}`,
        linkType: 'case',
        linkId: case1.id,
        isRead: false
      },
      {
        userId: investigator2.id,
        title: 'New Case Assigned',
        message: `You have been assigned to case ${case2.caseNumber}: ${case2.title}`,
        linkType: 'case',
        linkId: case2.id,
        isRead: false
      },
      {
        userId: supervisor.id,
        title: 'Case Closed',
        message: `Case ${case4.caseNumber} has been marked as closed.`,
        linkType: 'case',
        linkId: case4.id,
        isRead: true
      }
    ],
    skipDuplicates: true
  });
  console.log('  ✅ Sample notifications created');

  // ==========================================================================
  // CREATE SAMPLE AUDIT LOGS
  // ==========================================================================
  console.log('\n📋 Creating sample audit logs...');

  await prisma.auditLog.createMany({
    data: [
      {
        userId: admin.id,
        action: 'USER_CREATED',
        entity: 'USER',
        entityId: supervisor.id,
        ipAddress: '192.168.1.1',
        details: { email: supervisor.email, role: 'SUPERVISOR' }
      },
      {
        userId: admin.id,
        action: 'USER_CREATED',
        entity: 'USER',
        entityId: investigator1.id,
        ipAddress: '192.168.1.1',
        details: { email: investigator1.email, role: 'INVESTIGATOR' }
      },
      {
        userId: supervisor.id,
        action: 'CASE_CREATED',
        entity: 'CASE',
        entityId: case1.id,
        ipAddress: '192.168.1.2',
        details: { caseNumber: case1.caseNumber, title: case1.title }
      },
      {
        userId: supervisor.id,
        action: 'CASE_ASSIGNED',
        entity: 'CASE',
        entityId: case1.id,
        ipAddress: '192.168.1.2',
        details: { 
          caseNumber: case1.caseNumber, 
          assignedTo: investigator1.email 
        }
      }
    ]
  });
  console.log('  ✅ Sample audit logs created');

  // ==========================================================================
  // SUMMARY
  // ==========================================================================
  console.log('\n' + '='.repeat(60));
  console.log('🎉 Database seeding completed!');
  console.log('='.repeat(60));
  console.log('\n📧 Login Credentials:');
  console.log('─'.repeat(40));
  console.log('Admin:');
  console.log('  Email: admin@evidence-vault.com');
  console.log('  Password: Admin@123456');
  console.log('\nSupervisor:');
  console.log('  Email: supervisor@evidence-vault.com');
  console.log('  Password: Super@123456');
  console.log('\nInvestigators:');
  console.log('  Email: investigator1@evidence-vault.com');
  console.log('  Email: investigator2@evidence-vault.com');
  console.log('  Password: Invest@123456');
  console.log('\n⚠️  Change these passwords immediately in production!\n');
}

main()
  .catch((e) => {
    console.error('❌ Seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
