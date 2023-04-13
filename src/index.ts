import {
  BskyAgent,
  AppBskyFeedPost,
  AppBskyEmbedImages,
  PostRecord,
  BlobRef,
} from "@atproto/api";
import { Image } from "@atproto/api/dist/client/types/app/bsky/embed/images";
import { machine } from "os";

// declare session-data
// let savedSessionData: AtpSessionData;


async function generate(prompt: string) {
  const params = {
    model: "verdant",
    params: {
      prompts: [{ "text": prompt }]
    },
    username: "imogen",
    cost: 0,
  }
  let resp = await fetch("https://oneirograf-prod.fly.dev/prompt", {
    method: "POST",
    body: JSON.stringify(params)
  }).then(r => r.json());
  console.log(resp)
  let id = resp["prompt_id"]
  await new Promise(r => setTimeout(r, 2000));
  while (true) {
    let result = await fetch("https://oneirograf-prod.fly.dev/prompt/" + id).then(r => r.json())
    console.log(result)
    if (result["status"] == "done") {
      return result["outputs"]["image_urls"][0]
    }
    await new Promise(r => setTimeout(r, 1000));
  }
}

async function uploadImage(agent: BskyAgent, url: string) {
  const response = await fetch(url);
  const data: Uint8Array = await response.arrayBuffer().then((buf) => new Uint8Array(buf));
  const mimeType = response.headers.get('content-type') || 'application/octet-stream';
  console.log(data.byteLength, mimeType, response)
  const { success, data: outputData } = await agent.uploadBlob(data, { encoding: mimeType });
  if (success) {
    return outputData.blob
  } else {
    throw new Error("Image upload failed");
  }
}

async function test(agent: BskyAgent) {
  await agent.login({
    identifier: "technillogue@gmail.com",
    password: process.env.PASSWORD,
  });
  // let url = "https://sparklpaint.com/_next/image?url=https%3A%2F%2Fimage-gen-worker.drysys.workers.dev%2Fprod%2F44135%2F0.png&w=1920&q=90"
  // let url = "https://cdn.bsky.social/imgproxy/ex4odoyMOnCKkEv9at2w_MTYTDA7G3zKXHxnOCoZD3A/rs:fit:1000:1000:1:0/plain/bafkreidvhy3sfuefathywqqqx6viruzbpthovfc6hc2wrypmf3kv2ivz5i@jpeg"
  // let url = "https://image-gen-worker.drysys.workers.dev/prod/45346/0.png"
  let url = "https://cdn.bsky.social/imgproxy/u0Poj9hozNFbVtZZNnRZyYxQMuCT2SyKsVCsI_zHwDc/rs:fit:2000:2000:1:0/plain/bafkreidr5ynfxs77hwperowi7lwzfbt44xcwqs5pdzywpuudy3c24663ny@jpeg"
  let blob = await uploadImage(agent, url);
  console.log(blob)
  let embed = { images: [{ image: blob, alt: "image test" }], $type: "app.bsky.embed.images" }

  console.log(embed)
  let record = {
    text: "i can't believe it's not an image attachment",
    embed: embed,
    // reply: { root: record.reply?.root ?? ref, parent: ref },
  }
  console.log(record)
  let res = await agent.post(record);

  console.log(res)
}

async function process_notifs(agent: BskyAgent) {
  console.log("processing")
  let notifs = await agent.listNotifications();
  for (let n of notifs.data.notifications) {
    if (n.isRead) continue;
    console.log(n);
    if (n.reason == "mention" || n.reason == "reply") {
      let response = "have you tried addressing the problem by using an image already on bluesky for testing";
      const ref = { uri: n.uri, cid: n.cid };
      let record: AppBskyFeedPost.Record = n.record as AppBskyFeedPost.Record;

      // let url = "https://cdn.bsky.social/imgproxy/u0Poj9hozNFbVtZZNnRZyYxQMuCT2SyKsVCsI_zHwDc/rs:fit:2000:2000:1:0/plain/bafkreidr5ynfxs77hwperowi7lwzfbt44xcwqs5pdzywpuudy3c24663ny@jpeg"
      if (!record.text) {
        console.log("no text, skipping")
        continue
      }
      let prompt = record.text.replace("@imogen.bsky.social", "");
      let url = await generate(prompt);
      let blob = await uploadImage(agent, url);
      console.log(blob)
      let embed = { images: [{ image: blob, alt: prompt }], $type: "app.bsky.embed.images" }

      await agent.post({
        text: prompt,
        reply: { root: record.reply?.root ?? ref, parent: ref },
        embed: embed
      });
    }
  }
  await agent.updateSeenNotifications(notifs.data.notifications[0].indexedAt);
  console.log("done processing")
}

async function main() {
  const agent = new BskyAgent({ service: "https://bsky.social" });
  await agent.login({
    identifier: "technillogue@gmail.com",
    password: process.env.PASSWORD,
  });
  console.log("logged in")
  while (true) {
    await process_notifs(agent);
    await new Promise(r => setTimeout(r, 1000));
  }
  console.log("exited loop")
}

main();
// generate("i am a cat").then(console.log)

// aaa