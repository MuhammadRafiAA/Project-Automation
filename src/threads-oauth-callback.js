import http from "node:http";
import fs from "node:fs";

const PORT = 3000;

const server = http.createServer((req, res) => {
  const url = new URL(
    req.url,
    `http://${req.headers.host}`
  );

  if (url.pathname === "/threads/callback") {
    console.log(
      JSON.stringify(
        {
          event: "THREADS_OAUTH_CALLBACK",
          code_received: url.searchParams.has("code"),
          error_received: url.searchParams.has("error"),
        },
        null,
        2
      )
    );

    res.writeHead(200, {
      "Content-Type": "text/plain; charset=utf-8",
    });

    res.end(
      "Threads OAuth callback received. You may close this tab."
    );

    return;
  }

  if (url.pathname === "/threads/deauthorize") {
    console.log(
      JSON.stringify(
        {
          event: "THREADS_DEAUTHORIZE_CALLBACK",
          development_stub: true,
        },
        null,
        2
      )
    );

    res.writeHead(200, {
      "Content-Type": "text/plain; charset=utf-8",
    });

    res.end("Threads deauthorization callback endpoint is reachable.");

    return;
  }

  if (url.pathname === "/threads/delete") {
    console.log(
      JSON.stringify(
        {
          event: "THREADS_DATA_DELETION_CALLBACK",
          development_stub: true,
        },
        null,
        2
      )
    );

    res.writeHead(200, {
      "Content-Type": "application/json",
    });

    res.end(
      JSON.stringify({
        status: "development_stub",
      })
    );

    return;
  }

  if (url.pathname === "/media/threads-test.jpg") {
  const image = fs.readFileSync(
    "./assets/telegram-test.jpg"
  );

  res.writeHead(200, {
    "Content-Type": "image/jpeg",
    "Content-Length": image.length,
    "Cache-Control": "no-store",
  });

  res.end(image);
  return;
}

  res.writeHead(404, {
    "Content-Type": "text/plain; charset=utf-8",
  });

  res.end("Not Found");
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`Threads callback server listening on port ${PORT}`);
});