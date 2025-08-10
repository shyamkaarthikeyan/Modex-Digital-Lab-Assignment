import { query } from '../src/db.js';

async function cleanup() {
  try {
    const result = await query(`
      DELETE FROM shows 
      WHERE name IN ('Bus Concurrency', 'Expiry Test') 
         OR name LIKE '[TEST]%'
    `);
    console.log('Cleaned up', result.rowCount, 'test shows');
  } catch (error) {
    console.error('Cleanup failed:', error.message);
  }
  process.exit(0);
}

cleanup();
