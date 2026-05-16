require("dotenv").config();

const {
  cleanupAnalyticsLogs,
  cleanupExpiredNotifications,
  cleanupStorageLogs,
  closeStore,
  getStorageSummary,
  initStore
} = require("../src/storage/messages");

async function printSummary() {
  const summary = await getStorageSummary();

  console.log(`Storage: ${summary.prettyTotal} (${summary.storage})`);
  for (const table of summary.tables) {
    const size = table.bytes ? `, ${table.bytes} bytes` : "";
    console.log(`- ${table.name}: ${table.rows} rows${size}`);
  }
}

async function runCleanup() {
  await cleanupAnalyticsLogs();
  await cleanupExpiredNotifications();
  const result = await cleanupStorageLogs();

  console.log(result.confirmation);
  console.log(`Removed rows: ${result.totalRowsRemoved}`);
  console.log(`Saved: ${result.totalSaved}`);
  for (const [name, count] of Object.entries(result.rowsRemoved)) {
    console.log(`- ${name}: ${count}`);
  }
}

async function main() {
  const command = String(process.argv[2] || "summary").toLowerCase();

  await initStore();

  if (command === "summary") {
    await printSummary();
    return;
  }

  if (command === "cleanup") {
    await runCleanup();
    return;
  }

  console.error("Usage: npm run maintenance:summary OR npm run maintenance:cleanup");
  process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeStore();
  });
