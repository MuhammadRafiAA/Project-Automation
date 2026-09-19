const token = process.env.THREADS_ACCESS_TOKEN;

if (!token) {
  console.error("Missing THREADS_ACCESS_TOKEN");
  process.exit(1);
}

const publishJobId = "threads-duplicate-test-001";
const text = "Threads Duplicate Execution Test 001";

async function publish(attempt) {
  const createParams = new URLSearchParams({
    media_type: "TEXT",
    text,
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
    return {
      publish_job_id: publishJobId,
      attempt,
      stage: "container_creation",
      http_status: createResponse.status,
      ok: false,
      container_id: null,
      post_id: null,
      error_code: createBody.error?.code ?? null,
      error_message: createBody.error?.message ?? null,
    };
  }

  const containerId = createBody.id;

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

  return {
    publish_job_id: publishJobId,
    attempt,
    stage: "publish",
    http_status: publishResponse.status,
    ok: publishResponse.ok && Boolean(publishBody.id),
    container_id: containerId,
    post_id: publishBody.id ?? null,
    error_code: publishBody.error?.code ?? null,
    error_message: publishBody.error?.message ?? null,
  };
}

const first = await publish(1);
const second = await publish(2);

console.log(
  JSON.stringify(
    {
      test: "threads-duplicate-execution",
      same_publish_job_id: publishJobId,
      same_payload: true,
      attempts: [first, second],
      duplicate_created:
        first.ok &&
        second.ok &&
        first.post_id !== second.post_id,
    },
    null,
    2
  )
);