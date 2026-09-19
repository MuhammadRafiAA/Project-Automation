import fs from "node:fs";
import path from "node:path";

const TOKEN = process.env.FACEBOOK_PAGE_ACCESS_TOKEN;
const PAGE_ID = process.env.FACEBOOK_PAGE_ID;
const IMAGE_URL = process.env.FACEBOOK_TEST_IMAGE_URL;

const GRAPH_VERSION =
  process.env.FACEBOOK_GRAPH_VERSION || "v26.0";

const BASE =
  `https://graph.facebook.com/${GRAPH_VERSION}`;

if (!TOKEN || !PAGE_ID || !IMAGE_URL) {
  console.error(
    "Missing FACEBOOK_PAGE_ACCESS_TOKEN, FACEBOOK_PAGE_ID, or FACEBOOK_TEST_IMAGE_URL"
  );
  process.exit(1);
}

function section(name, data) {
  console.log(`\n===== ${name} =====`);
  console.log(JSON.stringify(data, null, 2));
}

async function requestJson(
  path,
  {
    method = "GET",
    params = null,
    token = TOKEN,
  } = {}
) {
  const startedAt = Date.now();

  try {
    const response = await fetch(
      `${BASE}/${path}`,
      {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          ...(params
            ? {
                "Content-Type":
                  "application/x-www-form-urlencoded",
              }
            : {}),
        },
        body:
          params
            ? new URLSearchParams(params)
            : undefined,
      }
    );

    let body = null;

    try {
      body = await response.json();
    } catch {}

    return {
      response_received: true,
      ok: response.ok,
      http_status: response.status,
      body,
      duration_ms:
        Date.now() - startedAt,
    };
  } catch (error) {
    return {
      response_received: false,
      ok: false,
      http_status: null,
      body: null,
      network_error:
        error.message,
      duration_ms:
        Date.now() - startedAt,
    };
  }
}

async function publishText(message) {
  const result = await requestJson(
    `${PAGE_ID}/feed`,
    {
      method: "POST",
      params: {
        message,
      },
    }
  );

  return {
    ok:
      result.ok &&
      Boolean(result.body?.id),
    http_status:
      result.http_status,
    platform_post_id:
      result.body?.id ?? null,
    error_code:
      result.body?.error?.code ?? null,
    error_subcode:
      result.body?.error
        ?.error_subcode ?? null,
    error_message:
      result.body?.error?.message ??
      result.network_error ??
      null,
    response_received:
      result.response_received,
    duration_ms:
      result.duration_ms,
  };
}

async function publishImage(
  imageUrl,
  caption
) {
  const result = await requestJson(
    `${PAGE_ID}/photos`,
    {
      method: "POST",
      params: {
        url: imageUrl,
        caption,
      },
    }
  );

  return {
    ok:
      result.ok &&
      Boolean(result.body?.id),
    http_status:
      result.http_status,
    media_id:
      result.body?.id ?? null,
    platform_post_id:
      result.body?.post_id ??
      result.body?.id ??
      null,
    error_code:
      result.body?.error?.code ?? null,
    error_subcode:
      result.body?.error
        ?.error_subcode ?? null,
    error_message:
      result.body?.error?.message ??
      result.network_error ??
      null,
    response_received:
      result.response_received,
    duration_ms:
      result.duration_ms,
  };
}

// ==================================================
// 0. PUBLIC IMAGE PREFLIGHT
// ==================================================

let preflight;

try {
  const response = await fetch(
    IMAGE_URL,
    { method: "HEAD" }
  );

  preflight = {
    http_status:
      response.status,
    content_type:
      response.headers.get(
        "content-type"
      ),
    content_length:
      response.headers.get(
        "content-length"
      ),
    pass:
      response.ok &&
      response.headers
        .get("content-type")
        ?.startsWith("image/"),
  };
} catch (error) {
  preflight = {
    pass: false,
    error: error.message,
  };
}

section(
  "0 PUBLIC IMAGE PREFLIGHT",
  preflight
);

if (!preflight.pass) {
  console.error(
    "STOP: public image URL is unhealthy."
  );
  process.exit(1);
}

// ==================================================
// 1. INVALID CREDENTIAL
// ==================================================

const invalidCredentialRaw =
  await requestJson(
    "me?fields=id,name",
    {
      token:
        "INVALID_FACEBOOK_TOKEN_FOR_POC",
    }
  );

const invalidCredential = {
  http_status:
    invalidCredentialRaw.http_status,
  error_type:
    invalidCredentialRaw.body?.error
      ?.type ?? null,
  error_code:
    invalidCredentialRaw.body?.error
      ?.code ?? null,
  error_subcode:
    invalidCredentialRaw.body?.error
      ?.error_subcode ?? null,
  error_message:
    invalidCredentialRaw.body?.error
      ?.message ?? null,
  expected_failure:
    !invalidCredentialRaw.ok,
};

section(
  "1 INVALID CREDENTIAL",
  invalidCredential
);

// ==================================================
// 2. INVALID IMAGE URL
// ==================================================

const badUrl = new URL(IMAGE_URL);

badUrl.pathname =
  "/media/facebook-does-not-exist.jpg";

const invalidMedia =
  await publishImage(
    badUrl.toString(),
    "Facebook Invalid Media Test 001"
  );

section(
  "2 INVALID MEDIA URL",
  {
    ...invalidMedia,
    expected_failure:
      !invalidMedia.ok,
  }
);

// ==================================================
// 3. DUPLICATE EXECUTION
// ==================================================

const duplicateMessage =
  "Facebook Duplicate Execution Test 001";

const duplicate1 =
  await publishText(
    duplicateMessage
  );

const duplicate2 =
  await publishText(
    duplicateMessage
  );

const duplicateResult = {
  same_publish_job_id:
    "facebook-duplicate-test-001",
  same_payload: true,
  attempts: [
    duplicate1,
    duplicate2,
  ],
  duplicate_created:
    duplicate1.ok &&
    duplicate2.ok &&
    duplicate1.platform_post_id !==
      duplicate2.platform_post_id,
};

section(
  "3 DUPLICATE EXECUTION",
  duplicateResult
);

// ==================================================
// 4. APPLICATION IDEMPOTENCY GUARD
// ==================================================

const ledgerPath =
  path.resolve(
    "tmp",
    "facebook-publish-jobs.json"
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
  message
) {
  let ledger = readLedger();

  const existing =
    ledger[publishJobId];

  if (
    existing?.status ===
    "SUCCESS"
  ) {
    return {
      publish_job_id:
        publishJobId,
      publish_status:
        "SKIPPED_DUPLICATE_GUARD",
      stored_status:
        "SUCCESS",
      platform_post_id:
        existing.platform_post_id ??
        null,
      automatic_retry: false,
    };
  }

  if (
    existing?.status ===
    "PROCESSING"
  ) {
    return {
      publish_job_id:
        publishJobId,
      publish_status:
        "SKIPPED_AMBIGUOUS_JOB",
      stored_status:
        "PROCESSING",
      platform_post_id:
        existing.platform_post_id ??
        null,
      automatic_retry: false,
      action_required:
        "RECONCILIATION_OR_MANUAL_REVIEW",
    };
  }

  ledger[publishJobId] = {
    status: "PROCESSING",
    created_at:
      new Date().toISOString(),
    platform_post_id: null,
  };

  writeLedger(ledger);

  const result =
    await publishText(message);

  ledger = readLedger();

  if (result.ok) {
    ledger[publishJobId] = {
      ...ledger[publishJobId],
      status: "SUCCESS",
      platform_post_id:
        result.platform_post_id,
      updated_at:
        new Date().toISOString(),
    };

    writeLedger(ledger);

    return {
      publish_job_id:
        publishJobId,
      publish_status:
        "SUCCESS",
      http_status:
        result.http_status,
      platform_post_id:
        result.platform_post_id,
      automatic_retry: false,
    };
  }

  /*
   * No HTTP response means we do not know
   * whether Facebook actually created the post.
   * Keep PROCESSING and do not blind retry.
   */
  if (!result.response_received) {
    ledger[publishJobId] = {
      ...ledger[publishJobId],
      status: "PROCESSING",
      last_error:
        result.error_message,
      updated_at:
        new Date().toISOString(),
    };

    writeLedger(ledger);

    return {
      publish_job_id:
        publishJobId,
      publish_status:
        "UNKNOWN",
      stored_status:
        "PROCESSING",
      platform_post_id: null,
      automatic_retry: false,
      action_required:
        "RECONCILIATION_OR_MANUAL_REVIEW",
    };
  }

  /*
   * Concrete HTTP/API failure:
   * safe to store as FAILED for this PoC.
   */
  ledger[publishJobId] = {
    ...ledger[publishJobId],
    status: "FAILED",
    error_code:
      result.error_code,
    error_message:
      result.error_message,
    updated_at:
      new Date().toISOString(),
  };

  writeLedger(ledger);

  return {
    publish_job_id:
      publishJobId,
    publish_status:
      "FAILED",
    http_status:
      result.http_status,
    error_code:
      result.error_code,
    error_message:
      result.error_message,
  };
}

const guardJobId =
  "facebook-idempotency-test-001";

const guardMessage =
  "Facebook Idempotency Guard Test 001";

const guardRun1 =
  await guardedPublish(
    guardJobId,
    guardMessage
  );

const guardRun2 =
  await guardedPublish(
    guardJobId,
    guardMessage
  );

const guardResult = {
  run_1: guardRun1,
  run_2: guardRun2,
  guard_pass:
    guardRun1.publish_status ===
      "SUCCESS" &&
    guardRun2.publish_status ===
      "SKIPPED_DUPLICATE_GUARD",
};

section(
  "4 IDEMPOTENCY GUARD",
  guardResult
);

// ==================================================
// 5. AMBIGUOUS NETWORK FAILURE SIMULATION
// ==================================================

const networkLedgerPath =
  path.resolve(
    "tmp",
    "facebook-network-failure-jobs.json"
  );

const networkJobId =
  "facebook-network-failure-test-001";

function readNetworkLedger() {
  if (
    !fs.existsSync(
      networkLedgerPath
    )
  ) {
    return {};
  }

  try {
    return JSON.parse(
      fs.readFileSync(
        networkLedgerPath,
        "utf8"
      )
    );
  } catch {
    return {};
  }
}

function writeNetworkLedger(
  ledger
) {
  fs.writeFileSync(
    networkLedgerPath,
    JSON.stringify(
      ledger,
      null,
      2
    )
  );
}

function simulatedNetworkRun() {
  const ledger =
    readNetworkLedger();

  const existing =
    ledger[networkJobId];

  if (
    existing?.status ===
    "PROCESSING"
  ) {
    return {
      publish_job_id:
        networkJobId,
      publish_status:
        "SKIPPED_AMBIGUOUS_JOB",
      stored_status:
        "PROCESSING",
      automatic_retry: false,
      action_required:
        "RECONCILIATION_OR_MANUAL_REVIEW",
    };
  }

  ledger[networkJobId] = {
    status: "PROCESSING",
    created_at:
      new Date().toISOString(),
    stage: "publish",
    platform_post_id: null,
  };

  writeNetworkLedger(ledger);

  /*
   * No real Facebook request.
   * We simulate a lost response after dispatch.
   */
  return {
    publish_job_id:
      networkJobId,
    publish_status:
      "UNKNOWN",
    stored_status:
      "PROCESSING",
    error_stage:
      "publish_network",
    error_message:
      "SIMULATED_NETWORK_FAILURE_AFTER_DISPATCH",
    automatic_retry: false,
    action_required:
      "RECONCILIATION_OR_MANUAL_REVIEW",
  };
}

const networkRun1 =
  simulatedNetworkRun();

const networkRun2 =
  simulatedNetworkRun();

const networkResult = {
  run_1: networkRun1,
  run_2: networkRun2,
  ambiguity_guard_pass:
    networkRun1.publish_status ===
      "UNKNOWN" &&
    networkRun2.publish_status ===
      "SKIPPED_AMBIGUOUS_JOB",
};

section(
  "5 AMBIGUOUS NETWORK FAILURE",
  networkResult
);

// ==================================================
// FINAL SUMMARY
// ==================================================

const summary = {
  platform: "facebook",

  invalid_credential:
    invalidCredential.expected_failure
      ? "PASS"
      : "FAIL",

  invalid_media:
    !invalidMedia.ok
      ? "PASS"
      : "FAIL",

  duplicate_risk:
    duplicateResult.duplicate_created
      ? "CONFIRMED"
      : "NOT_CONFIRMED",

  idempotency_guard:
    guardResult.guard_pass
      ? "PASS"
      : "FAIL",

  ambiguous_network_guard:
    networkResult.ambiguity_guard_pass
      ? "PASS"
      : "FAIL",
};

section(
  "FINAL FACEBOOK SUMMARY",
  summary
);

console.log(
  "\nBATCH COMPLETE — perform visual verification on Facebook."
);