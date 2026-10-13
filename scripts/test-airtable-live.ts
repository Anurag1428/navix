import dotenv from "dotenv"
dotenv.config({ path: ".env.local" })
dotenv.config({ path: ".env" })
import {
  isAirtableConfigured,
  getAirtableConfig,
  createJobRecord,
  findExistingJob,
  listJobRecords,
  AirtableIntegrationError,
} from "../lib/airtable/index.ts"

async function runLiveAirtableCheck() {
  console.log("========================================")
  console.log("  Airtable Integration Live Check")
  console.log("========================================\n")

  if (!isAirtableConfigured()) {
    console.error("❌ Airtable is NOT configured in environment.")
    console.error("Please ensure your .env.local file contains:")
    console.error("  AIRTABLE_PERSONAL_ACCESS_TOKEN=pat...")
    console.error("  AIRTABLE_BASE_ID=app...")
    console.error("  AIRTABLE_TABLE_NAME=Job Applications (optional, defaults to 'Job Applications')\n")
    process.exit(1)
  }

  const config = getAirtableConfig()
  console.log(`✅ Environment credentials found.`)
  console.log(`  Base ID:    ${config.baseId}`)
  console.log(`  Table Name: ${config.tableName}`)
  console.log(`  Token:      [Configured]`)
  console.log("\nAttempting to connect to Airtable...\n")

  try {
    // 1. Test fetching existing records
    console.log("1. Fetching records from table...")
    const records = await listJobRecords({ limit: 5 })
    console.log(`   Found ${records.length} existing record(s) in '${config.tableName}'.`)

    // 2. Test creating or finding a test record
    const testCompany = "Navix Test Company"
    const testJobTitle = "Airtable Connection Verifier"
    const testUrl = "https://example.com/navix-airtable-test"

    console.log("\n2. Checking duplicate detection...")
    const existing = await findExistingJob({
      company: testCompany,
      jobTitle: testJobTitle,
      jobUrl: testUrl,
    })

    if (existing) {
      console.log(`   Record already exists (ID: ${existing.id}). Connection confirmed!`)
    } else {
      console.log("3. Creating a test record...")
      const created = await createJobRecord({
        company: testCompany,
        jobTitle: testJobTitle,
        jobUrl: testUrl,
        location: "Remote",
        notes: "Automated test record from Navix Airtable check.",
      })
      console.log(`   ✅ Successfully created test record (ID: ${created.id}).`)
      console.log(`   Name: ${created.fields.Name}`)
      console.log(`   Status: ${created.fields.Status}`)
    }

    console.log("\n🎉 Airtable integration is fully working and connected!")
  } catch (error: any) {
    console.error("\n❌ Airtable connection failed:")
    if (error instanceof AirtableIntegrationError) {
      console.error(`  Error Code:  ${error.code}`)
      console.error(`  Status Code: ${error.statusCode || "N/A"}`)
      console.error(`  Message:     ${error.message}`)
      if (error.details) {
        console.error(`  Details:    `, JSON.stringify(error.details, null, 2))
      }
    } else {
      console.error(`  ${error?.message || String(error)}`)
    }
    process.exit(1)
  }
}

runLiveAirtableCheck()
