/**
 * Supabase Migration Runner
 * Run:
 *   node supabase/run-migration.cjs
 *   node supabase/run-migration.cjs 20260718000100_investment_research_audit.sql
 * 
 * Bu script migration SQL'ini Supabase'e gönderir.
 * Service Role Key gerektirir.
 */
const fs = require('fs');
const path = require('path');

require('dotenv').config({ path: path.join(__dirname, '../.env') });

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error('SUPABASE_URL ve SUPABASE_SERVICE_ROLE_KEY .env dosyasında olmalı!');
  process.exit(1);
}

async function runMigration() {
  const requestedFile = process.argv[2];
  const migrationsDir = path.join(__dirname, 'migrations');
  const migrationFiles = fs.readdirSync(migrationsDir)
    .filter((file) => file.endsWith('.sql'))
    .sort();
  const selectedFile = requestedFile || migrationFiles[migrationFiles.length - 1];
  const sqlFile = path.join(migrationsDir, selectedFile);

  if (!fs.existsSync(sqlFile)) {
    console.error(`Migration dosyasi bulunamadi: ${sqlFile}`);
    console.error('Mevcut migration dosyalari:');
    for (const file of migrationFiles) console.error(`- ${file}`);
    process.exit(1);
  }

  const sql = fs.readFileSync(sqlFile, 'utf-8');

  // Split by semicolons and filter empty — execute each statement
  const statements = sql
    .split(/;\s*$/m)
    .map(s => s.trim())
    .filter(s => s.length > 0 && !s.startsWith('--'));

  console.log(`Migration: ${selectedFile}`);
  console.log(`${statements.length} SQL statement bulundu.`);
  console.log(`🔗 Supabase: ${SUPABASE_URL}`);
  console.log('');

  // Use Supabase REST RPC to execute SQL via pg_net or direct REST
  // Since Supabase doesn't expose raw SQL via REST, we'll use the 
  // PostgREST endpoint with the service role key for table creation.
  // The proper way is to use the Supabase Dashboard SQL Editor.

  console.log('Supabase REST API doğrudan public schema SQL çalıştırmayı desteklemiyor.');
  console.log('');
  console.log('Migration SQL\'ini çalıştırmak için şu adımları izle:');
  console.log('');
  console.log(`1. Supabase Dashboard\'a git: ${SUPABASE_URL.replace('.supabase.co', '.supabase.co')}`);
  console.log('   → https://supabase.com/dashboard/project/ üzerinden SQL Editor\'ü aç');
  console.log('');
  console.log('2. SQL Editor\'e bu dosyanın içeriğini yapıştır:');
  console.log(`   ${sqlFile}`);
  console.log('');
  console.log('3. "Run" butonuna bas.');
  console.log('');
  console.log('--- Alternatif: Supabase CLI ---');
  console.log('npx supabase db push');
  console.log('');

  // Also copy SQL to clipboard if possible
  console.log('SQL içeriği aşağıda. Dashboard SQL Editor veya Supabase CLI ile çalıştırılmalı:\n');
  console.log('='.repeat(60));
  console.log(sql);
  console.log('='.repeat(60));
}

runMigration().catch(console.error);
