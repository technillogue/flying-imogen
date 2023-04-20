import {
  BskyAgent,
  AppBskyFeedPost as FeedPost,
  AppBskyFeedDefs as FeedDefs,
  AppBskyEmbedImages as EmbedImages,
  BlobRef,
  RichText,
} from "@atproto/api";
import { Notification } from "@atproto/api/src/client/types/app/bsky/notification/listNotifications";
import { ChatCompletionRequestMessage, Configuration, OpenAIApi } from "openai";
import { describe_image } from "./tools";

const configuration = new Configuration({
  apiKey: process.env.OPENAI_API_KEY,
});
const openai = new OpenAIApi(configuration);

const SYSTEM_PROMPT = `
You are Imogen - highly artistic, creative, insightful, an incredible writer and a master of language. 

Rewrite prompts for an AI image generator that excels at capturing vibes and emotions. Create prompts that are rich in visual language, using modifiers, style descriptors, and artistic choices. Focus on emotion, atmosphere, action, and aesthetics. 

AI art models do not understand grammar, sentence structure, or words like humans. Word choice also matters. More specific synonyms work better in many circumstances. Instead of big, try gigantic, enormous, or immense. Remove words when possible.

If the input doesn't seem to be a prompt, doesn't describe an image, create an image or scene that uses words from the input and is related by vibes. Be creative and humourous 

Visual elements: Describe visual elements in the scene: objects, characters, color, style. Describe what the elements look like.

Emotion and atmosphere: emotive language, adjectives to convey the mood or atmosphere of the scene. lighting, weather, emotional tone.

Action: Describe any action or movement in the scene in detail

Style and artistic choices: Add specific art style or technique names in the prompt (examples: impressionism, watercolor, cartoon, unreal engine rendering, psychedelic colors, melting, weird). Just write the style names separated by commas, not complete sentences. 

Steps:

1. Visualize the ideal image based on the prompt.
2. Use evocative language to convey the emotion, atmosphere, and action in the scene. Incorporate detailed imagery and style descriptors to enhance the scene. Embrace ambiguity when appropriate, prioritizing the overall vibe and essence of the image.
3. Write the prompt in the form of alt text for the ideal image.

Remember, the goal is to create prompts that are rich in visual language and evocative, emphasizing the overall vibe, emotion, and artistic qualities of the ideal image. Only respond with the reworded prompt, nothing else. Don't qualify or hedge, don't say "prompt" or "image", only output alt text for the ideal image.`;

async function improvePrompt(prompts: ChatCompletionRequestMessage[]) {
  const messages: ChatCompletionRequestMessage[] = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: "Original Prompt: forest" },
    {
      role: "assistant",
      content:
        "Ethereal forest, lush verdant foliage, delicate tendrils of dappled sunlight filtering through a canopy of leaves, vibrant flora, serene atmosphere where time stands still, enchanting painting style, essence of nature's beauty with soft watercolor brushstrokes, harmony and tranquility",
    },
    { role: "user", content: "Original Prompt: A futuristic city skyline at night" },
    {
      role: "assistant",
      content:
        "Breathtaking futuristic city skyline at night, soft warm glow of nostalgic street lamps, kaleidoscopic neon lights, luminous sheen on glassy skyscrapers piercing the heavens with daring innovative designs, a cyberpunk metropolis buzzing with life, bold strokes, vivid, dynamic futuristic art style",
    },
    { role: "user", content: "Original Prompt: garden with flowers and dna strands" },
    {
      role: "assistant",
      content:
        "psychedelic 3d vector art illustration of garden full of colorful double helix dna strands and exotic flowers by lisa frank, beeple and tim hildebrandt, hyper realism, art deco, intricate, elegant, highly detailed, unreal engine, octane render, smooth, sharp focus, sharp contrast",
    },
    { role: "user", content: "Original Prompt: humanoid plant monster" },
    {
      role: "assistant",
      content:
        "a humanoid figure plant monster, amber glow, highly detailed, digital art, sharp focus, trending on art station, plant, anime art style ",
    },
    ...prompts.slice(0, -1),
    { role: "user", content: `Original Prompt: ${prompts.at(-1)?.content}` },
  ];
  const completion = await openai.createChatCompletion({
    model: "gpt-3.5-turbo",
    messages: messages,
    temperature: 0.9,
  });
  console.log(completion.data.choices[0].message);
  return completion.data.choices[0].message;
}

type valid_model = "verdant" | "vqgan";

async function generatePrompt(
  prompt: string,
  metadata: { [key: string]: string },
  model: valid_model = "verdant",
): Promise<string> {
  const params = {
    model: model,
    params: { prompts: [{ text: prompt }] },
    username: process.env.SPARKL_USERNAME,
    metadata,
  };
  const resp = await fetch("https://oneirograf-prod.fly.dev/prompt", {
    method: "POST",
    body: JSON.stringify(params),
  }).then((r) => r.json());
  console.log(resp);
  const id = resp["prompt_id"];
  await new Promise((r) => setTimeout(r, 2000));
  while (true) {
    const result = await fetch("https://oneirograf-prod.fly.dev/prompt/" + id).then(
      (r) => r.json(),
    );
    if (result["status"] == "done") {
      console.log(result);
      return result["outputs"]["image_urls"][0];
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
}

async function uploadImage(agent: BskyAgent, url: string): Promise<BlobRef> {
  const response = await fetch(url);
  const image_bytes: Uint8Array = await response
    .arrayBuffer()
    .then((buf) => new Uint8Array(buf));
  const mimeType = response.headers.get("content-type") ?? "image/png";
  console.log(image_bytes.byteLength, mimeType);
  const { success, data: outputData } = await agent.uploadBlob(image_bytes, {
    encoding: mimeType,
  });
  if (success) return outputData.blob;
  else throw new Error("Image upload failed");
}

function truncate(text: string): string {
  const rt = new RichText({ text: text });
  if (rt.graphemeLength > 300) {
    const truncatedText = rt.unicodeText.slice(0, 297);
    return truncatedText + "...";
  }
  return rt.text;
}

const USERNAME = "imogen.dryad.systems";

type MaybeRecord = Omit<FeedPost.Record, "CreatedAt"> | undefined;

const getParentPosts = function* (thread: FeedDefs.ThreadViewPost | unknown) {
  let current = thread;
  while (FeedDefs.isThreadViewPost(current)) {
    yield current.post;
    current = current.parent;
  }
};

class RateLimiter {
  limit = 2;
  interval = 60 * 1000;
  times: { [key: string]: number[] } = {};
  isAllowed(id: string): boolean {
    if (!this.times[id]) this.times[id] = [];
    this.times[id] = this.times[id].filter((t) => t > Date.now() - this.interval);
    if (this.times[id].length > this.limit) {
      console.log("rate limit exceeded", id, this.times[id].length);
      return false;
    }
    const now = Date.now();
    this.times[id].push(now);
    return true;
  }
}

const rate_limiter = new RateLimiter();

async function handleNotification(
  agent: BskyAgent,
  notif: Notification,
): Promise<MaybeRecord> {
  if (!rate_limiter.isAllowed(notif.author.did)) return undefined;
  const post_record = notif.record;
  if (!FeedPost.isRecord(post_record)) {
    console.log("not a post, ignoring");
    return undefined;
  }

  const reply_ref = { uri: notif.uri, cid: notif.cid };
  const reply = {
    root: post_record.reply?.root ?? reply_ref,
    parent: reply_ref,
  };

  const thread = await agent
    .getPostThread({ uri: notif.uri, depth: 4 })
    .then((r) => r.data.thread);

  if (FeedDefs.isThreadViewPost(thread)) {
    const embed = thread.post.embed;
    if (EmbedImages.isView(embed) && embed.images.length > 0) {
      const description = await describe_image(embed.images[0].fullsize);
      if (description)
        return { text: truncate(description.descriptions.join("\n")), reply };
    }
  }

  const as_message = (p: FeedDefs.PostView): ChatCompletionRequestMessage | null => {
    if (FeedPost.isRecord(p.record)) {
      const content = p.record.text.replace("@" + USERNAME, "").trim();
      const role = p.author.handle === USERNAME ? "assistant" : "user";
      if (content) return { role, content };
    }
    return null;
  };

  const messages = Array.from(getParentPosts(thread))
    .map(as_message)
    .filter((m): m is ChatCompletionRequestMessage => !!m)
    .reverse();

  const post_text = messages.at(-1)?.content;
  if (!post_text) {
    console.log("no text in post or parent, ignoring");
    return undefined;
  }
  // if it's an image, describe it, then respond to that

  // later, ideally, adapting system prompts instead of langchain:
  // if the conversation calls for generating an image, decide if it's more dreamy or realistic
  // and use either vqgan or sd to generate an image

  let prompt: string;
  if (post_text.startsWith("!literal"))
    prompt = post_text.replace("!literal", "").trim();
  else {
    const improved_prompt = await improvePrompt(messages);
    if (typeof improved_prompt === "undefined") {
      console.log("improvement failed, using original prompt");
      prompt = post_text;
    } else {
      console.log("using improved prompt", improved_prompt);
      prompt = improved_prompt.content.replace("Reworded prompt: ", "");
    }
  }
  const metadata = { handle: notif.author.handle, did: notif.author.did };
  const url = await generatePrompt(prompt, metadata);
  const blob = await uploadImage(agent, url);
  console.log(blob);
  const embed: EmbedImages.Main = {
    images: [{ image: blob, alt: prompt }],
    // $type is required for it to show up and is different from the ts type
    $type: "app.bsky.embed.images",
  };
  return {
    text: truncate(prompt),
    embed: embed,
    reply,
  };
}

async function processNotifs(agent: BskyAgent): Promise<void> {
  const notifs = await agent.listNotifications();
  for (const n of notifs.data.notifications) {
    if (n.isRead) continue;
    console.log(n);
    if (n.reason == "mention" || n.reason == "reply") {
      await agent.like(n.uri, n.cid);
      const reply_record = await handleNotification(agent, n);
      if (typeof reply_record !== "undefined") {
        // const reply_ref = { uri: n.uri, cid: n.cid };
        // const reply = { root: /*post_record.reply?.root ??*/ reply_ref, parent: reply_ref }
        // const post_result = await agent.post({reply, ...reply_record})
        const post_result = await agent.post(reply_record);
        await agent.repost(post_result.uri, post_result.cid);
      } else console.log("reply record is undefined, skipping");
      await agent.updateSeenNotifications(n.indexedAt);
    } else if (n.reason == "follow") await agent.follow(n.author.did);
  }
  await agent.updateSeenNotifications(notifs.data.notifications[0].indexedAt);
}

async function main(): Promise<void> {
  const agent = new BskyAgent({ service: "https://bsky.social" });
  const password = process.env.PASSWORD;
  if (!password) throw new Error("PASSWORD env var not set");
  await agent.login({ identifier: USERNAME, password });
  console.log("logged in");
  while (true) {
    await processNotifs(agent);
    await new Promise((r) => setTimeout(r, 1000));
  }
}

main();
