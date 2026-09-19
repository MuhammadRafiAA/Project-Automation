const token = process.env.FACEBOOK_PAGE_ACCESS_TOKEN;
const pageId = process.env.FACEBOOK_PAGE_ID;
const imageUrl = process.env.FACEBOOK_TEST_IMAGE_URL;

const graphVersion = "v26.0";
const base = `https://graph.facebook.com/${graphVersion}`;

if (!token || !pageId || !imageUrl) {
  console.error(
    "Missing FACEBOOK_PAGE_ACCESS_TOKEN, FACEBOOK_PAGE_ID, or FACEBOOK_TEST_IMAGE_URL"
  );
  process.exit(1);
}

async function graphPost(path, params) {
  const startedAt = Date.now();

  try {
    const response = await fetch(`${base}/${path}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams(params),
    });

    const body = await response.json();

    return {
      ok: response.ok,
      http_status: response.status,
      body,
      duration_ms: Date.now() - startedAt,
    };
  } catch (error) {
    return {
      ok: false,
      http_status: null,
      body: null,
      network_error: error.message,
      duration_ms: Date.now() - startedAt,
    };
  }
}

// ==============================
// TEXT TEST
// ==============================

const textResult = await graphPost(
  `${pageId}/feed`,
  {
    message:
      "Property Marketing AI OS - Facebook Script Text Test 001",
  }
);

console.log(
  "\n===== FACEBOOK TEXT ====="
);

console.log(
  JSON.stringify(
    {
      platform: "facebook",
      content_type: "text",
      http_status: textResult.http_status,
      platform_post_id:
        textResult.body?.id ?? null,
      publish_status:
        textResult.ok && textResult.body?.id
          ? "SUCCESS"
          : "FAILED",
      error_code:
        textResult.body?.error?.code ?? null,
      error_message:
        textResult.body?.error?.message ?? null,
      duration_ms: textResult.duration_ms,
    },
    null,
    2
  )
);

// ==============================
// IMAGE TEST
// ==============================

const imageResult = await graphPost(
  `${pageId}/photos`,
  {
    url: imageUrl,
    caption:
      "Property Marketing AI OS - Facebook Script Image Test 001",
  }
);

console.log(
  "\n===== FACEBOOK IMAGE ====="
);

console.log(
  JSON.stringify(
    {
      platform: "facebook",
      content_type: "image",
      http_status: imageResult.http_status,
      platform_post_id:
        imageResult.body?.post_id ??
        imageResult.body?.id ??
        null,
      media_id:
        imageResult.body?.id ?? null,
      publish_status:
        imageResult.ok && imageResult.body?.id
          ? "SUCCESS"
          : "FAILED",
      error_code:
        imageResult.body?.error?.code ?? null,
      error_message:
        imageResult.body?.error?.message ?? null,
      duration_ms: imageResult.duration_ms,
    },
    null,
    2
  )
);