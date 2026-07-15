import pool from './connection';
import bcrypt from 'bcrypt';

async function seed() {
  const client = await pool.connect();

  try {
    console.log('Seeding database...');

    // Create admin user
    const hashedPassword = await bcrypt.hash(process.env.ADMIN_PASSWORD || 'changeme', 10);

    await client.query(`
      INSERT INTO users (email, name, role, hashed_password)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (email) DO NOTHING
    `, [
      process.env.ADMIN_EMAIL || 'admin@example.edu',
      'Site Admin',
      'super_admin',
      hashedPassword
    ]);

    console.log('✓ Admin user created');

    // Skip service seeding if services already exist, to keep seeding idempotent
    // and avoid inserting duplicate services on re-runs.
    const existingServices = await client.query('SELECT COUNT(*)::int AS count FROM services');
    if (existingServices.rows[0].count > 0) {
      console.log('✓ Services already seeded, skipping service seeding');
      console.log('\n===========================================');
      console.log('Database setup complete!');
      console.log('===========================================');
      return;
    }

    // Get category IDs for service assignment
    const catRows = await client.query('SELECT id, slug FROM categories');
    const categoryMap: { [slug: string]: string } = {};
    for (const row of catRows.rows) {
      categoryMap[row.slug] = row.id;
    }

    // Insert services
    const services = [
      // Communication & Collaboration
      {
        name: 'Microsoft 365',
        description: 'Email, Office apps, OneDrive, and Teams',
        category: 'communication',
        provider: 'microsoft',
        status_api_endpoint: 'https://graph.microsoft.com/v1.0/admin/serviceAnnouncement/healthOverviews',
        status_api_type: 'microsoft_graph',
        external_link: 'https://status.office.com',
        display_order: 1
      },
      {
        name: 'Google Workspace',
        description: 'Gmail, Drive, Calendar, and other Google services',
        category: 'communication',
        provider: 'google',
        status_api_endpoint: 'https://www.google.com/appsstatus/dashboard/',
        status_api_type: 'google_status',
        external_link: 'https://www.google.com/appsstatus/dashboard/',
        display_order: 2
      },
      {
        name: 'Zoom',
        description: 'Video conferencing and webinars',
        category: 'communication',
        provider: 'zoom',
        status_api_endpoint: 'https://status.zoom.us/api/v2/status.json',
        status_api_type: 'statuspage',
        external_link: 'https://status.zoom.us',
        display_order: 3
      },
      // Learning & Academic Services
      {
        name: 'Canvas LMS',
        description: 'Learning Management System',
        category: 'learning',
        provider: 'instructure',
        status_api_endpoint: 'https://status.instructure.com/api/v2/status.json',
        status_api_type: 'statuspage',
        external_link: 'https://status.instructure.com',
        display_order: 4
      },
      {
        name: 'Student Information System',
        description: 'Student registration and records',
        category: 'learning',
        provider: 'custom',
        status_api_endpoint: null,
        status_api_type: 'manual',
        external_link: 'https://sis.example.edu/health',
        check_enabled: false,
        display_order: 5
      },
      {
        name: 'Qualtrics',
        description: 'Survey and research platform',
        category: 'learning',
        provider: 'qualtrics',
        status_api_endpoint: 'https://status.qualtrics.com/api/v2/status.json',
        status_api_type: 'statuspage',
        external_link: 'https://status.qualtrics.com',
        display_order: 6
      },
      // Infrastructure Services
      {
        name: 'Internet Connectivity',
        description: 'Campus internet and border network',
        category: 'infrastructure',
        provider: 'custom',
        status_api_endpoint: 'group:Network-Border',
        status_api_type: 'librenms',
        external_link: null,
        display_order: 7
      },
      {
        name: 'Core Network',
        description: 'Campus core network infrastructure',
        category: 'infrastructure',
        provider: 'custom',
        status_api_endpoint: 'group:Network-Core',
        status_api_type: 'librenms',
        external_link: null,
        display_order: 8
      },
      {
        name: 'Building Networks',
        description: 'Wired network connections in campus buildings',
        category: 'infrastructure',
        provider: 'custom',
        status_api_endpoint: 'group:Network-Buildings',
        status_api_type: 'librenms',
        external_link: null,
        display_order: 9
      },
      {
        name: 'DNS',
        description: 'Domain name resolution services',
        category: 'infrastructure',
        provider: 'custom',
        status_api_endpoint: 'group:dns',
        status_api_type: 'librenms',
        external_link: null,
        display_order: 10
      },
      {
        name: 'Wi-Fi Campus Network',
        description: 'Campus wireless connectivity',
        category: 'infrastructure',
        provider: 'custom',
        status_api_endpoint: null,
        status_api_type: 'manual',
        external_link: null,
        check_enabled: false,
        display_order: 11
      },
      {
        name: 'VPN Access',
        description: 'Remote network access',
        category: 'infrastructure',
        provider: 'custom',
        status_api_endpoint: null,
        status_api_type: 'manual',
        external_link: null,
        check_enabled: false,
        display_order: 12
      }
    ];

    for (const service of services) {
      const result = await client.query(`
        INSERT INTO services (
          name, description, category, category_id, provider,
          status_api_endpoint, status_api_type,
          external_link, check_enabled, display_order
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        RETURNING id
      `, [
        service.name,
        service.description,
        service.category,
        categoryMap[service.category] || null,
        service.provider,
        service.status_api_endpoint,
        service.status_api_type,
        service.external_link,
        service.check_enabled ?? true,
        service.display_order
      ]);

      const serviceId = result.rows[0].id;

      // Initialize service status as operational
      await client.query(`
        INSERT INTO service_status (
          service_id, status, status_source, status_message
        )
        VALUES ($1, $2, $3, $4)
      `, [
        serviceId,
        'operational',
        service.check_enabled === false ? 'manual_override' : 'automated',
        'All systems operational.'
      ]);

      // Create initial history record
      await client.query(`
        INSERT INTO status_history (
          service_id, status, status_source, status_message, started_at
        )
        VALUES ($1, $2, $3, $4, NOW())
      `, [
        serviceId,
        'operational',
        service.check_enabled === false ? 'manual_override' : 'automated',
        'All systems operational.'
      ]);

      console.log(`  ✓ ${service.name}`);
    }

    console.log('✓ Services seeded successfully');
    console.log('\n===========================================');
    console.log('Database setup complete!');
    console.log('===========================================');
    console.log(`Admin Email: ${process.env.ADMIN_EMAIL || 'admin@example.edu'}`);
    console.log(`Admin Password: ${process.env.ADMIN_PASSWORD || 'changeme'}`);
    console.log('===========================================\n');

  } catch (error) {
    console.error('Seeding failed:', error);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

seed().catch(error => {
  console.error('Error:', error);
  process.exit(1);
});
