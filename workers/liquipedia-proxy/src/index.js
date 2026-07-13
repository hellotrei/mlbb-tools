// Liquipedia API Proxy Worker
// Forwards requests to Liquipedia Mobile Legends API to bypass IP rate limiting.
// Used by MLBB Draft Arena API container.

const LIQUIPEDIA_API = "https://liquipedia.net/mobilelegends/api.php";

export default {
  async fetch(request, env, ctx) {
    // CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, x-proxy-token",
          "Access-Control-Max-Age": "86400",
        },
      });
    }

    if (request.method !== "GET") {
      return new Response("Method not allowed", { status: 405 });
    }

    // Optional: validate proxy token to prevent abuse
    const proxyToken = request.headers.get("x-proxy-token");
    if (env.PROXY_TOKEN && proxyToken !== env.PROXY_TOKEN) {
      return new Response("Unauthorized", { status: 401 });
    }

    try {
      const incomingUrl = new URL(request.url);
      const targetUrl = new URL(LIQUIPEDIA_API);

      // Forward only safe Liquipedia API params
      const allowedParams = ["action", "page", "prop", "format", "titles", "pageids", "redirects"];
      for (const key of allowedParams) {
        const value = incomingUrl.searchParams.get(key);
        if (value) targetUrl.searchParams.set(key, value);
      }

      // Validate: action must be parse or query
      const action = targetUrl.searchParams.get("action");
      if (!action || !["parse", "query"].includes(action)) {
        return new Response(JSON.stringify({ error: "Invalid or missing action param" }), {
          status: 400,
          headers: { "content-type": "application/json" },
        });
      }

      // Fetch from Liquipedia with required headers
      const response = await fetch(targetUrl.toString(), {
        headers: {
          accept: "application/json, text/javascript, */*; q=0.01",
          "accept-encoding": "gzip",
          "user-agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 DraftArenaBot/1.0 (+https://mlbbdraftarena.vercel.app)",
        },
      });

      // Forward status + body + content-type from Liquipedia
      const body = await response.arrayBuffer();
      return new Response(body, {
        status: response.status,
        headers: {
          "content-type": response.headers.get("content-type") || "application/json",
          "access-control-allow-origin": "*",
          "cache-control": "public, max-age=300",
        },
      });
    } catch (err) {
      return new Response(
        JSON.stringify({ error: `Proxy error: ${err.message}` }),
        { status: 502, headers: { "content-type": "application/json", "access-control-allow-origin": "*" } }
      );
    }
  },
};
