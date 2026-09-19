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

const videoPath = path.resolve(
  "assets",
  "youtube-shorts-test.mp4"
);

fs.mkdirSync("assets", {
  recursive: true,
});

function createVerticalTestVideo() {
  return new Promise((resolve, reject) => {
    const ffmpeg = spawn(
      ffmpegPath,
      [
        "-f",
        "lavfi",
        "-i",
        "testsrc=size=1080x1920:rate=30",

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
  const raw = JSON.parse(
    fs.readFileSync(
      credentialsPath,
      "utf8"
    )
  );

  const cfg =
    raw.installed ??
    raw.web;

  const token = JSON.parse(
    fs.readFileSync(
      tokenPath,
      "utf8"
    )
  );

  const client =
    new google.auth.OAuth2(
      cfg.client_id,
      cfg.client_secret,
      cfg.redirect_uris?.[0]
    );

  client.setCredentials(token);

  client.on("tokens", (tokens) => {
    const current = JSON.parse(
      fs.readFileSync(
        tokenPath,
        "utf8"
      )
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

try {
  console.log(
    "\n===== 0 CREATE VERTICAL SHORT ====="
  );

  await createVerticalTestVideo();

  const stat =
    fs.statSync(videoPath);

  console.log(
    JSON.stringify(
      {
        file:
          "assets/youtube-shorts-test.mp4",
        width: 1080,
        height: 1920,
        aspect_ratio: "9:16",
        duration_seconds: 5,
        size_bytes:
          stat.size,
      },
      null,
      2
    )
  );

  console.log(
    "\n===== 1 UPLOAD SHORT ====="
  );

  const auth =
    loadOAuthClient();

  const youtube =
    google.youtube({
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

      notifySubscribers: false,

      requestBody: {
        snippet: {
          title:
            "Property Marketing AI OS - YouTube Shorts API Test 001",

          description:
            "Vertical 9:16 YouTube Shorts publishing API proof of concept.",
        },

        status: {
          privacyStatus:
            "public",

          selfDeclaredMadeForKids:
            false,
        },
      },

      media: {
        mimeType:
          "video/mp4",

        body:
          fs.createReadStream(
            videoPath
          ),
      },
    });

  console.log(
    JSON.stringify(
      {
        platform:
          "youtube",

        test_id:
          "youtube-shorts-test-001",

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

        expected_classification:
          "SHORT",

        publish_status:
          response.data.id
            ? "SUCCESS"
            : "FAILED",

        duration_ms:
          Date.now() -
          startedAt,
      },
      null,
      2
    )
  );
} catch (error) {
  console.error(
    JSON.stringify(
      {
        platform:
          "youtube",

        test_id:
          "youtube-shorts-test-001",

        publish_status:
          "FAILED",

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
      },
      null,
      2
    )
  );

  process.exitCode = 1;
}