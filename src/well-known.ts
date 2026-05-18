// Static fallback metadata for directory crawlers (Smithery) that cannot
// complete OAuth to call tools/list against /mcp. See docs/listing-followup.md.

const SERVER_CARD = {
  $schema: "https://smithery.ai/schemas/server-card.json",
  name: "com.beauticslab/mcp",
  displayName: "BeauticsLab",
  description:
    "Browse Korean skincare on demand: fetch your saved BeauticsLab routines with per-product ingredient breakdowns, search across Olive Young, Daiso, Korean e-commerce listings (Naver, Coupang, 11st), and BeauticsLab's verified custom catalog by name, brand, or keyword, and retrieve complete ingredient lists with EWG safety grades for any product. OAuth-secured; only your own routine data is accessible.",
  version: "1.0.1",
  homepage: "https://beauticslab.com",
  repository: "https://github.com/websfactory/beauticslab-mcp",
  tools: [
    {
      name: "get_my_routine",
      title: "My Skincare Routine",
      description:
        "Retrieves the authenticated user's saved skincare routines and their products, optionally including the top ingredients per product.",
      inputSchema: {
        type: "object",
        properties: {
          includeIngredients: {
            type: "boolean",
            default: false,
            description: "Whether to include the top ingredients for each product.",
          },
        },
      },
    },
    {
      name: "search_product",
      title: "Search Cosmetics Product",
      description:
        "Searches the BeauticsLab catalog by product name, brand, or keyword and returns ranked results with source labels. Korean queries recommended for best recall.",
      inputSchema: {
        type: "object",
        required: ["query"],
        properties: {
          query: {
            type: "string",
            minLength: 2,
            maxLength: 100,
            description: "Product name, brand, or keyword (min 2 chars).",
          },
          limit: {
            type: "integer",
            minimum: 1,
            maximum: 50,
            default: 20,
            description: "Maximum number of results.",
          },
          category: {
            type: "string",
            enum: ["skincare", "suncare", "cleansing", "maskpack", "makeup", "bodyhair"],
            description: "Category filter.",
          },
        },
      },
    },
    {
      name: "get_product_ingredients",
      title: "Get Product Ingredients",
      description:
        "Retrieves the full ingredient list for one product by its goodsNo, with Korean and English names plus EWG safety grades when available.",
      inputSchema: {
        type: "object",
        required: ["goodsNo"],
        properties: {
          goodsNo: {
            type: "string",
            minLength: 1,
            maxLength: 128,
            description: "Product identifier returned by search_product or get_my_routine. Pass it through unchanged.",
          },
        },
      },
    },
  ],
} as const;

const SERVER_CARD_BODY = JSON.stringify(SERVER_CARD);

export function serveServerCard(): Response {
  return new Response(SERVER_CARD_BODY, {
    status: 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "public, max-age=300",
    },
  });
}
