// src/server/cloud-providers.js
// Real external cloud provider REST integrations:
// 1) OpenAI Images API (gpt-image-1 / dall-e-3)
// 2) Google Gemini / Imagen 3 / Veo API
// 3) HuggingFace Serverless Inference API (for Cloud GPU fallback when HF token is configured)

import fs from "node:fs";
import path from "node:path";

function mapAspectToOpenAiSize(aspect = "1:1") {
  if (aspect === "16:9") return "1536x1024";
  if (aspect === "9:16") return "1024x1536";
  return "1024x1024";
}

export async function runOpenAiImageGeneration({ apiKey, prompt, aspectRatio = "1:1", outPath }) {
  if (!apiKey) {
    throw Object.assign(new Error("OpenAI API key is required. Configure it in Model Manager -> API Keys."), {
      status: 400,
      errorCode: "missing_api_key",
    });
  }

  const res = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-image-1",
      prompt,
      size: mapAspectToOpenAiSize(aspectRatio),
      n: 1,
    }),
  });

  const json = await res.json();
  if (!res.ok) {
    throw new Error(json.error?.message || `OpenAI API failed (${res.status})`);
  }

  const item = json.data?.[0];
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  if (item?.b64_json) {
    const buf = Buffer.from(item.b64_json, "base64");
    fs.writeFileSync(outPath, buf);
    return { outPath, bytes: buf.length, provider: "openai" };
  }
  if (item?.url) {
    const imgRes = await fetch(item.url);
    const buf = Buffer.from(await imgRes.arrayBuffer());
    fs.writeFileSync(outPath, buf);
    return { outPath, bytes: buf.length, provider: "openai" };
  }
  throw new Error("OpenAI returned no image payload.");
}

export async function runGoogleImagenOrGemini({ apiKey, prompt, aspectRatio = "1:1", mediaType = "image", outPath }) {
  if (!apiKey) {
    throw Object.assign(new Error("Google AI Studio API key is required. Configure it in Model Manager -> API Keys."), {
      status: 400,
      errorCode: "missing_api_key",
    });
  }

  if (mediaType === "video") {
    // Google Veo long-running operation
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/veo-2.0-generate-001:predictLongRunning?key=${encodeURIComponent(apiKey)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          instances: [{ prompt }],
          parameters: { aspectRatio: aspectRatio === "9:16" ? "9:16" : "16:9", durationSeconds: 5 },
        }),
      }
    );
    const op = await res.json();
    if (!res.ok) throw new Error(op.error?.message || `Google Veo failed (${res.status})`);
    const opName = op.name;
    for (let i = 0; i < 60; i++) {
      await new Promise((r) => setTimeout(r, 3000));
      const poll = await (
        await fetch(`https://generativelanguage.googleapis.com/v1beta/${opName}?key=${encodeURIComponent(apiKey)}`)
      ).json();
      if (poll.done) {
        const uri = poll.response?.generateVideoResponse?.generatedSamples?.[0]?.video?.uri;
        if (!uri) throw new Error(poll.error?.message || "Veo finished with no video URI.");
        const dl = await fetch(`${uri}&key=${encodeURIComponent(apiKey)}`);
        const buf = Buffer.from(await dl.arrayBuffer());
        fs.mkdirSync(path.dirname(outPath), { recursive: true });
        fs.writeFileSync(outPath, buf);
        return { outPath, bytes: buf.length, provider: "google-veo" };
      }
    }
    throw new Error("Google Veo generation timed out.");
  }

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/imagen-3.0-generate-002:predict?key=${encodeURIComponent(apiKey)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        instances: [{ prompt }],
        parameters: { sampleCount: 1, aspectRatio },
      }),
    }
  );
  const json = await res.json();
  if (!res.ok) throw new Error(json.error?.message || `Google Imagen failed (${res.status})`);
  const b64 = json.predictions?.[0]?.bytesBase64Encoded;
  if (!b64) throw new Error("Google Imagen returned no image bytes.");
  const buf = Buffer.from(b64, "base64");
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, buf);
  return { outPath, bytes: buf.length, provider: "google-imagen" };
}

export async function runHuggingFaceInference({ hfToken, hfModelId = "black-forest-labs/FLUX.1-schnell", prompt, negativePrompt = "", outPath }) {
  if (!hfToken) {
    throw Object.assign(new Error("HuggingFace token required for Serverless Cloud Inference."), {
      status: 400,
      errorCode: "missing_api_key",
    });
  }

  const res = await fetch(`https://router.huggingface.co/hf-inference/models/${hfModelId}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${hfToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      inputs: prompt,
      parameters: negativePrompt ? { negative_prompt: negativePrompt } : undefined,
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`HuggingFace Inference failed (${res.status}): ${errText.slice(0, 200)}`);
  }

  const buf = Buffer.from(await res.arrayBuffer());
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, buf);
  return { outPath, bytes: buf.length, provider: "huggingface-inference" };
}
