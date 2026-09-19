import fs from "node:fs";
import path from "node:path";

const TOKEN = process.env.INSTAGRAM_ACCESS_TOKEN;
const IG_USER_ID = process.env.INSTAGRAM_USER_ID;
const IMAGE_URL = process.env.INSTAGRAM_TEST_IMAGE_URL;

const MANUAL_CONTAINER_ID = "18124451284658250";

if (!TOKEN || !IG_USER_ID || !IMAGE_URL) {
  console.error(
    "Missing INSTAGRAM_ACCESS_TOKEN, INSTAGRAM_USER_ID, or INSTAGRAM_TEST_IMAGE_URL"
  );
  process.exit(1);
}

const BASE = "https://graph.instagram.com";

const sleep = (ms) =>
  new Promise((resolve) => setTimeout(resolve, ms));

async function requestJson(url, options = {}, token = TOKEN) {
  const started = Date.now();

  try {
    const response = await fetch(url, {
      ...options,
      headers: {
        ...(options.headers ?? {}),
        Authorization: `Bearer ${token}`,
      },
    });

    let body;

    try {
      body = await response.json();
    } catch {
      body = null;
    }

    return {
      ok: response.ok,
      http_status: response.status,
      body,
      duration_ms: Date.now() - started,
    };
  } catch (error) {
    return {
      ok: false,
      http_status: null,
      body: null,
      network_error: error.message,
      duration_ms: Date.now() - started,
    };
  }
}

async function createContainer(caption, imageUrl = IMAGE_URL) {
  const params = new URLSearchParams({
    image_url: imageUrl,
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

async function getContainerStatus(containerId) {
  return requestJson(
    `${BASE}/${containerId}?fields=status_code,status`
  );
}

async function waitUntilFinished(containerId) {
  for (let attempt = 1; attempt <= 15; attempt++) {
    const result =
      await getContainerStatus(containerId);

    const statusCode =
      result.body?.status_code ?? null;

    if (statusCode === "FINISHED") {
      return {
        ready: true,
        attempt,
        ...result,
      };
    }

    if (
      statusCode === "ERROR" ||
      statusCode === "EXPIRED"
    ) {
      return {
        ready: false,
        attempt,
        ...result,
      };
    }

    await sleep(2000);
  }

  return {
    ready: false,
    http_status: null,
    body: null,
    timeout: true,
  };
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
    platform_post_id:
      result.body?.id ?? null,
  };
}

async function createWaitPublish(caption) {
  const started = Date.now();

  const create =
    await createContainer(caption);

  if (!create.ok || !create.container_id) {
    return {
      ok: false,
      stage: "container_creation",
      container_id: null,
      platform_post_id: null,
      create,
      duration_ms: Date.now() - started,
    };
  }

  const status =
    await waitUntilFinished(create.container_id);

  if (!status.ready) {
    return {
      ok: false,
      stage: "container_processing",
      container_id: create.container_id,
      platform_post_id: null,
      status,
      duration_ms: Date.now() - started,
    };
  }

  const publish =
    await publishContainer(create.container_id);

  return {
    ok:
      publish.ok &&
      Boolean(publish.platform_post_id),
    stage: "publish",
    container_id: create.container_id,
    platform_post_id:
      publish.platform_post_id,
    http_status: publish.http_status,
    error_code:
      publish.body?.error?.code ?? null,
    error_subcode:
      publish.body?.error?.error_subcode ??
      null,
    error_message:
      publish.body?.error?.message ?? null,
    duration_ms: Date.now() - started,
  };
}

function printSection(name, data) {
  console.log(`\n===== ${name} =====`);
  console.log(JSON.stringify(data, null, 2));
}

// --------------------------------------------------
// 0. PUBLIC MEDIA PREFLIGHT
// --------------------------------------------------

let publicMedia;

try {
  const response = await fetch(IMAGE_URL, {
    method: "HEAD",
  });

  publicMedia = {
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
  publicMedia = {
    pass: false,
    error: error.message,
  };
}

printSection(
  "0 PUBLIC MEDIA PREFLIGHT",
  publicMedia
);

if (!publicMedia.pass) {
  console.error(
    "\nSTOP: public image URL is not healthy."
  );
  process.exit(1);
}

// --------------------------------------------------
// 1. PUBLISH EXISTING MANUAL CONTAINER
// --------------------------------------------------

const manualPublish =
  await publishContainer(
    MANUAL_CONTAINER_ID
  );

const manualResult = {
  container_id: MANUAL_CONTAINER_ID,
  http_status:
    manualPublish.http_status,
  platform_post_id:
    manualPublish.platform_post_id,
  publish_status:
    manualPublish.ok &&
    manualPublish.platform_post_id
      ? "SUCCESS"
      : "FAILED",
  error_code:
    manualPublish.body?.error?.code ?? null,
  error_message:
    manualPublish.body?.error?.message ??
    null,
};

printSection(
  "1 MANUAL IMAGE PUBLISH",
  manualResult
);

// --------------------------------------------------
// 2. REPEATABLE IMAGE PUBLISH
// --------------------------------------------------

const repeatable =
  await createWaitPublish(
    "Property Marketing AI OS - Instagram Script Test 001"
  );

printSection(
  "2 REPEATABLE IMAGE PUBLISH",
  repeatable
);

// --------------------------------------------------
// 3. INVALID CREDENTIAL
// --------------------------------------------------

const invalidCredential =
  await requestJson(
    `${BASE}/me?fields=id,username`,
    {},
    "INVALID_INSTAGRAM_TOKEN_FOR_POC"
  );

const invalidCredentialResult = {
  http_status:
    invalidCredential.http_status,
  error_type:
    invalidCredential.body?.error?.type ??
    null,
  error_code:
    invalidCredential.body?.error?.code ??
    null,
  error_message:
    invalidCredential.body?.error?.message ??
    null,
  expected_failure:
    !invalidCredential.ok,
};

printSection(
  "3 INVALID CREDENTIAL",
  invalidCredentialResult
);

// --------------------------------------------------
// 4. INVALID MEDIA URL
// --------------------------------------------------

const invalidUrl =
  new URL(IMAGE_URL);

invalidUrl.pathname =
  "/media/does-not-exist-instagram.jpg";

const invalidMedia =
  await createContainer(
    "Instagram Invalid Media Test 001",
    invalidUrl.toString()
  );

const invalidMediaResult = {
  http_status:
    invalidMedia.http_status,
  container_id:
    invalidMedia.container_id,
  error_code:
    invalidMedia.body?.error?.code ?? null,
  error_subcode:
    invalidMedia.body?.error?.error_subcode ??
    null,
  is_transient:
    invalidMedia.body?.error?.is_transient ??
    null,
  error_message:
    invalidMedia.body?.error?.message ??
    null,
  expected_failure:
    !invalidMedia.ok,
};

printSection(
  "4 INVALID MEDIA URL",
  invalidMediaResult
);

// --------------------------------------------------
// 5. DUPLICATE EXECUTION
// --------------------------------------------------

const duplicateCaption =
  "Instagram Duplicate Execution Test 001";

const duplicate1 =
  await createWaitPublish(
    duplicateCaption
  );

const duplicate2 =
  await createWaitPublish(
    duplicateCaption
  );

const duplicateResult = {
  same_publish_job_id:
    "instagram-duplicate-test-001",
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

printSection(
  "5 DUPLICATE EXECUTION",
  duplicateResult
);

// --------------------------------------------------
// 6. IDEMPOTENCY GUARD
// --------------------------------------------------

const ledgerPath =
  path.resolve(
    "tmp",
    "instagram-publish-jobs.json"
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
  const ledger = readLedger();
  const existing =
    ledger[publishJobId];

  if (
    existing?.status === "SUCCESS"
  ) {
    return {
      publish_job_id:
        publishJobId,
      publish_status:
        "SKIPPED_DUPLICATE_GUARD",
      stored_status: "SUCCESS",
      container_id:
        existing.container_id ??
        null,
      platform_post_id:
        existing.platform_post_id ??
        null,
      automatic_retry: false,
    };
  }

  if (
    existing?.status === "PROCESSING"
  ) {
    return {
      publish_job_id:
        publishJobId,
      publish_status:
        "SKIPPED_AMBIGUOUS_JOB",
      stored_status:
        "PROCESSING",
      automatic_retry: false,
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

  const publish =
    await createWaitPublish(caption);

  const currentLedger =
    readLedger();

  if (publish.ok) {
    currentLedger[publishJobId] = {
      ...currentLedger[
        publishJobId
      ],
      status: "SUCCESS",
      container_id:
        publish.container_id,
      platform_post_id:
        publish.platform_post_id,
      updated_at:
        new Date().toISOString(),
    };

    writeLedger(currentLedger);

    return {
      publish_job_id:
        publishJobId,
      publish_status: "SUCCESS",
      container_id:
        publish.container_id,
      platform_post_id:
        publish.platform_post_id,
      automatic_retry: false,
    };
  }

  currentLedger[publishJobId] = {
    ...currentLedger[
      publishJobId
    ],
    status: "FAILED",
    last_result: publish,
    updated_at:
      new Date().toISOString(),
  };

  writeLedger(currentLedger);

  return {
    publish_job_id:
      publishJobId,
    publish_status: "FAILED",
    result: publish,
  };
}

const guardJobId =
  "instagram-idempotency-test-001";

const guardRun1 =
  await guardedPublish(
    guardJobId,
    "Instagram Idempotency Guard Test 001"
  );

const guardRun2 =
  await guardedPublish(
    guardJobId,
    "Instagram Idempotency Guard Test 001"
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

printSection(
  "6 IDEMPOTENCY GUARD",
  guardResult
);

// --------------------------------------------------
// 7. AMBIGUOUS NETWORK SIMULATION
// --------------------------------------------------

const networkLedgerPath =
  path.resolve(
    "tmp",
    "instagram-network-failure-jobs.json"
  );

const networkJobId =
  "instagram-network-failure-test-001";

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
    stage: "publish",
    created_at:
      new Date().toISOString(),
    platform_post_id: null,
  };

  writeNetworkLedger(ledger);

  return {
    publish_job_id:
      networkJobId,
    publish_status: "UNKNOWN",
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

printSection(
  "7 AMBIGUOUS NETWORK FAILURE",
  networkResult
);

// --------------------------------------------------
// FINAL SUMMARY
// --------------------------------------------------

const summary = {
  platform: "instagram",
  manual_image_publish:
    manualResult.publish_status,
  repeatable_image_publish:
    repeatable.ok
      ? "PASS"
      : "FAIL",
  invalid_credential:
    invalidCredentialResult.expected_failure
      ? "PASS"
      : "FAIL",
  invalid_media:
    invalidMediaResult.expected_failure
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

printSection(
  "FINAL API SUMMARY",
  summary
);

console.log(
  "\nBATCH COMPLETE — perform visual verification on Instagram."
);