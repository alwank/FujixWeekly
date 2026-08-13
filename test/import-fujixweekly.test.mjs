import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { cameraGeneration, extractExampleImages, extractSettings, recipeFromPost, syncRecipes } from "../scripts/import-fujixweekly.mjs";

const recipeHtml = `
  <p><strong>Film Simulation:</strong> Classic Chrome</p>
  <p>Grain Effect: Weak, Small</p>
  <p>White Balance: Daylight</p>
  <p>Highlight Tone: -1</p>
  <p>Shadow: +2</p>
  <p>Noise Reduction: -4</p>
  <p>Film Simulation: Provia</p>`;
const makePost = (id, modified, content = recipeHtml) => ({
  ID: id,
  URL: `https://fujixweekly.com/recipe-${id}/`,
  title: `Recipe ${id} for 5th-Gen X-Trans V`,
  date: "2026-01-02T03:04:05+00:00",
  modified,
  content,
  categories: { Recipes: { name: "Recipes" } },
  tags: { "Camera Recipes": { name: "Camera Recipes" } },
});

test("normalizes settings, aliases, and duplicate labels", () => {
  assert.deepEqual(extractSettings(recipeHtml), [
    { label: "Film Simulation", value: "Classic Chrome" },
    { label: "Grain Effect", value: "Weak, Small" },
    { label: "White Balance", value: "Daylight" },
    { label: "Highlight", value: "-1" },
    { label: "Shadow", value: "+2" },
    { label: "High ISO NR", value: "-4" },
  ]);
  assert.equal(cameraGeneration("A 5th-Gen recipe", ""), "X-Trans V");
  assert.equal(cameraGeneration("A GFX recipe", ""), "GFX");
});

test("parses older line-break layouts and ignores malformed content", () => {
  const older = "Film Simulation: Provia<br>Dynamic Range: DR100<br>Highlight: -1<br>Shadow Tone: +1<br>Color: -2<br>Sharpness: 0";
  assert.deepEqual(extractSettings(older).map((setting) => setting.label), ["Film Simulation", "Dynamic Range", "Highlight", "Shadow", "Color", "Sharpness"]);
  assert.deepEqual(extractSettings("<div><strong>Not a settings block"), []);
});

test("parses verified legacy film-simulation setting blocks", () => {
  const acros = "<p><strong>Acros/Acros+R/Acros+G<br>Dynamic Range: DR200<br>Highlight: +2<br>Shadows: +2<br>Noise Reduction: -2<br>Sharpening: +2<br>Grain Effect: Off<br>ISO: Auto up to 12800</strong></p>";
  const legacyEterna = "<p><strong>Eterna<br>Dynamic Range: DR100<br>Highlight: +4<br>Shadow: +4<br>Color: +4<br>Noise Reduction: -4<br>Sharpening: +2<br>Grain Effect: Strong<br>Color Chrome Effect: Weak<br>White Balance: Auto, +5 Red &amp; -6 Blue<br>ISO: Auto up to ISO 6400</strong></p>";
  const labelledEterna = "<p>Film Simulation: Eterna<br>Dynamic Range: DR100<br>Highlight: +4<br>Shadow: +4<br>Color: +4<br>Noise Reduction: -4<br>Sharpening: +2<br>Grain Effect: Strong<br>Color Chrome Effect: Weak<br>White Balance: Auto, +5 Red &amp; -6 Blue<br>ISO: Auto up to ISO 6400</p>";

  assert.equal(recipeFromPost(makePost(42, "2026-01-02T04:00:00+00:00", acros))?.settings[0].value, "Acros/Acros+R/Acros+G");
  assert.deepEqual(extractSettings(legacyEterna), extractSettings(labelledEterna));
});

test("does not infer legacy film simulations from nearby text or titles", () => {
  const settings = "Dynamic Range: DR100<br>Highlight: +1<br>Shadow: +1<br>Color: +1<br>Sharpness: 0";
  assert.equal(recipeFromPost(makePost(42, "2026-01-02T04:00:00+00:00", `<p>Not a film simulation<br>${settings}</p>`)), null);
  assert.equal(recipeFromPost({ ...makePost(42, "2026-01-02T04:00:00+00:00", `<p>${settings}</p>`), title: "Classic Chrome Recipe for X-Trans III" }), null);
  assert.equal(recipeFromPost(makePost(42, "2026-01-02T04:00:00+00:00", `<p>Acros</p><p>${settings}</p>`)), null);
});

test("keeps only Fuji X Weekly images in the example-photographs section", () => {
  const html = `
    <figure><img src="https://i0.wp.com/fujixweekly.com/wp-content/uploads/lead.jpg" alt="Lead"></figure>
    <h2>Example Photographs</h2>
    <figure><img data-orig-file="https://i0.wp.com/fujixweekly.com/wp-content/uploads/example.jpg?fit=1600&amp;ssl=1" alt="A sample"><figcaption>Sample caption</figcaption></figure>
    <img src="https://example.com/not-allowed.jpg">
    <img src="https://i0.wp.com/fujixweekly.com/wp-content/uploads/example.jpg?fit=1600&amp;ssl=1">
    <h2>Notes</h2>
    <img src="https://i0.wp.com/fujixweekly.com/wp-content/uploads/after-section.jpg">
  `;
  assert.deepEqual(extractExampleImages(html), [{
    sourceUrl: "https://i0.wp.com/fujixweekly.com/wp-content/uploads/example.jpg?fit=1600&ssl=1",
    alt: "A sample",
    caption: "Sample caption",
  }]);
  assert.deepEqual(extractExampleImages("<p>No examples here</p>"), []);
});

test("strictly rejects incomplete settings and preserves a stable recipe ID", () => {
  assert.equal(recipeFromPost(makePost(42, "2026-01-02T04:00:00+00:00", "<p>Film Simulation: Provia</p><p>ISO: 400</p>")), null);
  const recipe = recipeFromPost(makePost(42, "2026-01-02T04:00:00+00:00"));
  assert.equal(recipe.id, "fujixweekly:42");
  assert.equal(recipe.images, undefined);
  assert.equal(recipe.excerpt, undefined);
});

function fakeFetch(posts) {
  return async (input) => {
    const url = new URL(input);
    const match = url.pathname.match(/posts\/(\d+)$/);
    const payload = match ? posts.find((post) => String(post.ID) === match[1]) : { found: posts.length, posts: posts.map(({ content, ...metadata }) => metadata) };
    return { ok: Boolean(payload), status: payload ? 200 : 404, json: async () => payload };
  };
}

test("sync is resumable, reprocesses modified posts, and removes stale recipes", async () => {
  const root = await mkdtemp(join(tmpdir(), "fuji-sync-"));
  const statePath = join(root, "state.json");
  const recipePath = join(root, "recipes.json");
  try {
    const first = makePost(1, "2026-01-02T04:00:00+00:00");
    const rejected = makePost(2, "2026-01-02T04:00:00+00:00", "<p>Film Simulation: Provia</p>");
    const result = await syncRecipes({ fetchImpl: fakeFetch([first, rejected]), delayMs: 500, statePath, recipePath });
    assert.deepEqual(result, { discovered: 2, processed: 2, recipes: 1 });
    assert.equal(JSON.parse(await readFile(recipePath, "utf8"))[0].id, "fujixweekly:1");

    const preImageState = JSON.parse(await readFile(statePath, "utf8"));
    delete preImageState.posts["1"].imageParserVersion;
    await writeFile(statePath, JSON.stringify(preImageState));
    const refreshed = await syncRecipes({ fetchImpl: fakeFetch([first, rejected]), delayMs: 500, statePath, recipePath });
    assert.deepEqual(refreshed, { discovered: 2, processed: 1, recipes: 1 });
    assert.deepEqual(JSON.parse(await readFile(recipePath, "utf8"))[0].exampleImages, []);

    const changed = { ...first, modified: "2026-01-03T04:00:00+00:00", content: "<p>Film Simulation: Provia</p>" };
    const next = await syncRecipes({ fetchImpl: fakeFetch([changed]), delayMs: 500, statePath, recipePath });
    assert.deepEqual(next, { discovered: 1, processed: 1, recipes: 0 });
    const state = JSON.parse(await readFile(statePath, "utf8"));
    assert.deepEqual(Object.keys(state.posts), ["1"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("sync reclassifies unchanged rejected posts once after a parser upgrade", async () => {
  const root = await mkdtemp(join(tmpdir(), "fuji-sync-"));
  const statePath = join(root, "state.json");
  const recipePath = join(root, "recipes.json");
  try {
    const rejected = makePost(2, "2026-01-02T04:00:00+00:00", "<p>Film Simulation: Provia</p>");
    await syncRecipes({ fetchImpl: fakeFetch([rejected]), delayMs: 500, statePath, recipePath });

    const state = JSON.parse(await readFile(statePath, "utf8"));
    delete state.posts["2"].recipeParserVersion;
    await writeFile(statePath, JSON.stringify(state));

    assert.deepEqual(await syncRecipes({ fetchImpl: fakeFetch([rejected]), delayMs: 500, statePath, recipePath }), { discovered: 1, processed: 1, recipes: 0 });
    assert.deepEqual(await syncRecipes({ fetchImpl: fakeFetch([rejected]), delayMs: 500, statePath, recipePath }), { discovered: 1, processed: 0, recipes: 0 });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("public recipe data is metadata and settings only", async () => {
  const records = JSON.parse(await readFile(new URL("../public/data/recipes.json", import.meta.url), "utf8"));
  for (const record of records) {
    assert.equal("content" in record || "articleHtml" in record || "excerpt" in record || "images" in record || "exampleImage" in record, false);
    for (const image of record.exampleImages ?? []) assert.equal(["i0.wp.com", "fujixweekly.com"].includes(new URL(image.sourceUrl).hostname), true);
  }
});
