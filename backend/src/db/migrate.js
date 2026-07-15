const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../../.env') });

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

async function runMigrations() {
  const client = await pool.connect();

  try {
    console.log('Running database migrations...');

    // Create migrations tracking table
    await client.query(`
      CREATE TABLE IF NOT EXISTS _migrations (
        id SERIAL PRIMARY KEY,
        filename VARCHAR(255) UNIQUE NOT NULL,
        applied_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // Get already-applied migrations
    const applied = await client.query('SELECT filename FROM _migrations ORDER BY filename');
    const appliedSet = new Set(applied.rows.map(r => r.filename));

    // Find all migration files
    const migrationsDir = path.join(__dirname, '../../..', 'database/migrations');
    const files = fs.readdirSync(migrationsDir)
      .filter(f => f.endsWith('.sql'))
      .sort();

    let ranCount = 0;

    for (const file of files) {
      if (appliedSet.has(file)) {
        console.log(`  - ${file} (already applied)`);
        continue;
      }

      console.log(`  + ${file} (applying...)`);
      const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');

      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO _migrations (filename) VALUES ($1)', [file]);
        await client.query('COMMIT');
        console.log(`    applied`);
        ranCount++;
      } catch (error) {
        await client.query('ROLLBACK');
        console.error(`    FAILED: ${error.message}`);
        throw error;
      }
    }

    if (ranCount === 0) {
      console.log('All migrations already applied.');
    } else {
      console.log(`\n${ranCount} migration(s) applied successfully.`);
    }
  } catch (error) {
    console.error('Migration failed:', error);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

runMigrations().catch(error => {
  console.error('Error:', error);
  process.exit(1);
});
