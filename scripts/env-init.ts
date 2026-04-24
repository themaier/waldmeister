// Copies .env.example → .env on first run. Safe to run repeatedly —
// existing .env files are left untouched.

import { existsSync, copyFileSync } from 'node:fs';

if (existsSync('.env')) {
  console.log('.env already exists — leaving as-is.');
} else if (!existsSync('.env.example')) {
  console.error('.env.example not found — cannot initialise.');
  process.exit(1);
} else {
  copyFileSync('.env.example', '.env');
  console.log('✓ Copied .env.example → .env');
}
