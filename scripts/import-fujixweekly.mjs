#!/usr/bin/env node
import * as cheerio from "cheerio";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const API = "https://public-api.wordpress.com/rest/v1.1/sites/fujixweekly.com/posts";
const USER_AGENT = "FujiPocket/1.0 (source-linked recipe index; metadata and settings only)";
const DEFAULT_DELAY = 1_500;
const PAGE_SIZE = 100;
const IMAGE_PARSER_VERSION = 1;
const RECIPE_PARSER_VERSION = 2;
const RECIPE_PATH = resolve("public/data/recipes.json");
const STATE_PATH = resolve("data/fujixweekly-sync.json");

function escapeRegExp(value) { return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

const LABELS = [
  ["Film Simulation", ["Film Simulation"]],
  ["Grain Effect", ["Grain Effect"]],
  ["Color Chrome Effect", ["Color Chrome Effect"]],
  ["Color Chrome FX Blue", ["Color Chrome FX Blue"]],
  ["White Balance", ["White Balance"]],
  ["White Balance Shift", ["White Balance Shift", "WB Shift"]],
  ["Dynamic Range", ["Dynamic Range"]],
  ["Highlight", ["Highlight Tone", "Highlight"]],
  ["Shadow", ["Shadow Tone", "Shadow"]],
  ["Color", ["Color"]],
  ["Sharpness", ["Sharpness"]],
  ["High ISO NR", ["High ISO Noise Reduction", "Noise Reduction", "High ISO NR"]],
  ["Clarity", ["Clarity"]],
  ["ISO", ["ISO"]],
  ["Exposure Compensation", ["Exposure Compensation"]],
  ["Monochromatic Color", ["Monochromatic Color"]],
];
const labelLookup = new Map(LABELS.flatMap(([canonical, aliases]) => aliases.map((alias) => [alias.toLowerCase(), canonical])));
const labelPattern = [...labelLookup.keys()].sort((a, b) => b.length - a.length).map(escapeRegExp).join("|");
const legacyFilmSimulationPattern = /^(?:provia|velvia|astia|classic chrome|pro\s+neg\.?\s+(?:hi|std)|acros(?:\s*\+\s*[ryg])?|monochrome(?:\s*\+\s*[ryg])?|sepia|eterna(?:\s+bleach\s+bypass)?|classic negative|nostalgic negative|reala ace)$/i;

const sleep = (ms) => new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
const normalize = (value = "") => value.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
const plainTitle = (value = "") => normalize(cheerio.load(`<span>${value}</span>`)("span").text());
const objectNames = (value) => Object.values(value ?? {}).map((entry) => typeof entry === "string" ? entry : entry.name).filter(Boolean).map(normalize);
const sourceUrl = (value = "") => value.replace(/&amp;|&#0*38;/g, "&");
const isSourceImage = (value) => {
  try { return ["i0.wp.com", "fujixweekly.com"].includes(new URL(value).hostname); } catch { return false; }
};
const atomicWrite = async (path, value) => {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`);
  await rename(temporary, path);
};

function linesFromBlock(html) {
  const withBreaks = html
    .replace(/<br\s*\/?\s*>/gi, "\n")
    .replace(/<\/(?:p|li|tr|div|h[1-6]|td|th)>/gi, "\n");
  return cheerio.load(`<section>${withBreaks}</section>`)("section").text().split("\n").map((line) => normalize(line).replace(/^[•·\-]\s*/, "")).filter(Boolean);
}

function settingsFromBlock(html) {
  const settings = [];
  const lines = linesFromBlock(html);
  let firstSettingLine = -1;
  for (const [index, line] of lines.entries()) {
    const pattern = new RegExp(`(?:^|\\s)(${labelPattern})\\s*:\\s*(.*?)(?=\\s+(?:${labelPattern})\\s*:|$)`, "gi");
    for (const match of line.matchAll(pattern)) {
      const label = labelLookup.get(match[1].toLowerCase());
      const value = normalize(match[2]).replace(/[.]+$/, "");
      if (label && value && !settings.some((setting) => setting.label === label)) {
        settings.push({ label, value });
        if (firstSettingLine === -1) firstSettingLine = index;
      }
    }
  }
  if (!settings.some((setting) => setting.label === "Film Simulation") && settings.length >= 5 && firstSettingLine > 0) {
    const filmSimulation = lines[firstSettingLine - 1];
    if (!filmSimulation.includes(":") && filmSimulation.split("/").every((value) => legacyFilmSimulationPattern.test(normalize(value)))) {
      settings.unshift({ label: "Film Simulation", value: filmSimulation });
    }
  }
  return settings;
}

export function extractSettings(html) {
  const $ = cheerio.load(`<main>${html}</main>`);
  const blocks = $("main").find("p, li, td, th, div").filter((_, block) => !$(block).is("div") || !$(block).find("p, li, td, th, div").length).toArray();
  const settings = [];
  for (const block of blocks.length ? blocks : [$("main").get(0)]) {
    for (const setting of settingsFromBlock($(block).html() ?? "")) {
      if (!settings.some((existing) => existing.label === setting.label)) settings.push(setting);
    }
  }
  return settings;
}

export function extractExampleImages(html) {
  const $ = cheerio.load(`<main>${html}</main>`);
  const root = $("main");
  const marker = root.find("h1, h2, h3, h4, h5, h6, p").filter((_, element) => /^Example (?:photographs?|images?)\b/i.test(normalize($(element).text()).replace(/:$/, ""))).first();
  if (!marker.length) return [];

  const images = [];
  let sectionNode = marker;
  while ((sectionNode = sectionNode.next()).length) {
    if (sectionNode.is("h1, h2, h3, h4, h5, h6")) break;
    sectionNode.find("img").addBack("img").each((_, element) => {
      const image = $(element);
      const url = sourceUrl(image.attr("data-orig-file") || image.attr("data-large-file") || image.attr("src") || "");
      if (!isSourceImage(url) || images.some((entry) => entry.sourceUrl === url)) return;
      images.push({
        sourceUrl: url,
        alt: normalize(image.attr("alt") ?? ""),
        caption: normalize(image.closest("figure").find("figcaption").text()),
      });
    });
  }
  return images;
}

export function cameraGeneration(title, html) {
  const data = `${title} ${html}`.toLowerCase();
  if (/fifth-gen|5th-gen|x-trans v|x-trans 5/.test(data)) return "X-Trans V";
  if (/fourth-gen|4th-gen|x-trans iv|x-trans 4/.test(data)) return "X-Trans IV";
  if (/third-gen|3rd-gen|x-trans iii|x-trans 3/.test(data)) return "X-Trans III";
  if (/second-gen|2nd-gen|x-trans ii|x-trans 2/.test(data)) return "X-Trans II";
  if (/first-gen|1st-gen|x-trans i|x-trans 1/.test(data)) return "X-Trans I";
  if (/\bgfx\b/.test(data)) return "GFX";
  return "See source";
}

export function recipeFromPost(post) {
  const settings = extractSettings(post.content ?? "");
  if (!settings.some((setting) => setting.label === "Film Simulation") || settings.length < 5) return null;
  return {
    id: `fujixweekly:${post.ID}`,
    sourceUrl: post.URL,
    title: plainTitle(post.title),
    publishedAt: post.date,
    modifiedAt: post.modified,
    cameraGeneration: cameraGeneration(post.title, post.content),
    categories: objectNames(post.categories),
    tags: objectNames(post.tags),
    settings,
    exampleImages: extractExampleImages(post.content ?? ""),
  };
}

function metadataFromPost(post) {
  return {
    sourceUrl: post.URL,
    title: plainTitle(post.title),
    publishedAt: post.date,
    modifiedAt: post.modified,
    categories: objectNames(post.categories),
    tags: objectNames(post.tags),
  };
}

export function emptyState() {
  return { version: 3, source: "https://fujixweekly.com", posts: {} };
}

function classifiedPost(post, recipe) {
  return {
    ...metadataFromPost(post),
    status: recipe ? "recipe" : "not_recipe",
    recipeParserVersion: RECIPE_PARSER_VERSION,
    ...(recipe ? { recipe, imageParserVersion: IMAGE_PARSER_VERSION } : {}),
  };
}

async function requestJson(url, fetchImpl) {
  const response = await fetchImpl(url, { headers: { "User-Agent": USER_AGENT } });
  if (!response.ok) throw new Error(`${response.status} fetching ${url}`);
  return response.json();
}

async function listPosts(fetchImpl, delayMs) {
  const posts = [];
  let page = 1;
  let found = Infinity;
  while (posts.length < found) {
    const url = `${API}/?number=${PAGE_SIZE}&page=${page}&fields=ID,URL,title,date,modified,tags,categories`;
    const result = await requestJson(url, fetchImpl);
    const entries = result.posts ?? [];
    posts.push(...entries);
    found = Number(result.found ?? posts.length);
    if (!entries.length) break;
    page += 1;
    if (posts.length < found) await sleep(delayMs);
  }
  return [...new Map(posts.map((post) => [String(post.ID), post])).values()];
}

async function readState(path) {
  return readFile(path, "utf8").then(JSON.parse).catch((error) => error.code === "ENOENT" ? emptyState() : Promise.reject(error));
}

function recipesFromState(state) {
  return Object.values(state.posts)
    .filter((post) => post.status === "recipe" && post.recipe)
    .map((post) => post.recipe)
    .sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime());
}

export async function refreshMissingExampleImages({ fetchImpl = fetch, delayMs = DEFAULT_DELAY, statePath = STATE_PATH, recipePath = RECIPE_PATH, onProgress } = {}) {
  if (!Number.isFinite(delayMs) || delayMs < 500) throw new Error("--delay must be at least 500 milliseconds.");
  const state = await readState(statePath);
  state.version = 3;
  const pending = Object.entries(state.posts).filter(([, post]) => post.status === "recipe" && post.imageParserVersion !== IMAGE_PARSER_VERSION);

  for (let index = 0; index < pending.length; index += 1) {
    const [id] = pending[index];
    const detail = await requestJson(`${API}/${encodeURIComponent(id)}?fields=ID,URL,title,date,modified,content,tags,categories`, fetchImpl);
    const recipe = recipeFromPost(detail);
    state.posts[id] = classifiedPost(detail, recipe);
    state.updatedAt = new Date().toISOString();
    await atomicWrite(statePath, state);
    await atomicWrite(recipePath, recipesFromState(state));
    onProgress?.({ id, processed: index + 1, total: pending.length, status: state.posts[id].status });
    if (index < pending.length - 1) await sleep(delayMs);
  }

  const recipes = recipesFromState(state);
  await atomicWrite(statePath, state);
  await atomicWrite(recipePath, recipes);
  return { processed: pending.length, recipes: recipes.length };
}

export async function syncRecipes({ fetchImpl = fetch, delayMs = DEFAULT_DELAY, statePath = STATE_PATH, recipePath = RECIPE_PATH, onProgress } = {}) {
  if (!Number.isFinite(delayMs) || delayMs < 500) throw new Error("--delay must be at least 500 milliseconds.");
  const state = await readState(statePath);
  state.version = 3;
  const sourcePosts = await listPosts(fetchImpl, delayMs);
  const seen = new Set(sourcePosts.map((post) => String(post.ID)));
  let processed = 0;

  for (const sourcePost of sourcePosts) {
    const id = String(sourcePost.ID);
    const current = state.posts[id];
    const needsImageRefresh = current?.status === "recipe" && current.imageParserVersion !== IMAGE_PARSER_VERSION;
    const needsRecipeReclassification = current?.status === "not_recipe" && current.recipeParserVersion !== RECIPE_PARSER_VERSION;
    if (current?.modifiedAt === sourcePost.modified && !needsImageRefresh && !needsRecipeReclassification) continue;
    const detail = await requestJson(`${API}/${encodeURIComponent(id)}?fields=ID,URL,title,date,modified,content,tags,categories`, fetchImpl);
    const recipe = recipeFromPost(detail);
    state.posts[id] = classifiedPost(detail, recipe);
    processed += 1;
    state.updatedAt = new Date().toISOString();
    await atomicWrite(statePath, state);
    await atomicWrite(recipePath, recipesFromState(state));
    onProgress?.({ id, processed, total: sourcePosts.length, status: state.posts[id].status });
    if (processed < sourcePosts.length) await sleep(delayMs);
  }

  for (const id of Object.keys(state.posts)) if (!seen.has(id)) delete state.posts[id];
  state.updatedAt = new Date().toISOString();
  const recipes = recipesFromState(state);
  await atomicWrite(statePath, state);
  await atomicWrite(recipePath, recipes);
  return { discovered: sourcePosts.length, processed, recipes: recipes.length };
}

export async function main(args = process.argv.slice(2)) {
  const delayArg = args.find((arg) => arg.startsWith("--delay="));
  const delayMs = Number(delayArg?.slice("--delay=".length) ?? DEFAULT_DELAY);
  const imageRefreshOnly = args.includes("--refresh-images");
  const result = await (imageRefreshOnly ? refreshMissingExampleImages : syncRecipes)({ delayMs, onProgress: ({ processed, total, status }) => console.log(`[${processed}/${total}] ${status}`) });
  console.log(imageRefreshOnly
    ? `Refreshed example photos for ${result.recipes} recipes (${result.processed} fetched).`
    : `Synced ${result.recipes} recipes from ${result.discovered} Fuji X Weekly posts (${result.processed} fetched).`);
}
