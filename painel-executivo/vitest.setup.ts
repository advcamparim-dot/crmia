import dotenv from 'dotenv';
import path from 'path';

// Load .env.local file for tests
const envPath = path.resolve(__dirname, '.env.local');
dotenv.config({ path: envPath });

// Set a default SESSION_SECRET if not already set
if (!process.env.SESSION_SECRET) {
  process.env.SESSION_SECRET = 'test-secret-value';
}
