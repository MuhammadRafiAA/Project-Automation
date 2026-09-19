import fs from "node:fs";

const token = process.env.TELEGRAM_BOT_TOKEN;

if (!token) {
  console.error("Missing TELEGRAM_BOT_TOKEN");
  process.exit(1);
}

const testId = "telegram-image-001";
const chatId = "@vickyprops";
const caption = "Property API Image Test 001";
const imagePath = "./assets/telegram-test.jpg";

const startedAt = Date.now();
const requestTime = new Date().toISOString();

try {
  if (!fs.existsSync(imagePath)) {
    throw new Error(`Image not found: ${imagePath}`);
  }

  const imageBuffer = fs.readFileSync(imagePath);

  const imageBlob = new Blob(
    [imageBuffer],
    { type: "image/jpeg" }
  );

  const form = new FormData();

  form.append("chat_id", chatId);
  form.append("caption", caption);
  form.append(
    "photo",
    imageBlob,
    "telegram-test.jpg"
  );

  const response = await fetch(
    `https://api.telegram.org/bot${token}/sendPhoto`,
    {
      method: "POST",
      body: form,
    }
  );

  const body = await response.json();

  const result = {
    platform: "telegram",
    test_id: testId,
    request_time: requestTime,
    content_type: "image",
    http_status: response.status,
    platform_post_id: body.result?.message_id ?? null,
    publish_status: body.ok ? "SUCCESS" : "FAILED",
    error_code: body.error_code ?? null,
    error_message: body.description ?? null,
    duration_ms: Date.now() - startedAt,
  };

  console.log(JSON.stringify(result, null, 2));

  if (!response.ok || !body.ok) {
    process.exitCode = 1;
  }
} catch (error) {
  console.error(
    JSON.stringify(
      {
        platform: "telegram",
        test_id: testId,
        request_time: requestTime,
        content_type: "image",
        http_status: null,
        platform_post_id: null,
        publish_status: "FAILED",
        error_code: null,
        error_message: error.message,
        duration_ms: Date.now() - startedAt,
      },
      null,
      2
    )
  );

  process.exitCode = 1;
}