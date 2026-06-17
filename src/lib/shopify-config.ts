// Public Shopify Storefront config — safe to ship to the client.
// The Storefront token is a publishable token (read-only, scoped).
export const SHOPIFY_API_VERSION = "2025-07";
export const SHOPIFY_STORE_PERMANENT_DOMAIN = "hamor-rbm43.myshopify.com";
export const SHOPIFY_STOREFRONT_TOKEN = "6a265c2abf2dd4fed5113b53caad4f02";
export const SHOPIFY_STOREFRONT_URL = `https://${SHOPIFY_STORE_PERMANENT_DOMAIN}/api/${SHOPIFY_API_VERSION}/graphql.json`;
