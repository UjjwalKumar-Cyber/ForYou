require("dotenv").config();

const {
  cleanupAnalyticsLogs,
  cleanupExpiredMessages,
  cleanupExpiredNotifications,
  getPostgresPool,
  getStorageSummary,
  initStore
} = require("../src/storage/messages");

async function run() {
  const command = String(process.argv[2] || "cleanup").trim().toLowerCase();

  await initStore();

  if (command === "cleanup" || command === "all") {
    await cleanupExpiredMessages();
    await cleanupAnalyticsLogs();
    await cleanupExpiredNotifications();
    console.log("Cleanup complete: expired messages, old analytics logs, and expired notifications were pruned.");
  }

  if (command === "storage" || command === "summary" || command === "all") {
    const summary = await getStorageSummary();
    console.log(JSON.stringify(summary, null, 2));
  }
}

run()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    const pool = getPostgresPool();
    if (pool) {
      await pool.end().catch(() => {});
    }
  });
