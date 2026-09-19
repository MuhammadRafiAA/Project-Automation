import fs from "node:fs";
import path from "node:path";

const token = process.env.THREADS_ACCESS_TOKEN;

if (!token) {
  console.error("Missing THREADS_ACCESS_TOKEN");
  process.exit(1);
}

const publishJobId = "threads-idempotency-test-001";
const text = "Threads Idempotency Guard Test 001";

const ledgerPath = path.resolve(
  "tmp",
  "threads-publish-jobs.json"
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

if (
  existing?.status === "PROCESSING" ||
  existing?.status === "SUCCESS"
) {
  console.log(
    JSON.stringify(
      {
        platform: "threads",
        publish_job_id: publishJobId,
        publish_status:
          existing.status === "SUCCESS"
            ? "SKIPPED_DUPLICATE_GUARD"
            : "SKIPPED_AMBIGUOUS_JOB",
        stored_status: existing.status,
        container_id:
          existing.container_id ?? null,
        platform_post_id:
          existing.platform_post_id ?? null,
        automatic_retry: false,
      },
      null,
      2
    )
  );

  process.exit(0);
}

const requestTime = new Date().toISOString();
const startedAt = Date.now();

ledger[publishJobId] = {
  status: "PROCESSING",
  created_at: requestTime,
  content_type: "text",
  container_id: null,
  platform_post_id: null,
};

writeLedger(ledger);

let containerId = null;

try {
  // STEP 1 — Create Threads text container
  const createParams = new URLSearchParams({
    media_type: "TEXT",
    text,
  });

  const createResponse = await fetch(
    `https://graph.threads.net/me/threads?${createParams}`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
      },
    }
  );

  const createBody = await createResponse.json();

  if (!createResponse.ok || !createBody.id) {
    ledger[publishJobId] = {
      ...ledger[publishJobId],
      status: "FAILED",
      error_stage: "container_creation",
      error_code:
        createBody.error?.code ?? null,
      error_message:
        createBody.error?.message ?? null,
      updated_at: new Date().toISOString(),
    };

    writeLedger(ledger);

    console.log(
      JSON.stringify(
        {
          platform: "threads",
          publish_job_id: publishJobId,
          http_status: createResponse.status,
          publish_status: "FAILED",
          error_stage: "container_creation",
          error_code:
            createBody.error?.code ?? null,
          error_message:
            createBody.error?.message ?? null,
          duration_ms: Date.now() - startedAt,
        },
        null,
        2
      )
    );

    process.exit(1);
  }

  containerId = createBody.id;

  ledger[publishJobId].container_id =
    containerId;

  writeLedger(ledger);

  // STEP 2 — Publish container
  const publishParams = new URLSearchParams({
    creation_id: containerId,
  });

  const publishResponse = await fetch(
    `https://graph.threads.net/me/threads_publish?${publishParams}`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
      },
    }
  );

  const publishBody = await publishResponse.json();

  if (!publishResponse.ok || !publishBody.id) {
    ledger[publishJobId] = {
      ...ledger[publishJobId],
      status: "FAILED",
      error_stage: "publish",
      error_code:
        publishBody.error?.code ?? null,
      error_message:
        publishBody.error?.message ?? null,
      updated_at: new Date().toISOString(),
    };

    writeLedger(ledger);

    console.log(
      JSON.stringify(
        {
          platform: "threads",
          publish_job_id: publishJobId,
          http_status: publishResponse.status,
          container_id: containerId,
          platform_post_id: null,
          publish_status: "FAILED",
          error_stage: "publish",
          error_code:
            publishBody.error?.code ?? null,
          error_message:
            publishBody.error?.message ?? null,
          duration_ms: Date.now() - startedAt,
        },
        null,
        2
      )
    );

    process.exit(1);
  }

  const postId = publishBody.id;

  ledger[publishJobId] = {
    ...ledger[publishJobId],
    status: "SUCCESS",
    platform_post_id: postId,
    updated_at: new Date().toISOString(),
  };

  writeLedger(ledger);

  console.log(
    JSON.stringify(
      {
        platform: "threads",
        publish_job_id: publishJobId,
        http_status: publishResponse.status,
        container_id: containerId,
        platform_post_id: postId,
        publish_status: "SUCCESS",
        duration_ms: Date.now() - startedAt,
      },
      null,
      2
    )
  );
} catch (error) {
  // IMPORTANT:
  // Do not change PROCESSING to FAILED here.
  // The request may actually have reached Threads.
  ledger[publishJobId] = {
    ...ledger[publishJobId],
    status: "PROCESSING",
    container_id: containerId,
    last_error: error.message,
    updated_at: new Date().toISOString(),
  };

  writeLedger(ledger);

  console.error(
    JSON.stringify(
      {
        platform: "threads",
        publish_job_id: publishJobId,
        container_id: containerId,
        platform_post_id: null,
        publish_status: "UNKNOWN",
        stored_status: "PROCESSING",
        error_stage:
          containerId
            ? "publish_network"
            : "container_creation_network",
        error_message: error.message,
        automatic_retry: false,
        duration_ms: Date.now() - startedAt,
      },
      null,
      2
    )
  );

  process.exitCode = 1;
}