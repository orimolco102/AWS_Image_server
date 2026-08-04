/**
 * Simple load test script for testing ECS autoscaling.
 *
 * Usage:
 *   node load-test.js <url> [durationSeconds] [concurrency]
 *
 * Example:
 *   node load-test.js http://csc-alb-1199573466.eu-central-1.elb.amazonaws.com 180 200
 *
 * This sends a steady stream of concurrent GET requests to the given URL
 * for the given duration, printing progress every few seconds. While it's
 * running, watch:
 *   - ECS Console -> your service -> Tasks tab (task count going up)
 *   - CloudWatch -> CPUUtilization metric for the service
 *   - aws ecs describe-services ... --query "services[0].{desired:desiredCount,running:runningCount}"
 *
 * Stop it any time with Ctrl+C, then keep watching -- after the scale-in
 * cooldown period, task count should drop back down toward the minimum.
 */

const url = process.argv[2];
const durationSeconds = parseInt(process.argv[3] || "180", 10);
const concurrency = parseInt(process.argv[4] || "100", 10);

if (!url) {
  console.error("Usage: node load-test.js <url> [durationSeconds] [concurrency]");
  process.exit(1);
}

let totalRequests = 0;
let totalErrors = 0;
let running = true;

const endTime = Date.now() + durationSeconds * 1000;

async function worker(id) {
  while (running && Date.now() < endTime) {
    try {
      const res = await fetch(url);
      // Drain the body so the connection is properly closed/reused
      await res.arrayBuffer();
      totalRequests++;
    } catch (err) {
      totalErrors++;
    }
  }
}

async function main() {
  console.log(`Starting load test`);
  console.log(`  URL:         ${url}`);
  console.log(`  Duration:    ${durationSeconds}s`);
  console.log(`  Concurrency: ${concurrency}`);
  console.log(`Press Ctrl+C to stop early.\n`);

  // Print progress every 5 seconds
  const progressInterval = setInterval(() => {
    const remaining = Math.max(0, Math.round((endTime - Date.now()) / 1000));
    console.log(
      `[${new Date().toLocaleTimeString()}] requests sent: ${totalRequests} | errors: ${totalErrors} | ~${remaining}s remaining`
    );
  }, 5000);

  const workers = [];
  for (let i = 0; i < concurrency; i++) {
    workers.push(worker(i));
  }

  await Promise.all(workers);

  clearInterval(progressInterval);
  running = false;

  console.log(`\nDone.`);
  console.log(`Total requests: ${totalRequests}`);
  console.log(`Total errors:   ${totalErrors}`);
}

process.on("SIGINT", () => {
  console.log("\nStopping early...");
  running = false;
});

main();