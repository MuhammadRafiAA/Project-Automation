import fs from "node:fs";
import path from "node:path";

const TOKEN = process.env.INSTAGRAM_ACCESS_TOKEN;
const IG_USER_ID = process.env.INSTAGRAM_USER_ID;
const IMAGE_URL = process.env.INSTAGRAM_TEST_IMAGE_URL;

const BASE = "https://graph.instagram.com";

// Failed duplicate container from previous batch.
// We may safely inspect/retry THIS SAME container.
const DUPLICATE_CONTAINER_ID = "18124453882658250";

// Failed first idempotency container.
// IMPORTANT: inspect only. Do NOT publish it,
// because one Idempotency Test 001 post already exists.
const OLD_IDEMPOTENCY_CONTAINER_ID = "18124453906658250";

if (!TOKEN || !IG_USER_ID || !IMAGE_URL) {
  console.error("Missing Instagram environment variables.");
  process.exit(1);
}

const sleep = (ms) =>
  new Promise((resolve) => setTimeout(resolve, ms));

function section(name, data) {
  console.log(`\n===== ${name} =====`);
  console.log(JSON.stringify(data, null, 2));
}

async function requestJson(url, options = {}) {
  const startedAt = Date.now();

  try {
    const response = await fetch(url, {
      ...options,
      headers: {
        ...(options.headers ?? {}),
        Authorization: `Bearer ${TOKEN}`,
      },
    });

    let body = null;

    try {
      body = await response.json();
    } catch {}

    return {
      response_received: true,
      ok: response.ok,
      http_status: response.status,
      body,
      duration_ms: Date.now() - startedAt,
    };
  } catch (error) {
    return {
      response_received: false,
      ok: false,
      http_status: null,
      body: null,
      network_error: error.message,
      duration_ms: Date.now() - startedAt,
    };
  }
}

async function getStatus(containerId) {
  return requestJson(
    `${BASE}/${containerId}?fields=status_code,status`
  );
}

async function publishContainer(containerId) {
  const params = new URLSearchParams({
    creation_id: containerId,
  });

  const result = await requestJson(
    `${BASE}/${IG_USER_ID}/media_publish?${params}`,
    { method: "POST" }
  );

  return {
    ...result,
    platform_post_id: result.body?.id ?? null,
    error_code: result.body?.error?.code ?? null,
    error_subcode:
      result.body?.error?.error_subcode ?? null,
    error_message:
      result.body?.error?.message ?? null,
  };
}

async function waitUntilFinished(containerId) {
  for (let attempt = 1; attempt <= 15; attempt++) {
    const status = await getStatus(containerId);

    const statusCode =
      status.body?.status_code ?? null;

    if (statusCode === "FINISHED") {
      return {
        ready: true,
        attempt,
        status,
      };
    }

    if (
      statusCode === "ERROR" ||
      statusCode === "EXPIRED" ||
      statusCode === "PUBLISHED"
    ) {
      return {
        ready: false,
        attempt,
        status,
      };
    }

    await sleep(2000);
  }

  return {
    ready: false,
    timeout: true,
  };
}

async function createContainer(caption) {
  const params = new URLSearchParams({
    image_url: IMAGE_URL,
    caption,
  });

  const result = await requestJson(
    `${BASE}/${IG_USER_ID}/media?${params}`,
    { method: "POST" }
  );

  return {
    ...result,
    container_id: result.body?.id ?? null,
  };
}

/*
 * Publish the SAME container.
 *
 * HTTP 9007/2207027 gets a bounded readiness retry.
 *
 * A network exception does NOT retry automatically because
 * the outcome may be ambiguous.
 */
async function publishSameContainerSafely(
  containerId,
  maxAttempts = 3
) {
  for (
    let attempt = 1;
    attempt <= maxAttempts;
    attempt++
  ) {
    const status = await getStatus(containerId);
    const statusCode =
      status.body?.status_code ?? null;

    if (statusCode === "PUBLISHED") {
      return {
        ok: true,
        already_published: true,
        attempt,
        container_id: containerId,
        platform_post_id: null,
      };
    }

    if (statusCode !== "FINISHED") {
      return {
        ok: false,
        container_id: containerId,
        attempt,
        failure_type:
          "CONTAINER_NOT_READY",
        container_status: statusCode,
      };
    }

    // Small settling delay after FINISHED.
    await sleep(5000);

    const publish =
      await publishContainer(containerId);

    if (publish.ok && publish.platform_post_id) {
      return {
        ok: true,
        container_id: containerId,
        platform_post_id:
          publish.platform_post_id,
        attempt,
        http_status:
          publish.http_status,
      };
    }

    // No HTTP response = ambiguous.
    // Never blind retry.
    if (!publish.response_received) {
      return {
        ok: false,
        ambiguous: true,
        container_id: containerId,
        attempt,
        publish_status: "UNKNOWN",
        automatic_retry: false,
        action_required:
          "RECONCILIATION_OR_MANUAL_REVIEW",
        error_message:
          publish.network_error,
      };
    }

    const readinessRace =
      publish.error_code === 9007 &&
      publish.error_subcode === 2207027;

    if (
      readinessRace &&
      attempt < maxAttempts
    ) {
      await sleep(5000 * attempt);
      continue;
    }

    return {
      ok: false,
      ambiguous: false,
      container_id: containerId,
      attempt,
      http_status:
        publish.http_status,
      error_code:
        publish.error_code,
      error_subcode:
        publish.error_subcode,
      error_message:
        publish.error_message,
    };
  }
}

// ------------------------------------------------
// 0. PUBLIC MEDIA PREFLIGHT
// ------------------------------------------------

let preflight;

try {
  const response = await fetch(
    IMAGE_URL,
    { method: "HEAD" }
  );

  preflight = {
    http_status: response.status,
    content_type:
      response.headers.get("content-type"),
    content_length:
      response.headers.get("content-length"),
    pass:
      response.ok &&
      response.headers
        .get("content-type")
        ?.startsWith("image/jpeg"),
  };
} catch (error) {
  preflight = {
    pass: false,
    error: error.message,
  };
}

section(
  "0 PUBLIC MEDIA PREFLIGHT",
  preflight
);

if (!preflight.pass) {
  console.error(
    "STOP: public media URL is not healthy."
  );
  process.exit(1);
}

// ------------------------------------------------
// 1. INSPECT FAILED CONTAINERS
// ------------------------------------------------

const duplicateStatus =
  await getStatus(
    DUPLICATE_CONTAINER_ID
  );

const oldIdempotencyStatus =
  await getStatus(
    OLD_IDEMPOTENCY_CONTAINER_ID
  );

section(
  "1 FAILED CONTAINER STATUS",
  {
    duplicate_container: {
      id: DUPLICATE_CONTAINER_ID,
      http_status:
        duplicateStatus.http_status,
      status_code:
        duplicateStatus.body
          ?.status_code ?? null,
      status:
        duplicateStatus.body
          ?.status ?? null,
    },

    old_idempotency_container: {
      id:
        OLD_IDEMPOTENCY_CONTAINER_ID,
      http_status:
        oldIdempotencyStatus.http_status,
      status_code:
        oldIdempotencyStatus.body
          ?.status_code ?? null,
      status:
        oldIdempotencyStatus.body
          ?.status ?? null,
      action:
        "INSPECT_ONLY_DO_NOT_PUBLISH",
    },
  }
);

// ------------------------------------------------
// 2. COMPLETE DUPLICATE TEST
// ------------------------------------------------

let duplicateRecovery;

if (
  duplicateStatus.body?.status_code ===
  "FINISHED"
) {
  duplicateRecovery =
    await publishSameContainerSafely(
      DUPLICATE_CONTAINER_ID
    );
} else {
  duplicateRecovery = {
    ok: false,
    skipped: true,
    reason:
      "DUPLICATE_CONTAINER_NOT_FINISHED",
    status:
      duplicateStatus.body?.status_code ??
      null,
  };
}

section(
  "2 DUPLICATE RECOVERY",
  duplicateRecovery
);

// ------------------------------------------------
// 3. CORRECTED IDEMPOTENCY TEST
// ------------------------------------------------

const ledgerPath =
  path.resolve(
    "tmp",
    "instagram-idempotency-fixed.json"
  );

fs.mkdirSync(
  path.dirname(ledgerPath),
  { recursive: true }
);

function readLedger() {
  if (!fs.existsSync(ledgerPath)) {
    return {};
  }

  try {
    return JSON.parse(
      fs.readFileSync(
        ledgerPath,
        "utf8"
      )
    );
  } catch {
    return {};
  }
}

function writeLedger(ledger) {
  fs.writeFileSync(
    ledgerPath,
    JSON.stringify(
      ledger,
      null,
      2
    )
  );
}

async function guardedPublish(
  publishJobId,
  caption
) {
  let ledger = readLedger();

  const existing =
    ledger[publishJobId];

  if (existing?.status === "SUCCESS") {
    return {
      publish_job_id:
        publishJobId,
      publish_status:
        "SKIPPED_DUPLICATE_GUARD",
      stored_status: "SUCCESS",
      container_id:
        existing.container_id,
      platform_post_id:
        existing.platform_post_id,
      automatic_retry: false,
    };
  }

  if (existing?.status === "PROCESSING") {
    return {
      publish_job_id:
        publishJobId,
      publish_status:
        "SKIPPED_AMBIGUOUS_JOB",
      stored_status:
        "PROCESSING",
      container_id:
        existing.container_id ?? null,
      platform_post_id:
        existing.platform_post_id ?? null,
      automatic_retry: false,
      action_required:
        "RECONCILIATION_OR_MANUAL_REVIEW",
    };
  }

  ledger[publishJobId] = {
    status: "PROCESSING",
    created_at:
      new Date().toISOString(),
    container_id: null,
    platform_post_id: null,
  };

  writeLedger(ledger);

  const create =
    await createContainer(caption);

  if (!create.ok || !create.container_id) {
    ledger = readLedger();

    ledger[publishJobId] = {
      ...ledger[publishJobId],
      status: "FAILED",
      failure_stage:
        "container_creation",
      error_code:
        create.body?.error?.code ??
        null,
      error_message:
        create.body?.error?.message ??
        null,
    };

    writeLedger(ledger);

    return {
      publish_job_id:
        publishJobId,
      publish_status: "FAILED",
      failure_stage:
        "container_creation",
    };
  }

  const containerId =
    create.container_id;

  ledger = readLedger();

  ledger[publishJobId] = {
    ...ledger[publishJobId],
    container_id:
      containerId,
  };

  writeLedger(ledger);

  const readiness =
    await waitUntilFinished(
      containerId
    );

  if (!readiness.ready) {
    // Keep PROCESSING:
    // do NOT create another container on next run.
    ledger = readLedger();

    ledger[publishJobId] = {
      ...ledger[publishJobId],
      status: "PROCESSING",
      last_stage:
        "container_processing",
      updated_at:
        new Date().toISOString(),
    };

    writeLedger(ledger);

    return {
      publish_job_id:
        publishJobId,
      publish_status: "UNKNOWN",
      stored_status:
        "PROCESSING",
      container_id:
        containerId,
      automatic_retry: false,
      action_required:
        "RECONCILIATION_OR_MANUAL_REVIEW",
    };
  }

  const publish =
    await publishSameContainerSafely(
      containerId
    );

  ledger = readLedger();

  if (
    publish.ok &&
    publish.platform_post_id
  ) {
    ledger[publishJobId] = {
      ...ledger[publishJobId],
      status: "SUCCESS",
      platform_post_id:
        publish.platform_post_id,
      updated_at:
        new Date().toISOString(),
    };

    writeLedger(ledger);

    return {
      publish_job_id:
        publishJobId,
      publish_status: "SUCCESS",
      container_id:
        containerId,
      platform_post_id:
        publish.platform_post_id,
      automatic_retry: false,
    };
  }

  // Any publish-stage uncertainty/failure:
  // KEEP PROCESSING and KEEP SAME CONTAINER.
  // Never create a fresh container automatically.
  ledger[publishJobId] = {
    ...ledger[publishJobId],
    status: "PROCESSING",
    last_stage: "publish",
    last_result: publish,
    updated_at:
      new Date().toISOString(),
  };

  writeLedger(ledger);

  return {
    publish_job_id:
      publishJobId,
    publish_status:
      publish.ambiguous
        ? "UNKNOWN"
        : "BLOCKED_FOR_RECONCILIATION",
    stored_status:
      "PROCESSING",
    container_id:
      containerId,
    automatic_retry: false,
    action_required:
      "RECONCILIATION_OR_MANUAL_REVIEW",
    result: publish,
  };
}

const fixedJobId =
  "instagram-idempotency-test-002";

const fixedCaption =
  "Instagram Idempotency Guard Test 002";

const fixedRun1 =
  await guardedPublish(
    fixedJobId,
    fixedCaption
  );

const fixedRun2 =
  await guardedPublish(
    fixedJobId,
    fixedCaption
  );

const fixedGuardPass =
  fixedRun1.publish_status ===
    "SUCCESS" &&
  fixedRun2.publish_status ===
    "SKIPPED_DUPLICATE_GUARD";

section(
  "3 CORRECTED IDEMPOTENCY GUARD",
  {
    run_1: fixedRun1,
    run_2: fixedRun2,
    guard_pass:
      fixedGuardPass,
  }
);

// ------------------------------------------------
// FINAL
// ------------------------------------------------

section(
  "FINAL RECOVERY SUMMARY",
  {
    duplicate_second_post_created:
      duplicateRecovery.ok === true,

    corrected_idempotency_guard:
      fixedGuardPass
        ? "PASS"
        : "NOT_PASS",

    important_rule:
      "Never create a fresh container automatically after a publish-stage failure.",
  }
);

console.log(
  "\nRECOVERY BATCH COMPLETE"
);