// prisma/seed.js
// ─────────────────────────────────────────────────────────
// Seeds the SQLite database with realistic sample data.
// Run: npm run db:seed
//
// Creates:
//   - 2 admin users + 2 driver users
//   - 3 vehicles
//   - 10 detection records with varied severities
// ─────────────────────────────────────────────────────────

const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding database...');

  // ─── Clear existing data ───────────────────────────────
  await prisma.detection.deleteMany();
  await prisma.vehicle.deleteMany();
  await prisma.user.deleteMany();

  // ─── Users ────────────────────────────────────────────
  const passwordHash = await bcrypt.hash('password123', 12);

  const admin = await prisma.user.create({
    data: {
      name: 'Admin User',
      email: 'admin@sih26124.com',
      password: passwordHash,
      role: 'ADMIN',
    },
  });

  const analyst = await prisma.user.create({
    data: {
      name: 'Road Analyst',
      email: 'analyst@sih26124.com',
      password: passwordHash,
      role: 'ANALYST',
    },
  });

  const driver1 = await prisma.user.create({
    data: {
      name: 'Rajan Kumar',
      email: 'driver1@sih26124.com',
      password: passwordHash,
      role: 'DRIVER',
    },
  });

  const driver2 = await prisma.user.create({
    data: {
      name: 'Priya Nair',
      email: 'driver2@sih26124.com',
      password: passwordHash,
      role: 'DRIVER',
    },
  });

  console.log('✓ Users created');

  // ─── Vehicles ─────────────────────────────────────────
  const bus1 = await prisma.vehicle.create({
    data: { busNumber: 'KL-09-AB-1234', routeNumber: 'Route-10', driverId: driver1.id },
  });

  const bus2 = await prisma.vehicle.create({
    data: { busNumber: 'KL-09-CD-5678', routeNumber: 'Route-22', driverId: driver2.id },
  });

  const bus3 = await prisma.vehicle.create({
    data: { busNumber: 'KL-09-EF-9012', routeNumber: 'Route-5', driverId: null },
  });

  console.log('✓ Vehicles created');

  // ─── Detections ───────────────────────────────────────
  // Sample GPS coordinates around Coimbatore, Tamil Nadu
  const sampleDetections = [
    { lat: 11.0168, lng: 76.9558, count: 2, conf: 0.91, bus: bus1, user: driver1 },
    { lat: 11.0200, lng: 76.9600, count: 1, conf: 0.76, bus: bus1, user: driver1 },
    { lat: 11.0140, lng: 76.9520, count: 3, conf: 0.88, bus: bus2, user: driver2 },
    { lat: 11.0250, lng: 76.9650, count: 0, conf: 0.22, bus: bus2, user: driver2 },
    { lat: 11.0300, lng: 76.9700, count: 1, conf: 0.65, bus: bus3, user: driver1 },
    { lat: 11.0180, lng: 76.9580, count: 2, conf: 0.87, bus: bus1, user: driver2 },
    { lat: 11.0120, lng: 76.9490, count: 4, conf: 0.95, bus: bus2, user: driver1 },
    { lat: 11.0350, lng: 76.9750, count: 1, conf: 0.72, bus: bus3, user: driver2 },
    { lat: 11.0090, lng: 76.9450, count: 0, conf: 0.35, bus: bus1, user: driver1 },
    { lat: 11.0400, lng: 76.9800, count: 2, conf: 0.83, bus: bus2, user: driver2 },
  ];

  const severityMap = (conf) => {
    if (conf >= 0.85) return 'CRITICAL';
    if (conf >= 0.70) return 'HIGH';
    if (conf >= 0.50) return 'MEDIUM';
    return 'LOW';
  };

  for (const d of sampleDetections) {
    const detected = d.count > 0;
    await prisma.detection.create({
      data: {
        imagePath: '/uploads/sample_placeholder.jpg',
        latitude: d.lat,
        longitude: d.lng,
        timestamp: new Date(Date.now() - Math.random() * 7 * 24 * 60 * 60 * 1000),
        potholeDetected: detected,
        potholeCount: d.count,
        confidence: d.conf,
        severity: severityMap(d.conf),
        status: detected ? 'PENDING' : 'REVIEWED',
        vehicleId: d.bus.id,
        userId: d.user.id,
        rawAiResponse: JSON.stringify({ source: 'seed', potholeCount: d.count, confidence: d.conf }),
      },
    });
  }

  console.log('✓ Detections created');
  console.log('\n✅ Database seeded successfully!');
  console.log('\nLogin credentials (all use password: password123):');
  console.log('  Admin:    admin@sih26124.com');
  console.log('  Analyst:  analyst@sih26124.com');
  console.log('  Driver 1: driver1@sih26124.com');
  console.log('  Driver 2: driver2@sih26124.com');
}

main()
  .catch((e) => {
    console.error('Seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
