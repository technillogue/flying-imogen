import {
  BskyAgent,
  AppBskyFeedPost,
  AppBskyEmbedImages,
  BlobRef,
} from "@atproto/api";
import { ChatCompletionRequestMessage, Configuration, OpenAIApi } from "openai";

const configuration = new Configuration({
  apiKey: process.env.OPENAI_API_KEY,
});
const openai = new OpenAIApi(configuration);

const SYSTEM_PROMPT = `
You're highly artistic, creative, and insightful. You help improve user text so it would be a great prompt for an image generator. if the ideal image was already on the internet,  the prompt should be similar to alt text for that image. Use vivid, visual language with a lot of modifiers and style tags. Be as specific as you can. 

Consider the following in your answers.

Visual elements: Describe the key visual elements in the scene, including objects, characters, and their properties (size, shape, etc and especially color).

Emotion and atmosphere: Use emotive language and adjectives to convey the mood or atmosphere of the scene. This can include aspects like lighting, weather, and the overall emotional tone.

Action: If there's any action or movement in the scene, describe it in detail

Style and artistic choices: If the image would be better with a specific art style or technique (e.g., impressionism, watercolor, cartoon, unreal engine rendering, psychedelic colors, melting, weird), name them in the prompt.

Only respond with the reworded prompt, nothing else. 
`

async function improve_prompt(prompt: string) {
  const messages: ChatCompletionRequestMessage[] = [
    {"role": "system", "content": SYSTEM_PROMPT},
    {"role": "user", "content": "Original Prompt: a sunset over the mountains"},
    {"role": "assistant", "content": "Reworded prompt: A breathtaking sunset over a majestic mountain range, with the warm, golden light casting a glow on the snow-capped peaks, and a serene, lavender sky filled with wispy clouds."},
    {"role": "user", "content": `Original Prompt: ${prompt}`}
  ]
  const completion = await openai.createChatCompletion({
    model: "gpt-3.5-turbo",
    messages: messages,
  });
  console.log(completion.data.choices[0].message);
  return completion.data.choices[0].message;
}

async function generate_prompt(prompt: string) {
  const params = {
    model: "verdant",
    params: { prompts: [{ text: prompt }] },
    username: "imogen",
    cost: 0,
  };
  let resp = await fetch("https://oneirograf-prod.fly.dev/prompt", {
    method: "POST",
    body: JSON.stringify(params),
  }).then((r) => r.json());
  console.log(resp);
  let id = resp["prompt_id"];
  await new Promise((r) => setTimeout(r, 2000));
  while (true) {
    let result = await fetch(
      "https://oneirograf-prod.fly.dev/prompt/" + id
    ).then((r) => r.json());
    console.log(result);
    if (result["status"] == "done") return result["outputs"]["image_urls"][0];
    await new Promise((r) => setTimeout(r, 1000));
  }
}

async function uploadImage(agent: BskyAgent, url: string): Promise<BlobRef> {
  const response = await fetch(url);
  const image_bytes: Uint8Array = await response
    .arrayBuffer()
    .then((buf) => new Uint8Array(buf));
  const mimeType = response.headers.get("content-type") ?? "image/png";
  console.log(image_bytes.byteLength, mimeType, response);
  const { success, data: outputData } = await agent.uploadBlob(image_bytes, {
    encoding: mimeType,
  });
  if (success) return outputData.blob;
  else throw new Error("Image upload failed");
}

async function process_notifs(agent: BskyAgent): Promise<void> {
  let notifs = await agent.listNotifications();
  for (let n of notifs.data.notifications) {
    if (n.isRead) continue;
    console.log(n);
    if (n.reason == "mention" || n.reason == "reply") {
      const reply_ref = { uri: n.uri, cid: n.cid };
      await agent.like(n.uri, n.cid)
      let post_record: AppBskyFeedPost.Record =
        n.record as AppBskyFeedPost.Record;
      if (!post_record.text) {
        console.log("no text, skipping");
        continue;
      }
      let prompt = post_record.text.replace("@imogen.bsky.social", "");
      let url = await generate_prompt(prompt);
      let blob = await uploadImage(agent, url);
      console.log(blob);
      let embed: AppBskyEmbedImages.Main = {
        images: [{ image: blob, alt: prompt }],
        // $type is required for it to show up and is different from the ts type
        $type: "app.bsky.embed.images",
      };
      let post_result = await agent.post({
        text: prompt,
        reply: {
          root: post_record.reply?.root ?? reply_ref,
          parent: reply_ref,
        },
        embed: embed,
      });
      await agent.repost(post_result.uri, post_result.cid)
    } else if (n.reason == "follow") {
      await agent.follow(n.author.did);
    }
  }
  await agent.updateSeenNotifications(notifs.data.notifications[0].indexedAt);
  console.log("done processing");
}

async function main(): Promise<void> {
  const agent = new BskyAgent({ service: "https://bsky.social" });
  const password = process.env.PASSWORD;
  if (!password) throw new Error("PASSWORD env var not set");
  await agent.login({ identifier: "technillogue@gmail.com", password });
  console.log("logged in");
  while (true) {
    await process_notifs(agent);
    await new Promise((r) => setTimeout(r, 1000));
  }
}

main();
