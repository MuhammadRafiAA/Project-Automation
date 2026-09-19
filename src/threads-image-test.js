const token = process.env.THREADS_ACCESS_TOKEN;

if (!token) {
  console.error("Missing THREADS_ACCESS_TOKEN");
  process.exit(1);
}

const testId = "threads-image-script-001";

const imageUrl =
  "https://international-princess-survivors-forums.trycloudflare.com/media/threads-test.jpg";

const text =
  "Property Marketing AI OS - Threads Image Script Test 001";

const altText =
  "Test image for Threads API image publishing proof of concept";

const startedAt = Date.now();
const requestTime = new Date().toISOString();

let containerId = null;

try {
  const createParams = new URLSearchParams({
    media_type: "IMAGE",
    image_url: imageUrl,
    text,
    alt_text: altText,
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
    console.log(
      JSON.stringify(
        {
          platform: "threads",
          test_id: testId,
          request_time: requestTime,
          content_type: "image",
          error_stage: "container_creation",
          http_status: createResponse.status,
          container_id: null,
          platform_post_id: null,
          publish_status: "FAILED",
          error_code:
            createBody.error?.code ??
            createBody.error_code ??
            null,
          error_message:
            createBody.error?.message ??
            createBody.error_description ??
            null,
          duration_ms: Date.now() - startedAt,
        },
        null,
        2
      )
    );

    process.exit(1);
  }

  containerId = createBody.id;

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

  const result = {
    platform: "threads",
    test_id: testId,
    request_time: requestTime,
    content_type: "image",
    http_status: publishResponse.status,
    container_id: containerId,
    platform_post_id: publishBody.id ?? null,
    publish_status:
      publishResponse.ok && publishBody.id
        ? "SUCCESS"
        : "FAILED",
    error_stage:
      publishResponse.ok && publishBody.id
        ? null
        : "publish",
    error_code:
      publishBody.error?.code ??
      publishBody.error_code ??
      null,
    error_message:
      publishBody.error?.message ??
      publishBody.error_description ??
      null,
    duration_ms: Date.now() - startedAt,
  };

  console.log(JSON.stringify(result, null, 2));

  if (result.publish_status !== "SUCCESS") {
    process.exitCode = 1;
  }
} catch (error) {
  console.error(
    JSON.stringify(
      {
        platform: "threads",
        test_id: testId,
        request_time: requestTime,
        content_type: "image",
        http_status: null,
        container_id: containerId,
        platform_post_id: null,
        publish_status: "UNKNOWN",
        error_stage:
          containerId === null
            ? "container_creation_network"
            : "publish_network",
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