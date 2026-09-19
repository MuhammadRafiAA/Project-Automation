const token = process.env.TELEGRAM_BOT_TOKEN;

if (!token) {
  console.error("Missing TELEGRAM_BOT_TOKEN");
  process.exit(1);
}

const chatId = "@vickyprops";
const text = "Telegram Duplicate Execution Test 001";
const publishJobId = "duplicate-test-001";

async function publish(attempt) {
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

  return {
    publish_job_id: publishJobId,
    attempt,
    http_status: response.status,
    ok: body.ok ?? false,
    message_id: body.result?.message_id ?? null,
    error_code: body.error_code ?? null,
    error_message: body.description ?? null,
  };
}

const first = await publish(1);
const second = await publish(2);

console.log(
  JSON.stringify(
    {
      test: "telegram-duplicate-execution",
      same_publish_job_id: publishJobId,
      same_payload: true,
      attempts: [first, second],
      duplicate_created:
        first.ok &&
        second.ok &&
        first.message_id !== second.message_id,
    },
    null,
    2
  )
);