import fs from "node:fs";
import path from "node:path";
import { google } from "googleapis";

const credentialsPath = path.resolve(
  "secrets",
  "youtube-oauth-client.json"
);

const tokenPath = path.resolve(
  "secrets",
  "youtube-token.json"
);

const videoPath = path.resolve(
  "assets",
  "youtube-test.mp4"
);

const ledgerPath = path.resolve(
  "tmp",
  "youtube-publish-jobs.json"
);

const networkLedgerPath = path.resolve(
  "tmp",
  "youtube-network-failure-jobs.json"
);

if (!fs.existsSync(credentialsPath)) {
  console.error("Missing OAuth client JSON");
  process.exit(1);
}

if (!fs.existsSync(tokenPath)) {
  console.error("Missing YouTube token");
  process.exit(1);
}

if (!fs.existsSync(videoPath)) {
  console.error("Missing assets/youtube-test.mp4");
  process.exit(1);
}

fs.mkdirSync("tmp", {
  recursive: true,
});

function section(name, data) {
  console.log(`\n===== ${name} =====`);
  console.log(JSON.stringify(data, null, 2));
}

function loadClient(useInvalidToken = false) {
  const raw = JSON.parse(
    fs.readFileSync(credentialsPath, "utf8")
  );

  const cfg =
    raw.installed ??
    raw.web;

  const client = new google.auth.OAuth2(
    cfg.client_id,
    cfg.client_secret,
    cfg.redirect_uris?.[0]
  );

  if (useInvalidToken) {
    client.setCredentials({
      access_token:
        "INVALID_YOUTUBE_ACCESS_TOKEN_FOR_POC",
    });

    return client;
  }

  const token = JSON.parse(
    fs.readFileSync(tokenPath, "utf8")
  );

  client.setCredentials(token);

  client.on("tokens", (tokens) => {
    const current = JSON.parse(
      fs.readFileSync(tokenPath, "utf8")
    );

    fs.writeFileSync(
      tokenPath,
      JSON.stringify(
        {
          ...current,
          ...tokens,
          refresh_token:
            tokens.refresh_token ??
            current.refresh_token,
        },
        null,
        2
      )
    );
  });

  return client;
}

async function uploadVideo({
  title,
  privacyStatus = "private",
  auth,
}) {
  const youtube = google.youtube({
    version: "v3",
    auth,
  });

  const startedAt = Date.now();

  try {
    const response =
      await youtube.videos.insert({
        part: [
          "snippet",
          "status",
        ],

        notifySubscribers: false,

        requestBody: {
          snippet: {
            title,

            description:
              "Property Marketing AI OS YouTube API proof of concept.",
          },

          status: {
            privacyStatus,
            selfDeclaredMadeForKids: false,
          },
        },

        media: {
          mimeType: "video/mp4",
          body:
            fs.createReadStream(
              videoPath
            ),
        },
      });

    return {
      response_received: true,
      ok: true,
      http_status:
        response.status,
      video_id:
        response.data.id ??
        null,
      title:
        response.data.snippet
          ?.title ?? null,
      privacy_status:
        response.data.status
          ?.privacyStatus ?? null,
      duration_ms:
        Date.now() - startedAt,
    };
  } catch (error) {
    return {
      response_received: true,
      ok: false,
      http_status:
        error.response?.status ??
        error.code ??
        null,
      video_id: null,
      error_code:
        error.response?.data
          ?.error?.code ??
        error.code ??
        null,
      error_message:
        error.response?.data
          ?.error?.message ??
        error.message ??
        String(error),
      duration_ms:
        Date.now() - startedAt,
    };
  }
}

const auth = loadClient();

// ==================================================
// 1. INVALID CREDENTIAL
// ==================================================

const invalidAuth =
  loadClient(true);

const invalidCredential =
  await uploadVideo({
    title:
      "YouTube Invalid Credential Test 001",
    privacyStatus: "private",
    auth: invalidAuth,
  });

section(
  "1 INVALID CREDENTIAL",
  {
    ...invalidCredential,
    expected_failure:
      !invalidCredential.ok,
  }
);

// ==================================================
// 2. VALIDATION FAILURE
// ==================================================

const invalidRequest =
  await uploadVideo({
    title:
      "YouTube Invalid Request Test 001",
    privacyStatus:
      "THIS_IS_NOT_VALID",
    auth,
  });

section(
  "2 INVALID REQUEST",
  {
    ...invalidRequest,
    expected_failure:
      !invalidRequest.ok,
  }
);

// ==================================================
// 3. PUBLIC VISIBILITY ATTEMPT
// ==================================================

const publicAttempt =
  await uploadVideo({
    title:
      "Property Marketing AI OS - YouTube Public Attempt Test 001",
    privacyStatus:
      "public",
    auth,
  });

section(
  "3 PUBLIC VISIBILITY ATTEMPT",
  publicAttempt
);

// ==================================================
// 4. DUPLICATE EXECUTION
// ==================================================

const duplicateTitle =
  "YouTube Duplicate Execution Test 001";

const duplicate1 =
  await uploadVideo({
    title:
      duplicateTitle,
    privacyStatus:
      "private",
    auth,
  });

const duplicate2 =
  await uploadVideo({
    title:
      duplicateTitle,
    privacyStatus:
      "private",
    auth,
  });

const duplicateResult = {
  same_publish_job_id:
    "youtube-duplicate-test-001",

  same_payload: true,

  attempts: [
    duplicate1,
    duplicate2,
  ],

  duplicate_created:
    duplicate1.ok &&
    duplicate2.ok &&
    duplicate1.video_id !==
      duplicate2.video_id,
};

section(
  "4 DUPLICATE EXECUTION",
  duplicateResult
);

// ==================================================
// 5. IDEMPOTENCY GUARD
// ==================================================

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

async function guardedUpload(
  publishJobId,
  title
) {
  let ledger =
    readLedger();

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

      video_id:
        existing.video_id ??
        null,

      automatic_retry:
        false,
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

      automatic_retry:
        false,

      action_required:
        "RECONCILIATION_OR_MANUAL_REVIEW",
    };
  }

  ledger[publishJobId] = {
    status:
      "PROCESSING",

    created_at:
      new Date().toISOString(),

    video_id:
      null,
  };

  writeLedger(ledger);

  const result =
    await uploadVideo({
      title,
      privacyStatus:
        "private",
      auth,
    });

  ledger =
    readLedger();

  if (result.ok) {
    ledger[publishJobId] = {
      ...ledger[publishJobId],

      status:
        "SUCCESS",

      video_id:
        result.video_id,

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

      video_id:
        result.video_id,

      automatic_retry:
        false,
    };
  }

  ledger[publishJobId] = {
    ...ledger[publishJobId],

    status:
      "FAILED",

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
      "FAILED",

    http_status:
      result.http_status,

    error_message:
      result.error_message,
  };
}

const guardJobId =
  "youtube-idempotency-test-001";

const guardTitle =
  "YouTube Idempotency Guard Test 001";

const guardRun1 =
  await guardedUpload(
    guardJobId,
    guardTitle
  );

const guardRun2 =
  await guardedUpload(
    guardJobId,
    guardTitle
  );

const guardResult = {
  run_1:
    guardRun1,

  run_2:
    guardRun2,

  guard_pass:
    guardRun1.publish_status ===
      "SUCCESS" &&
    guardRun2.publish_status ===
      "SKIPPED_DUPLICATE_GUARD",
};

section(
  "5 IDEMPOTENCY GUARD",
  guardResult
);

// ==================================================
// 6. AMBIGUOUS NETWORK SIMULATION
// ==================================================

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

const networkJobId =
  "youtube-network-failure-test-001";

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

      automatic_retry:
        false,

      action_required:
        "RECONCILIATION_OR_MANUAL_REVIEW",
    };
  }

  ledger[networkJobId] = {
    status:
      "PROCESSING",

    stage:
      "upload",

    created_at:
      new Date().toISOString(),

    video_id:
      null,
  };

  writeNetworkLedger(ledger);

  return {
    publish_job_id:
      networkJobId,

    publish_status:
      "UNKNOWN",

    stored_status:
      "PROCESSING",

    error_stage:
      "upload_network",

    error_message:
      "SIMULATED_NETWORK_FAILURE_AFTER_DISPATCH",

    automatic_retry:
      false,

    action_required:
      "RECONCILIATION_OR_MANUAL_REVIEW",
  };
}

const networkRun1 =
  simulatedNetworkRun();

const networkRun2 =
  simulatedNetworkRun();

const networkResult = {
  run_1:
    networkRun1,

  run_2:
    networkRun2,

  ambiguity_guard_pass:
    networkRun1.publish_status ===
      "UNKNOWN" &&
    networkRun2.publish_status ===
      "SKIPPED_AMBIGUOUS_JOB",
};

section(
  "6 AMBIGUOUS NETWORK FAILURE",
  networkResult
);

// ==================================================
// FINAL SUMMARY
// ==================================================

section(
  "FINAL YOUTUBE SUMMARY",
  {
    invalid_credential:
      !invalidCredential.ok
        ? "PASS"
        : "FAIL",

    invalid_request:
      !invalidRequest.ok
        ? "PASS"
        : "FAIL",

    public_attempt_api_result:
      publicAttempt.ok
        ? "UPLOAD_SUCCESS"
        : "UPLOAD_FAILED",

    public_attempt_returned_visibility:
      publicAttempt
        .privacy_status ??
      null,

    duplicate_risk:
      duplicateResult
        .duplicate_created
        ? "CONFIRMED"
        : "NOT_CONFIRMED",

    idempotency_guard:
      guardResult
        .guard_pass
        ? "PASS"
        : "FAIL",

    ambiguous_network_guard:
      networkResult
        .ambiguity_guard_pass
        ? "PASS"
        : "FAIL",
  }
);

console.log(
  "\nBATCH COMPLETE — verify videos in YouTube Studio."
);