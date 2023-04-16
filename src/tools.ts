export async function get_aesthetic_score(text: string): Promise<number> {
  const resp = await fetch("https://good-post-detector.fly.dev/good", {
    method: "POST",
    body: text,
  });
  return parseFloat(await resp.text());
}

interface ImageDescriptions {
  descriptions: string[];
}

export async function describe_image(
  image_url: string,
  personality = "Creative"
): Promise<ImageDescriptions | undefined> {
  const url = `http://cliptalk.tenant-dryad-spark.knative.chi.coreweave.com/url?personality=${personality}`;
  const descriptions = await fetch(url, {
    method: "POST",
    body: image_url,
  }).then((r) => r.json());
  console.log("descriptions: ", descriptions);
  if (
    Array.isArray(descriptions) &&
    descriptions.every((d) => typeof d === "string")
  )
    return { descriptions: descriptions };
  console.log(
    "description result not expected, got" + JSON.stringify(descriptions)
  );
  // return descriptions
}
