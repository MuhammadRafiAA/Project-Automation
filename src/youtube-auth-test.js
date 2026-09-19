import fs from "node:fs";
import path from "node:path";
import { authenticate } from "@google-cloud/local-auth";

const credentialsPath = path.resolve(
  "secrets",
  "youtube-oauth-client.json"
);

const tokenPath = path.resolve(
  "secrets",
  "youtube-token.json"
);

const scopes = [
  "https://www.googleapis.com/auth/youtube.upload",
];

if (!fs.existsSync(credentialsPath)) {
  console.error(
    "Missing secrets/youtube-oauth-client.json"
  );
  process.exit(1);
}

try {
  const auth = await authenticate({
    scopes,
    keyfilePath: credentialsPath,
  });

  fs.writeFileSync(
    tokenPath,
    JSON.stringify(auth.credentials, null, 2)
  );

  console.log(
    JSON.stringify(
      {
        platform: "youtube",
        test: "oauth-authentication",
        authentication: "SUCCESS",
        access_token_received:
          Boolean(auth.credentials.access_token),
        refresh_token_received:
          Boolean(auth.credentials.refresh_token),
        token_type:
          auth.credentials.token_type ?? null,
        expiry_date:
          auth.credentials.expiry_date ?? null,
        token_saved_to:
          "secrets/youtube-token.json",
        requested_scope:
          "youtube.upload",
      },
      null,
      2
    )
  );
} catch (error) {
  console.error(
    JSON.stringify(
      {
        platform: "youtube",
        test: "oauth-authentication",
        authentication: "FAILED",
        error_name:
          error.name ?? null,
        error_message:
          error.message ?? String(error),
      },
      null,
      2
    )
  );

  process.exitCode = 1;
}