const TOKEN = process.env.INSTAGRAM_ACCESS_TOKEN;
const IG_USER_ID = process.env.INSTAGRAM_USER_ID;

const IMAGE_1 = process.env.INSTAGRAM_TEST_IMAGE_URL;

const IMAGE_2 =
  process.env.INSTAGRAM_TEST_IMAGE_URL_2 ||
  (IMAGE_1 ? `${IMAGE_1}?slide=2` : null);

const STORY_IMAGE =
  process.env.INSTAGRAM_STORY_IMAGE_URL ||
  IMAGE_1;

const BASE = "https://graph.instagram.com";

if (
  !TOKEN ||
  !IG_USER_ID ||
  !IMAGE_1 ||
  !IMAGE_2 ||
  !STORY_IMAGE
) {
  console.error("Missing required Instagram environment variables.");
  process.exit(1);
}

const sleep = (ms) =>
  new Promise((resolve) => setTimeout(resolve, ms));

function section(name, data) {
  console.log(`\n===== ${name} =====`);
  console.log(JSON.stringify(data, null, 2));
}

async function requestJson(url, options = {}) {
  const startedAt = Date.now();

  try {
    const response = await fetch(url, {
      ...options,
      headers: {
        ...(options.headers ?? {}),
        Authorization: `Bearer ${TOKEN}`,
      },
    });

    let body = null;

    try {
      body = await response.json();
    } catch {}

    return {
      response_received: true,
      ok: response.ok,
      http_status: response.status,
      body,
      duration_ms: Date.now() - startedAt,
    };
  } catch (error) {
    return {
      response_received: false,
      ok: false,
      http_status: null,
      body: null,
      network_error: error.message,
      duration_ms: Date.now() - startedAt,
    };
  }
}

async function preflight(url) {
  try {
    const response = await fetch(url, {
      method: "HEAD",
    });

    return {
      url,
      http_status: response.status,
      content_type:
        response.headers.get("content-type"),
      content_length:
        response.headers.get("content-length"),
      pass:
        response.ok &&
        response.headers
          .get("content-type")
          ?.startsWith("image/"),
    };
  } catch (error) {
    return {
      url,
      pass: false,
      error: error.message,
    };
  }
}

async function getStatus(containerId) {
  return requestJson(
    `${BASE}/${containerId}?fields=status_code,status`
  );
}

async function waitUntilFinished(containerId) {
  for (let attempt = 1; attempt <= 20; attempt++) {
    const result = await getStatus(containerId);

    const code =
      result.body?.status_code ?? null;

    if (code === "FINISHED") {
      return {
        ready: true,
        attempt,
        result,
      };
    }

    if (
      code === "ERROR" ||
      code === "EXPIRED"
    ) {
      return {
        ready: false,
        attempt,
        result,
      };
    }

    await sleep(2000);
  }

  return {
    ready: false,
    timeout: true,
  };
}

async function publishContainer(containerId) {
  const params = new URLSearchParams({
    creation_id: containerId,
  });

  for (let attempt = 1; attempt <= 3; attempt++) {
    const result = await requestJson(
      `${BASE}/${IG_USER_ID}/media_publish?${params}`,
      { method: "POST" }
    );

    if (result.ok && result.body?.id) {
      return {
        ok: true,
        attempt,
        http_status: result.http_status,
        platform_post_id: result.body.id,
      };
    }

    // We observed this readiness race during our previous PoC.
    const code = result.body?.error?.code;
    const subcode =
      result.body?.error?.error_subcode;

    if (
      code === 9007 &&
      subcode === 2207027 &&
      attempt < 3
    ) {
      await sleep(5000 * attempt);
      continue;
    }

    return {
      ok: false,
      attempt,
      http_status: result.http_status,
      error_code: code ?? null,
      error_subcode: subcode ?? null,
      error_message:
        result.body?.error?.message ??
        result.network_error ??
        null,
    };
  }
}

// ==================================================
// 0. PREFLIGHT
// ==================================================

const preflights = [
  await preflight(IMAGE_1),
  await preflight(IMAGE_2),
  await preflight(STORY_IMAGE),
];

section("0 MEDIA PREFLIGHT", preflights);

if (preflights.some((x) => !x.pass)) {
  console.error("STOP: at least one public media URL is unhealthy.");
  process.exit(1);
}

// ==================================================
// 1. INSTAGRAM CAROUSEL
// ==================================================

async function createCarouselChild(imageUrl) {
  const params = new URLSearchParams({
    image_url: imageUrl,
    is_carousel_item: "true",
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

const child1 =
  await createCarouselChild(IMAGE_1);

const child2 =
  await createCarouselChild(IMAGE_2);

section("1 CAROUSEL CHILD CONTAINERS", {
  child_1: {
    http_status: child1.http_status,
    container_id: child1.container_id,
    error: child1.body?.error ?? null,
  },
  child_2: {
    http_status: child2.http_status,
    container_id: child2.container_id,
    error: child2.body?.error ?? null,
  },
});

let carouselResult = {
  status: "NOT_RUN",
};

if (
  child1.container_id &&
  child2.container_id
) {
  const child1Ready =
    await waitUntilFinished(
      child1.container_id
    );

  const child2Ready =
    await waitUntilFinished(
      child2.container_id
    );

  section("2 CAROUSEL CHILD STATUS", {
    child_1_ready: child1Ready,
    child_2_ready: child2Ready,
  });

  if (
    child1Ready.ready &&
    child2Ready.ready
  ) {
    const parentParams =
      new URLSearchParams({
        media_type: "CAROUSEL",
        children: [
          child1.container_id,
          child2.container_id,
        ].join(","),
        caption:
          "Property Marketing AI OS - Instagram Carousel Test 001",
      });

    const parent =
      await requestJson(
        `${BASE}/${IG_USER_ID}/media?${parentParams}`,
        { method: "POST" }
      );

    const parentId =
      parent.body?.id ?? null;

    section("3 CAROUSEL PARENT", {
      http_status:
        parent.http_status,
      container_id: parentId,
      error:
        parent.body?.error ?? null,
    });

    if (parentId) {
      const parentReady =
        await waitUntilFinished(
          parentId
        );

      section(
        "4 CAROUSEL PARENT STATUS",
        parentReady
      );

      if (parentReady.ready) {
        const published =
          await publishContainer(
            parentId
          );

        carouselResult = {
          status:
            published.ok
              ? "PASS"
              : "FAIL",
          parent_container_id:
            parentId,
          ...published,
        };
      } else {
        carouselResult = {
          status: "FAIL",
          stage:
            "parent_processing",
          parent_container_id:
            parentId,
        };
      }
    }
  }
}

section(
  "5 CAROUSEL FINAL",
  carouselResult
);

// ==================================================
// 2. INSTAGRAM STORY
// ==================================================

const storyParams =
  new URLSearchParams({
    media_type: "STORIES",
    image_url: STORY_IMAGE,
  });

const storyContainer =
  await requestJson(
    `${BASE}/${IG_USER_ID}/media?${storyParams}`,
    { method: "POST" }
  );

const storyContainerId =
  storyContainer.body?.id ?? null;

section("6 STORY CONTAINER", {
  http_status:
    storyContainer.http_status,
  container_id:
    storyContainerId,
  error:
    storyContainer.body?.error ??
    null,
});

let storyResult = {
  status: "NOT_RUN",
};

if (storyContainerId) {
  const storyReady =
    await waitUntilFinished(
      storyContainerId
    );

  section(
    "7 STORY CONTAINER STATUS",
    storyReady
  );

  if (storyReady.ready) {
    const published =
      await publishContainer(
        storyContainerId
      );

    storyResult = {
      status:
        published.ok
          ? "PASS"
          : "FAIL",
      container_id:
        storyContainerId,
      ...published,
    };
  } else {
    storyResult = {
      status: "FAIL",
      stage:
        "story_processing",
      container_id:
        storyContainerId,
    };
  }
}

section(
  "8 STORY FINAL",
  storyResult
);

// ==================================================
// FINAL SUMMARY
// ==================================================

section("FINAL SUMMARY", {
  platform: "instagram",
  carousel:
    carouselResult.status,
  story:
    storyResult.status,
});

console.log(
  "\nTEST COMPLETE — perform one visual check on Instagram."
);