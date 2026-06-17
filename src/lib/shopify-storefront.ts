import {
  SHOPIFY_STOREFRONT_TOKEN,
  SHOPIFY_STOREFRONT_URL,
} from "./shopify-config";

export async function storefrontApiRequest<T = any>(
  query: string,
  variables: Record<string, any> = {},
): Promise<{ data: T } | null> {
  const response = await fetch(SHOPIFY_STOREFRONT_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Storefront-Access-Token": SHOPIFY_STOREFRONT_TOKEN,
    },
    body: JSON.stringify({ query, variables }),
  });

  if (response.status === 402) {
    console.error("Shopify Storefront API: payment required (402)");
    return null;
  }
  if (!response.ok) {
    throw new Error(`Shopify Storefront HTTP ${response.status}`);
  }

  const data = await response.json();
  if (data.errors) {
    throw new Error(
      `Shopify Storefront error: ${data.errors.map((e: any) => e.message).join(", ")}`,
    );
  }
  return data;
}

const CART_CREATE_MUTATION = `
  mutation cartCreate($input: CartInput!) {
    cartCreate(input: $input) {
      cart {
        id
        checkoutUrl
        lines(first: 10) {
          edges { node { id merchandise { ... on ProductVariant { id } } } }
        }
      }
      userErrors { field message }
    }
  }
`;

function formatCheckoutUrl(url: string): string {
  try {
    const u = new URL(url);
    u.searchParams.set("channel", "online_store");
    return u.toString();
  } catch {
    return url;
  }
}

export async function createCheckoutForVariant(params: {
  variantGid: string;
  quantity?: number;
  attributes?: Array<{ key: string; value: string }>;
  email?: string;
}): Promise<{ cartId: string; checkoutUrl: string } | null> {
  const input: Record<string, any> = {
    lines: [
      {
        quantity: params.quantity ?? 1,
        merchandiseId: params.variantGid,
      },
    ],
  };
  if (params.attributes && params.attributes.length > 0) {
    input.attributes = params.attributes;
  }
  if (params.email) {
    input.buyerIdentity = { email: params.email };
  }

  const result = await storefrontApiRequest<any>(CART_CREATE_MUTATION, {
    input,
  });
  if (!result) return null;

  const errors = result.data?.cartCreate?.userErrors ?? [];
  if (errors.length > 0) {
    console.error("Shopify cartCreate userErrors:", errors);
    throw new Error(errors.map((e: any) => e.message).join(", "));
  }

  const cart = result.data?.cartCreate?.cart;
  if (!cart?.checkoutUrl) return null;

  return {
    cartId: cart.id,
    checkoutUrl: formatCheckoutUrl(cart.checkoutUrl),
  };
}
