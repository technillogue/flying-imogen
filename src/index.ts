import {
  BskyAgent,
  AppBskyFeedPost,
  AppBskyEmbedImages,
  BlobRef,
} from "@atproto/api";

async function generate(prompt: string) {
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
      let post_record: AppBskyFeedPost.Record =
        n.record as AppBskyFeedPost.Record;
      if (!post_record.text) {
        console.log("no text, skipping");
        continue;
      }
      let prompt = post_record.text.replace("@imogen.bsky.social", "");
      let url = await generate(prompt);
      let blob = await uploadImage(agent, url);
      console.log(blob);
      let embed: AppBskyEmbedImages.Main = {
        images: [{ image: blob, alt: prompt }],
        // $type is required for it to show up and is different from the ts type
        $type: "app.bsky.embed.images",
      };
      await agent.post({
        text: prompt,
        reply: {
          root: post_record.reply?.root ?? reply_ref,
          parent: reply_ref,
        },
        embed: embed,
      });
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
