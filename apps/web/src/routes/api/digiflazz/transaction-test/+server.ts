import { env } from "$env/dynamic/private";
import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";

const DIGIFLAZZ_URL = "https://api.digiflazz.com/v1/transaction";

export const POST: RequestHandler = async () => {
  const username = (env.DIGIFLAZZ_USERNAME ?? "").trim();
  const buyerSkuCode = (env.DIGIFLAZZ_TEST_BUYER_SKU_CODE ?? "").trim();
  const customerNo = (env.DIGIFLAZZ_TEST_CUSTOMER_NO ?? "").trim();
  const refId = (env.DIGIFLAZZ_TEST_REF_ID ?? "").trim();
  const sign = (env.DIGIFLAZZ_TEST_SIGN ?? "").trim();

  const missing: string[] = [];
  if (!username) missing.push("DIGIFLAZZ_USERNAME");
  if (!buyerSkuCode) missing.push("DIGIFLAZZ_TEST_BUYER_SKU_CODE");
  if (!customerNo) missing.push("DIGIFLAZZ_TEST_CUSTOMER_NO");
  if (!refId) missing.push("DIGIFLAZZ_TEST_REF_ID");
  if (!sign) missing.push("DIGIFLAZZ_TEST_SIGN");

  if (missing.length > 0) {
    return json({ error: `Missing required env: ${missing.join(", ")}` }, { status: 500 });
  }

  const body = {
    username,
    buyer_sku_code: buyerSkuCode,
    customer_no: customerNo,
    ref_id: refId,
    sign
  };

  try {
    const upstream = await fetch(DIGIFLAZZ_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body)
    });

    const text = await upstream.text();
    let data: unknown = { raw: text };
    try {
      data = JSON.parse(text);
    } catch {
      // keep raw fallback when Digiflazz response is not JSON
    }

    return json({ data }, { status: upstream.status });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown Digiflazz request error.";
    return json({ error: message }, { status: 502 });
  }
};
