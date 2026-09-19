import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import ffmpegPath from "ffmpeg-static";
import { google } from "googleapis";

const credentialsPath = path.resolve(
  "secrets",
  "youtube-oauth-client.json"
);

const tokenPath = path.resolve(
  "secrets",
  "youtube-token.json"
);

const assetsDir = path.resolve("assets");
const videoPath = path.resolve(
  "assets",
  "youtube-test.mp4"
);

if (!fs.existsSync(credentialsPath)) {
  console.error("Missing secrets/youtube-oauth-client.json");
  process.exit(1);
}

if (!fs.existsSync(tokenPath)) {
  console.error("Missing secrets/youtube-token.json");
  process.exit(1);
}

fs.mkdirSync(assetsDir, {
  recursive: true,
});

function createTestVideo() {
  return new Promise((resolve, reject) => {
    if (fs.existsSync(videoPath)) {
      return resolve();
    }

    const ffmpeg = spawn(
      ffmpegPath,
      [
        "-f",
        "lavfi",
        "-i",
        "testsrc=size=640x360:rate=30",
        "-t",
        "5",
        "-pix_fmt",
        "yuv420p",
        "-y",
        videoPath,
      ],
      {
        stdio: "ignore",
      }
    );

    ffmpeg.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(
          new Error(
            `FFmpeg exited with code ${code}`
          )
        );
      }
    });

    ffmpeg.on("error", reject);
  });
}

function loadOAuthClient() {
  const rawCredentials = JSON.parse(
    fs.readFileSync(
      credentialsPath,
      "utf8"
    )
  );

  const credentials =
    rawCredentials.installed ??
    rawCredentials.web;

  if (!credentials) {
    throw new Error(
      "Invalid OAuth client JSON"
    );
  }

  const token = JSON.parse(
    fs.readFileSync(
      tokenPath,
      "utf8"
    )
  );

  const oauth2Client =
    new google.auth.OAuth2(
      credentials.client_id,
      credentials.client_secret,
      credentials.redirect_uris?.[0]
    );

  oauth2Client.setCredentials(token);

  return oauth2Client;
}

try {
  console.log(
    "\n===== 0 CREATE TEST VIDEO ====="
  );

  await createTestVideo();

  const stat = fs.statSync(videoPath);

  console.log(
    JSON.stringify(
      {
        file:
          "assets/youtube-test.mp4",
        exists: true,
        size_bytes: stat.size,
      },
      null,
      2
    )
  );

  console.log(
    "\n===== 1 YOUTUBE UPLOAD ====="
  );

  const auth = loadOAuthClient();

  const youtube = google.youtube({
    version: "v3",
    auth,
  });

  const startedAt = Date.now();

  const response =
    await youtube.videos.insert({
      part: [
        "snippet",
        "status",
      ],

      requestBody: {
        snippet: {
          title:
            "Property Marketing AI OS - YouTube API Test 001",

          description:
            "Automated YouTube Data API upload proof of concept.",

          categoryId: "22",
        },

        status: {
          privacyStatus: "private",
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

  console.log(
    JSON.stringify(
      {
        platform: "youtube",
        test_id:
          "youtube-upload-test-001",
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
        publish_status:
          response.data.id
            ? "SUCCESS"
            : "FAILED",
        duration_ms:
          Date.now() - startedAt,
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
        test_id:
          "youtube-upload-test-001",
        publish_status:
          "FAILED",
        error_name:
          error.name ?? null,
        error_code:
          error.code ?? null,
        error_message:
          error.message ??
          String(error),
      },
      null,
      2
    )
  );

  process.exitCode = 1;
}