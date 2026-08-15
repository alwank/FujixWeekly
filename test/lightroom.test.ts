import assert from "node:assert/strict";
import test from "node:test";
import { XMLParser } from "fast-xml-parser";
import { strFromU8, unzipSync } from "fflate";
import { buildLightroomPreset, buildPresetCollection, createPresetArchive, normalizeFilmSimulation } from "../src/lightroom";
import type { Recipe } from "../src/types";

const recipe = (overrides: Partial<Recipe> = {}): Recipe => ({
  id: "fujixweekly:42",
  title: "A <Classic> Recipe & More",
  sourceUrl: "https://fujixweekly.com/example/",
  publishedAt: "2026-01-01T00:00:00Z",
  modifiedAt: "2026-01-01T00:00:00Z",
  cameraGeneration: "X-Trans V",
  categories: [],
  tags: [],
  exampleImages: [],
  settings: [
    { label: "Film Simulation", value: "Classic Negative. Legacy source prose follows" },
    { label: "White Balance", value: "5000K, +1 Red & -2 Blue" },
    { label: "Grain Effect", value: "Weak, Small" },
    { label: "Highlight", value: "+2" },
    { label: "Shadow", value: "+1" },
    { label: "Color", value: "-2" },
    { label: "Sharpness", value: "-1" },
    { label: "Clarity", value: "+2" },
    { label: "Dynamic Range", value: "DR400" },
    { label: "Color Chrome Effect", value: "Strong" },
    { label: "High ISO NR", value: "-4" },
  ],
  ...overrides,
});

test("canonicalizes every supported Lightroom Camera Matching simulation", () => {
  const cases = [
    ["Provia/STD", "Provia/Standard"], ["Velvia", "Velvia/Vivid"], ["Astia", "Astia/Soft"], ["Classic Chrome", "Classic Chrome"],
    ["Pro Neg. Hi", "PRO Neg. Hi"], ["Pro Neg Std", "PRO Neg. Std"], ["Eterna", "Eterna/Cinema"], ["Eterna Bleach Bypass", "Eterna Bleach Bypass"],
    ["Classic Negative", "Classic Neg"], ["Nostalgic Negative", "Nostalgic Neg"], ["Reala Ace", "Reala Ace"], ["Acros", "Acros"],
    ["Acros+Ye", "Acros+Ye"], ["Acros + R", "Acros+R"], ["Acros+G", "Acros+G"], ["Monochrome", "Monochrome"],
    ["Monochrome + Ye", "Monochrome+Ye"], ["Mono+R", "Monochrome+R"], ["Mono+G", "Monochrome+G"], ["Sepia", "Sepia"],
  ];
  for (const [source, expected] of cases) assert.equal(normalizeFilmSimulation(source), expected, source);
  assert.equal(normalizeFilmSimulation("Classic Negative. Additional source explanation"), "Classic Neg");
  assert.equal(normalizeFilmSimulation("Any (See Below)"), null);
  assert.equal(normalizeFilmSimulation("Acros (including +Ye, +R, or +G)"), null);
});

test("generates structurally valid XMP using only approved conservative controls", () => {
  const preset = buildLightroomPreset(recipe());
  assert.ok("content" in preset);
  if (!("content" in preset)) return;
  assert.equal(preset.filmSimulation, "Classic Neg");
  assert.match(preset.content, /crs:CameraProfile="Camera CLASSIC Neg"/);
  assert.match(preset.content, /crs:Temperature="5000"/);
  assert.match(preset.content, /crs:Highlights="24"/);
  assert.match(preset.content, /crs:Shadows="-12"/);
  assert.match(preset.content, /crs:Vibrance="-20"/);
  assert.match(preset.content, /crs:Sharpness="32"/);
  assert.match(preset.content, /crs:Clarity2012="20"/);
  assert.match(preset.content, /crs:GrainAmount="25"/);
  assert.match(preset.content, /A &lt;Classic&gt; Recipe &amp; More/);
  assert.doesNotMatch(preset.content, /DynamicRange|ColorChrome|NoiseReduction|Exposure/);
  assert.doesNotThrow(() => new XMLParser({ ignoreAttributes: false }).parse(preset.content));
});

test("builds a deterministic archive and reports skipped recipes", () => {
  const unsupported = recipe({ id: "fujixweekly:99", title: "Ambiguous recipe", settings: [{ label: "Film Simulation", value: "Any (See Below)" }] });
  const first = buildPresetCollection([unsupported, recipe()]);
  const second = buildPresetCollection([recipe(), unsupported]);
  assert.deepEqual(first.files.map((file) => file.path), second.files.map((file) => file.path));
  assert.equal(first.files.length, 1);
  assert.equal(first.skipped.length, 1);
  const archive = unzipSync(createPresetArchive(first));
  assert.deepEqual(Object.keys(archive).sort(), ["ATTRIBUTION.md", "README.md", "Fuji Pocket Presets/a-classic-recipe-more--fujixweekly-42.xmp", "unsupported-recipes.csv"].sort());
  assert.match(strFromU8(archive["README.md"]), /compatible Fujifilm RAF/i);
  assert.match(strFromU8(archive["unsupported-recipes.csv"]), /Any \(See Below\)/);
});
