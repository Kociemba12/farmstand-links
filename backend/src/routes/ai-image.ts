import { Hono } from "hono";
import { z } from "zod";

/**
 * AI Image Generation Routes
 *
 * Generates unique AI images for farmstands based on their main product.
 * Uses OpenAI's gpt-image-1 model.
 */
export const aiImageRouter = new Hono();

// Request schema
const generateImageSchema = z.object({
  farmstandId: z.string().min(1),
  mainProduct: z.string().min(1),
});

// Response type from OpenAI
interface OpenAIImageResponse {
  data?: Array<{ url?: string }>;
}

// Product-specific prompts for better images
const PRODUCT_PROMPTS: Record<string, string> = {
  eggs: "A beautiful farmhouse-style photo of fresh farm eggs in a rustic basket, warm morning light, Oregon countryside setting, no people, artisan quality, shallow depth of field",
  honey: "A beautiful farmhouse-style photo of golden honey jars and honeycomb on a wooden table, warm natural light, Oregon farm setting, no people, artisan quality",
  flowers: "A beautiful farmhouse-style photo of vibrant fresh-cut flowers in a rustic bucket at a rural farmstand, morning light, Oregon countryside, no people, artisan quality",
  produce: "A beautiful farmhouse-style photo of fresh colorful vegetables and produce displayed at a rural farmstand, morning light, Oregon countryside vibe, no people, artisan quality",
  beef: "A beautiful farmhouse-style photo of premium grass-fed beef cuts wrapped in butcher paper on a wooden cutting board, rustic farm kitchen setting, Oregon, no people, artisan quality",
  pork: "A beautiful farmhouse-style photo of fresh farm pork cuts and bacon on a wooden board, rustic country kitchen, Oregon farm setting, no people, artisan quality",
  chicken: "A beautiful farmhouse-style photo of fresh whole chickens and poultry on a rustic farm table, morning light, Oregon countryside, no people, artisan quality",
  dairy: "A beautiful farmhouse-style photo of fresh farm milk in glass bottles and artisan cheese on a wooden board, rustic Oregon farm setting, no people, artisan quality",
  fruit: "A beautiful farmhouse-style photo of fresh ripe farm fruit in wooden crates at a rural farmstand, morning light, Oregon orchard setting, no people, artisan quality",
  veggies: "A beautiful farmhouse-style photo of fresh garden vegetables in baskets at a rural farmstand, morning light, Oregon garden setting, no people, artisan quality",
  baked_goods: "A beautiful farmhouse-style photo of fresh artisan breads and pastries on a rustic wooden counter, warm bakery light, Oregon farm kitchen, no people, artisan quality",
  jams: "A beautiful farmhouse-style photo of homemade jam jars and preserves with fresh fruit on a wooden table, warm light, Oregon farm kitchen, no people, artisan quality",
  crafts: "A beautiful farmhouse-style photo of handmade artisan crafts and soaps displayed on a rustic wooden shelf, warm natural light, Oregon farmstand, no people",
  plants: "A beautiful farmhouse-style photo of seedlings and potted plants at a rural nursery farmstand, morning light, Oregon greenhouse setting, no people, artisan quality",
  u_pick: "A beautiful farmhouse-style photo of a picturesque u-pick berry field with baskets, morning light, Oregon countryside, no people, artisan quality",
  pumpkins: "A beautiful farmhouse-style photo of colorful pumpkins and gourds displayed at a rural farmstand, autumn light, Oregon countryside, no people, artisan quality",
  christmas_trees: "A beautiful farmhouse-style photo of fresh-cut Christmas trees at a rural Oregon tree farm, snowy winter scene, no people, artisan quality",
  other: "A beautiful farmhouse-style photo of a charming rural farmstand with mixed produce, morning light, Oregon countryside vibe, no people, artisan quality",
};

/**
 * Generate AI image for a farmstand
 * POST /api/ai-image/generate
 */
aiImageRouter.post("/generate", async (c) => {
  try {
    const body = await c.req.json();

    // Validate request
    const parseResult = generateImageSchema.safeParse(body);
    if (!parseResult.success) {
      console.error("[AI Image] Invalid request:", parseResult.error);
      return c.json({ error: "Invalid request", details: parseResult.error.issues }, 400);
    }

    const { farmstandId, mainProduct } = parseResult.data;

    // Build deterministic seed
    const aiImageSeed = `${farmstandId}:${mainProduct}`;
    console.log(`[AI Image] Generating image for farmstand ${farmstandId}`);
    console.log(`[AI Image] Main product: ${mainProduct}`);
    console.log(`[AI Image] AI image seed: ${aiImageSeed}`);

    // Get product-specific prompt or default
    const basePrompt = PRODUCT_PROMPTS[mainProduct] || PRODUCT_PROMPTS.other;

    // Add uniqueness hint using farmstand ID
    const prompt = `${basePrompt}. Unique scene variation based on seed: ${aiImageSeed.slice(-8)}`;

    console.log(`[AI Image] Using prompt: ${prompt}`);

    const openaiApiKey = process.env.EXPO_PUBLIC_VIBECODE_OPENAI_API_KEY;

    if (!openaiApiKey) {
      console.error("[AI Image] OpenAI API key not found");
      return c.json({ error: "OpenAI API key not configured" }, 500);
    }

    console.log("[AI Image] Calling OpenAI gpt-image-1...");

    const response = await fetch("https://api.openai.com/v1/images/generations", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${openaiApiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-image-1",
        prompt,
        n: 1,
        size: "1024x1024",
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[AI Image] OpenAI API error: ${response.status} - ${errorText}`);
      return c.json({
        error: "Failed to generate image",
        details: errorText
      }, 500);
    }

    const data = (await response.json()) as OpenAIImageResponse;
    const imageUrl = data.data?.[0]?.url;

    if (!imageUrl) {
      console.error("[AI Image] No image URL in response:", data);
      return c.json({ error: "No image URL returned" }, 500);
    }

    console.log(`[AI Image] Successfully generated image for farmstand ${farmstandId}`);
    console.log(`[AI Image] Image URL: ${imageUrl.substring(0, 80)}...`);

    return c.json({
      success: true,
      aiImageUrl: imageUrl,
      aiImageSeed,
      aiImageUpdatedAt: new Date().toISOString(),
      mainProduct,
    });
  } catch (error) {
    console.error("[AI Image] Generation error:", error);
    return c.json({
      error: "Image generation failed",
      details: error instanceof Error ? error.message : "Unknown error"
    }, 500);
  }
});

/**
 * Health check for AI image service
 * GET /api/ai-image/health
 */
aiImageRouter.get("/health", (c) => {
  return c.json({
    status: "ok",
    service: "ai-image",
    hasApiKey: !!process.env.EXPO_PUBLIC_VIBECODE_OPENAI_API_KEY,
  });
});
