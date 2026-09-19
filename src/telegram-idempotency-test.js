import fs from "node:fs";
import crypto from "node:crypto";

const token = process.env.TELEGRAM_BOT_TOKEN;

if (!token) {
  console.error("Missing TELEGRAM_BOT_TOKEN");
  process.exit(1);
}

const jobId = "telegram-idempotency-001";
const chatId = "@vickyprops";
const text = "Telegram Idempotency Guard Test 001";

const stateDir = "./tmp";
const statePath = `${stateDir}/telegram-publish-jobs.json`;

fs.mkdirSync(stateDir, { recursive: true });

function readState() {
  if (!fs.existsSync(statePath)) {
    return {};
  }

  return JSON.parse(fs.readFileSync(statePath, "utf8"));
}

function writeState(state) {
  fs.writeFileSync(
    statePath,
    JSON.stringify(state, null, 2)
  );
}

const payloadHash = crypto
  .createHash("sha256")
  .update(JSON.stringify({ chatId, text }))
  .digest("hex");

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
        publish_status: "SKIPPED_DUPLICATE_GUARD",
        previous_status: existing.status,
        previous_platform_post_id:
          existing.platform_post_id ?? null,
        payload_hash: payloadHash,
      },
      null,
      2
    )
  );

  process.exit(0);
}

state[jobId] = {
  status: "PROCESSING",
  payload_hash: payloadHash,
  started_at: new Date().toISOString(),
  platform_post_id: null,
};

writeState(state);

const startedAt = Date.now();

try {
  const response = await fetch(
    `https://api.telegram.org/bot${token}/sendMessage`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        chat_id: chatId,
        text,
      }),
    }
  );

  const body = await response.json();

  if (!response.ok || !body.ok) {
    state[jobId] = {
      ...state[jobId],
      status: "FAILED",
      http_status: response.status,
      error_code: body.error_code ?? null,
      error_message: body.description ?? null,
      finished_at: new Date().toISOString(),
    };

    writeState(state);

    console.log(
      JSON.stringify(state[jobId], null, 2)
    );

    process.exit(1);
  }

  state[jobId] = {
    ...state[jobId],
    status: "SUCCESS",
    http_status: response.status,
    platform_post_id: body.result.message_id,
    finished_at: new Date().toISOString(),
    duration_ms: Date.now() - startedAt,
  };

  writeState(state);

  console.log(
    JSON.stringify(
      {
        platform: "telegram",
        publish_job_id: jobId,
        publish_status: "SUCCESS",
        http_status: response.status,
        platform_post_id: body.result.message_id,
        payload_hash: payloadHash,
        duration_ms: Date.now() - startedAt,
      },
      null,
      2
    )
  );
} catch (error) {
  /*
   * Penting:
   * Jangan ubah PROCESSING menjadi FAILED di network exception.
   *
   * Kita tidak tahu apakah Telegram sudah menerima request
   * sebelum koneksi terputus.
   */
  console.error(
    JSON.stringify(
      {
        platform: "telegram",
        publish_job_id: jobId,
        publish_status: "UNKNOWN",
        stored_status: "PROCESSING",
        error_message: error.message,
        automatic_retry: false,
      },
      null,
      2
    )
  );

  process.exitCode = 1;
}