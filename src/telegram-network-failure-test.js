import fs from "node:fs";

const jobId = "telegram-network-failure-001";

const stateDir = "./tmp";
const statePath =
  `${stateDir}/telegram-network-failure-jobs.json`;

fs.mkdirSync(stateDir, { recursive: true });

function readState() {
  if (!fs.existsSync(statePath)) {
    return {};
  }

  return JSON.parse(
    fs.readFileSync(statePath, "utf8")
  );
}

function writeState(state) {
  fs.writeFileSync(
    statePath,
    JSON.stringify(state, null, 2)
  );
}

const state = readState();
const existing = state[jobId];

if (
  existing?.status === "PROCESSING" ||
  existing?.status === "SUCCESS"
) {
  console.log(
    JSON.stringify(
      {
        platform: "telegram",
        publish_job_id: jobId,
        publish_status:
          "SKIPPED_AMBIGUOUS_JOB",
        stored_status: existing.status,
        automatic_retry: false,
        action_required:
          "RECONCILIATION_OR_MANUAL_REVIEW"
      },
      null,
      2
    )
  );

  process.exit(0);
}

/*
 * Sebelum network call, job harus sudah tercatat.
 */
state[jobId] = {
  status: "PROCESSING",
  started_at: new Date().toISOString(),
  platform_post_id: null
};

writeState(state);

try {
  /*
   * Ini sengaja mensimulasikan kondisi:
   *
   * request mungkin sudah dikirim,
   * tetapi aplikasi kehilangan response.
   *
   * Kita TIDAK benar-benar publish ke Telegram
   * supaya failure test tidak membuat spam.
   */
  throw new Error(
    "SIMULATED_NETWORK_FAILURE_AFTER_DISPATCH"
  );
} catch (error) {
  /*
   * PENTING:
   * status TIDAK diubah menjadi FAILED.
   *
   * Karena outcome platform tidak diketahui.
   */
  console.error(
    JSON.stringify(
      {
        platform: "telegram",
        publish_job_id: jobId,
        publish_status: "UNKNOWN",
        stored_status: "PROCESSING",
        error_stage: "network",
        error_message: error.message,
        automatic_retry: false,
        action_required:
          "RECONCILIATION_OR_MANUAL_REVIEW"
      },
      null,
      2
    )
  );

  process.exitCode = 1;
}