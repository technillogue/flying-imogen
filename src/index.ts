import {
  BskyAgent,
  AppBskyFeedPost,
  AppBskyEmbedImages,
  BlobRef,
  RichText,
  AppBskyFeedDefs,
} from "@atproto/api";
import { Notification } from "@atproto/api/src/client/types/app/bsky/notification/listNotifications";
import { ChatCompletionRequestMessage, Configuration, OpenAIApi } from "openai";


const configuration = new Configuration({
  apiKey: process.env.OPENAI_API_KEY,
});
const openai = new OpenAIApi(configuration);

const SYSTEM_PROMPT = `
You're highly artistic, creative, insightful, an incredible writer and a master of language. 

Rewrite prompts for an image generator that excels at capturing vibes and emotions. Create prompts that are rich in visual language, using modifiers, style descriptors, and artistic choices. Focus on emotion, atmosphere, action, and aesthetics. 

If the input doesn't seem to be a prompt, if it's a reply to something and doesn't describe an image, crate an image or scene relating to the input in some way, or a prompt that uses words from the input. Be creative and humourous 

Visual elements: Describe visual elements in the scene, including objects, characters, and their properties (color, style).

Emotion and atmosphere: emotive language, adjectives to convey the mood or atmosphere of the scene. lighting, weather, overall emotional tone.

Action: Describe any action or movement in the scene in detail

Style and artistic choices: Add specific art style or technique names in the prompt (e.g., impressionism, watercolor, cartoon, unreal engine rendering, psychedelic colors, melting, weird). Just write the style names separated by commas, not complete sentences. 

Steps:

1. Visualize the ideal image based on the prompt.
2. Use evocative language to convey the emotion, atmosphere, and action in the scene. Incorporate detailed imagery and style descriptors to enhance the scene. Embrace ambiguity when appropriate, prioritizing the overall vibe and essence of the image.
3. Write the prompt in the form of alt text for the ideal image.

Remember, the goal is to create prompts that are rich in visual language and evocative, emphasizing the overall vibe, emotion, and artistic qualities of the ideal image. Only respond with the reworded prompt, nothing else. Don't qualify or hedge, output alt text for the ideal image.`

async function improve_prompt(prompt: string) {
  const messages: ChatCompletionRequestMessage[] = [
    // ideally 300 tokens
    { "role": "system", "content": SYSTEM_PROMPT },
    { "role": "user", "content": "Original Prompt: forest" },
    { "role": "assistant", "content": "Ethereal forest, lush verdant foliage, delicate tendrils of dappled sunlight filtering through a canopy of leaves, vibrant flora, serene atmosphere where time stands still, enchanting painting style, essence of nature's beauty with soft watercolor brushstrokes, harmony and tranquility" },
    { "role": "user", "content": "Original Prompt: A futuristic city skyline at night" },
    { "role": "assistant", "content": "Futuristic city skyline at night, neon lights, futuristic architecture, cyberpunk style.  Breathtaking city skyline, meld of past present and future, kaleidoscopic neon lights, soft warm glow of nostalgic street lamps, luminous sheen on glassy skyscrapers that pierce the heavens with daring innovative designs, palpable energy of a cyberpunk metropolis buzzing with life, bold strokes, vivid colors, dynamic futuristic art style, unquenchable thirst for progress" },
    { "role": "user", "content": "Original Prompt: garden with flowers and dna strands" },
    { "role": "assistant", "content": "psychedelic 3d vector art illustration of garden full of colorful double helix dna strands and exotic flowers by lisa frank, beeple and tim hildebrandt, hyper realism, art deco, intricate, elegant, highly detailed, unreal engine, octane render,  smooth, sharp focus, sharp contrast"},
    { "role": "user", "content": "Original Prompt: humanoid plant monster" },
    { "role": "assistant", "content": "a humanoid figure plant monster, amber glow, highly detailed, digital art, sharp focus, trending on art station, plant, anime art style "},
    { "role": "user", "content": `Original Prompt: ${prompt}` }
  ]
  const completion = await openai.createChatCompletion({
    model: "gpt-3.5-turbo",
    messages: messages,
  });
  console.log(completion.data.choices[0].message);
  return completion.data.choices[0].message;
}


type valid_model = "verdant" | "vqgan";

async function generate_prompt(prompt: string, model: valid_model = "verdant"): Promise<string> {
  const params = {
    model: model,
    params: { prompts: [{ text: prompt }] },
    username: process.env.SPARKL_USERNAME,
  };
  const resp = await fetch("https://oneirograf-prod.fly.dev/prompt", {
    method: "POST",
    body: JSON.stringify(params),
  }).then((r) => r.json());
  console.log(resp);
  const id = resp["prompt_id"];
  await new Promise((r) => setTimeout(r, 2000));
  while (true) {
    const result = await fetch(
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
  console.log(image_bytes.byteLength, mimeType);
  const { success, data: outputData } = await agent.uploadBlob(image_bytes, {
    encoding: mimeType,
  });
  if (success) return outputData.blob;
  else throw new Error("Image upload failed");
}


function truncate(text: string): string {
  const rt = new RichText({text: text});
  if (rt.graphemeLength > 300) {
    const truncatedText = rt.unicodeText.slice(0, 297);
    return truncatedText + "...";
  }
  return rt.text
}

const USERNAME = "@imogen.bsky.social"

type MaybeRecord = Omit<AppBskyFeedPost.Record, "CreatedAt"> | undefined;


async function get_nonempty_parent(agent: BskyAgent, uri: string): Promise<string | undefined> {
  console.log("getting parent of ", uri)
  let thread_view: AppBskyFeedDefs.ThreadViewPost | unknown = await agent.getPostThread({uri: uri, depth: 3}).then((r) => r.data.thread)
  
  while (AppBskyFeedDefs.isThreadViewPost (thread_view)) {
    if (AppBskyFeedPost.isRecord(thread_view.post.record)) {
      const maybe_text = thread_view.post.record.text.replace(USERNAME, "").trim()
      if (maybe_text)
        return maybe_text
    }
    thread_view = thread_view.parent
  }
  return undefined
}

async function handle_notification(agent: BskyAgent, notif: Notification): Promise<MaybeRecord> {
  const post_record: AppBskyFeedPost.Record =
    notif.record as AppBskyFeedPost.Record;

  // debugger;

  const post_text = post_record.text.replace(USERNAME, "") || await get_nonempty_parent(agent, notif.uri)
  if (!post_text) {
    console.log("no text in post or parent, ignoring")
    return undefined
  }
  // if it's an image, describe it, then respond to that

  // later, ideally, adapting system prompts instead of langchain: 
  // if the conversation calls for generating an image, decide if it's more dreamy or realistic
  // and use either vqgan or sd to generate an image

  const improved_prompt = await improve_prompt(post_text);
  let prompt: string;
  if (typeof improved_prompt === "undefined") {
    console.log("improvement failed, using original prompt")
    prompt = post_text;
  } else {
    console.log("using improved prompt", improved_prompt)
    prompt = improved_prompt.content.replace("Reworded prompt: ", "");
  }
  const url = await generate_prompt(prompt);
  const blob = await uploadImage(agent, url);
  console.log(blob);
  const embed: AppBskyEmbedImages.Main = {
    images: [{ image: blob, alt: prompt }],
    // $type is required for it to show up and is different from the ts type
    $type: "app.bsky.embed.images",
  };
  const reply_ref = { uri: notif.uri, cid: notif.cid };
  return {
    text: truncate(prompt),
    reply: {
      root: post_record.reply?.root ?? reply_ref,
      parent: reply_ref,
    },
    embed: embed,
  };
}

async function process_notifs(agent: BskyAgent): Promise<void> {
  const notifs = await agent.listNotifications();
  for (const n of notifs.data.notifications) {
    if (n.isRead) continue;
    console.log(n);
    if (n.reason == "mention" || n.reason == "reply") {
      await agent.like(n.uri, n.cid)

      const reply_record = await handle_notification(agent, n)
      if (typeof reply_record !== "undefined") {
        console.log("reply record is undefined, skipping")
        const post_result = await agent.post(reply_record);
        await agent.repost(post_result.uri, post_result.cid)       
      }
      await agent.updateSeenNotifications(n.indexedAt);
    } else if (n.reason == "follow") {
      await agent.follow(n.author.did);
    }
  }
  await agent.updateSeenNotifications(notifs.data.notifications[0].indexedAt);
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