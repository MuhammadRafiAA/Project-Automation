import fs from "node:fs";
import path from "node:path";

const publishJobId = "threads-network-failure-test-001";

const ledgerPath = path.resolve(
  "tmp",
  "threads-network-failure-jobs.json"
);

fs.mkdirSync(path.dirname(ledgerPath), {
  recursive: true,
});

function readLedger() {
  if (!fs.existsSync(ledgerPath)) {
    return {};
  }

  try {
    return JSON.parse(
      fs.readFileSync(ledgerPath, "utf8")
    );
  } catch {
    return {};
  }
}

function writeLedger(ledger) {
  fs.writeFileSync(
    ledgerPath,
    JSON.stringify(ledger, null, 2)
  );
}

const ledger = readLedger();
const existing = ledger[publishJobId];

if (existing?.status === "PROCESSING") {
  console.log(
    JSON.stringify(
      {
        platform: "threads",
        publish_job_id: publishJobId,
        publish_status: "SKIPPED_AMBIGUOUS_JOB",
        stored_status: "PROCESSING",
        automatic_retry: false,
        action_required:
          "RECONCILIATION_OR_MANUAL_REVIEW",
      },
      null,
      2
    )
  );

  process.exit(0);
}

const startedAt = Date.now();

ledger[publishJobId] = {
  status: "PROCESSING",
  created_at: new Date().toISOString(),
  stage: "publish",
  container_id: "SIMULATED_CONTAINER_ID",
  platform_post_id: null,
};

writeLedger(ledger);

try {
  // Simulate:
  // request may already have been dispatched,
  // but the client loses the response.
  throw new Error(
    "SIMULATED_NETWORK_FAILURE_AFTER_DISPATCH"
  );
} catch (error) {
  ledger[publishJobId] = {
    ...ledger[publishJobId],
    status: "PROCESSING",
    last_error: error.message,
    updated_at: new Date().toISOString(),
  };

  writeLedger(ledger);

  console.error(
    JSON.stringify(
      {
        platform: "threads",
        publish_job_id: publishJobId,
        publish_status: "UNKNOWN",
        stored_status: "PROCESSING",
        error_stage: "publish_network",
        error_message: error.message,
        automatic_retry: false,
        action_required:
          "RECONCILIATION_OR_MANUAL_REVIEW",
        duration_ms: Date.now() - startedAt,
      },
      null,
      2
    )
  );

  process.exitCode = 1;
}