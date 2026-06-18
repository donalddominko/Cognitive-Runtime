// SPDX-License-Identifier: AGPL-3.0-only
// Cognitive Runtime © 2026 Donald Dominko
// Author: Donald Dominko | https://www.linkedin.com/in/donald-dominko/

import { drizzle } from 'drizzle-orm/postgres-js'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import postgres from 'postgres'
import { config } from 'dotenv'

config()

async function runMigrations() {
  const connectionString = process.env.DATABASE_URL!
  const sql = postgres(connectionString, { max: 1 })
  const db = drizzle(sql)

  console.log('⏳ Running migrations...')
  await migrate(db, { migrationsFolder: './migrations' })
  console.log('✅ Migrations completed')

  await sql.end()
}

runMigrations().catch((err) => {
  console.error('❌ Migration failed')
  console.error(err)
  process.exit(1)
})
