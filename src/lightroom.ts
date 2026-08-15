import { strToU8, zipSync } from "fflate";
import type { Recipe } from "./types";

type FilmSimulation = {
  canonical: string;
  cameraProfile: string;
  aliases: string[];
};

export type SkippedRecipe = {
  recipe: Recipe;
  filmSimulation: string;
  reason: "missing-film-simulation" | "unsupported-film-simulation";
};

export type PresetFile = {
  path: string;
  content: string;
  recipe: Recipe;
  filmSimulation: string;
};

export type LightroomPresetCollection = {
  files: PresetFile[];
  skipped: SkippedRecipe[];
};

const filmSimulations: FilmSimulation[] = [
  { canonical: "Provia/Standard", cameraProfile: "Camera PROVIA/STANDARD", aliases: ["provia", "provia/std", "provia/standard"] },
  { canonical: "Velvia/Vivid", cameraProfile: "Camera VELVIA/VIVID", aliases: ["velvia", "velvia/vivid"] },
  { canonical: "Astia/Soft", cameraProfile: "Camera ASTIA/SOFT", aliases: ["astia", "astia/soft"] },
  { canonical: "Classic Chrome", cameraProfile: "Camera CLASSIC CHROME", aliases: ["classic chrome"] },
  { canonical: "PRO Neg. Hi", cameraProfile: "Camera PRO Neg. Hi", aliases: ["pro neg hi", "pro neg. hi", "pro neg/hi"] },
  { canonical: "PRO Neg. Std", cameraProfile: "Camera PRO Neg. Std", aliases: ["pro neg std", "pro neg. std", "pro neg/std"] },
  { canonical: "Eterna/Cinema", cameraProfile: "Camera ETERNA/CINEMA", aliases: ["eterna", "eterna/cinema"] },
  { canonical: "Eterna Bleach Bypass", cameraProfile: "Camera BLEACH BYPASS", aliases: ["eterna bleach bypass", "bleach bypass"] },
  { canonical: "Classic Neg", cameraProfile: "Camera CLASSIC Neg", aliases: ["classic neg", "classic negative"] },
  { canonical: "Nostalgic Neg", cameraProfile: "Camera NOSTALGIC Neg", aliases: ["nostalgic neg", "nostalgic negative"] },
  { canonical: "Reala Ace", cameraProfile: "Camera REALA ACE", aliases: ["reala ace"] },
  { canonical: "Acros", cameraProfile: "Camera ACROS", aliases: ["acros"] },
  { canonical: "Acros+Ye", cameraProfile: "Camera ACROS+Ye", aliases: ["acros+ye", "acros+y", "acros+yellow"] },
  { canonical: "Acros+R", cameraProfile: "Camera ACROS+R", aliases: ["acros+r", "acros+red"] },
  { canonical: "Acros+G", cameraProfile: "Camera ACROS+G", aliases: ["acros+g", "acros+green"] },
  { canonical: "Monochrome", cameraProfile: "Camera MONOCHROME", aliases: ["monochrome", "mono"] },
  { canonical: "Monochrome+Ye", cameraProfile: "Camera MONOCHROME+Ye", aliases: ["monochrome+ye", "monochrome+y", "mono+ye", "mono+y", "monochrome+yellow"] },
  { canonical: "Monochrome+R", cameraProfile: "Camera MONOCHROME+R", aliases: ["monochrome+r", "mono+r", "monochrome+red"] },
  { canonical: "Monochrome+G", cameraProfile: "Camera MONOCHROME+G", aliases: ["monochrome+g", "mono+g", "monochrome+green"] },
  { canonical: "Sepia", cameraProfile: "Camera Sepia", aliases: ["sepia"] },
];

function normalized(value: string) {
  return value.toLowerCase()
    .replace(/[‐–—]/g, "-")
    .replace(/\s*\+\s*/g, "+")
    .replace(/\s+/g, " ")
    .trim();
}

function filmSimulationFromValue(value: string) {
  const source = normalized(value);
  return filmSimulations.find((simulation) => simulation.aliases.some((alias) => {
    const normalizedAlias = normalized(alias);
    return source === normalizedAlias || new RegExp(`^${escapeRegExp(normalizedAlias)}(?=\\.|$)`).test(source);
  }));
}

/** Returns a known Fuji simulation, including legacy aliases, or null for ambiguous values. */
export function normalizeFilmSimulation(value: string) {
  return filmSimulationFromValue(value)?.canonical ?? null;
}

function escapeRegExp(value: string) { return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
function escapeXml(value: string) { return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;"); }
function clamp(value: number, minimum: number, maximum: number) { return Math.min(maximum, Math.max(minimum, value)); }
function settingsByLabel(recipe: Recipe) { return new Map(recipe.settings.map((setting) => [setting.label, setting.value])); }
function numberFromSetting(value: string | undefined) {
  const match = value?.match(/^[^\d+-]*([+-]?\d+(?:\.\d+)?)/);
  return match ? Number(match[1]) : null;
}
function settingNumber(settings: Map<string, string>, label: string) { return numberFromSetting(settings.get(label)); }
function stableId(value: string) {
  let first = 0x811c9dc5;
  let second = 0x01000193;
  for (const character of value) {
    first = Math.imul(first ^ character.charCodeAt(0), 0x01000193);
    second = Math.imul(second ^ character.charCodeAt(0), 0x27d4eb2d);
  }
  const hex = (number: number) => (number >>> 0).toString(16).padStart(8, "0");
  const valueHex = `${hex(first)}${hex(second)}${hex(first ^ 0xa5a5a5a5)}${hex(second ^ 0x5a5a5a5a)}`;
  return `${valueHex.slice(0, 8)}-${valueHex.slice(8, 12)}-5${valueHex.slice(13, 16)}-8${valueHex.slice(17, 20)}-${valueHex.slice(20, 32)}`;
}
function fileStem(recipe: Recipe) {
  const title = recipe.title.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 72) || "fuji-recipe";
  return `${title}--${recipe.id.replace(/[^a-z0-9]+/gi, "-")}`;
}
function csvValue(value: string) { return `"${value.replace(/"/g, '""')}"`; }

function grainSettings(value: string | undefined) {
  const source = normalized(value ?? "");
  if (!source || source.includes("off")) return { amount: 0, size: 25, frequency: 50 };
  const amount = source.includes("strong") ? 45 : source.includes("weak") ? 25 : 20;
  const size = source.includes("large") ? 55 : source.includes("small") ? 25 : 40;
  return { amount, size, frequency: 50 };
}

/** Builds a native-camera-profile Lightroom preset for one Fuji recipe. */
export function buildLightroomPreset(recipe: Recipe): PresetFile | SkippedRecipe {
  const settings = settingsByLabel(recipe);
  const sourceFilmSimulation = settings.get("Film Simulation");
  if (!sourceFilmSimulation) return { recipe, filmSimulation: "", reason: "missing-film-simulation" };
  const simulation = filmSimulationFromValue(sourceFilmSimulation);
  if (!simulation) return { recipe, filmSimulation: sourceFilmSimulation, reason: "unsupported-film-simulation" };

  const controls: Record<string, string | number> = {
    "crs:CameraProfile": simulation.cameraProfile,
    "crs:ProcessVersion": "11.0",
    "crs:Version": "16.3",
  };
  const temperature = settings.get("White Balance")?.match(/\b(\d{3,5})\s*K\b/i)?.[1];
  if (temperature) controls["crs:Temperature"] = clamp(Number(temperature), 2000, 50000);

  if (settings.has("Grain Effect")) {
    const grain = grainSettings(settings.get("Grain Effect"));
    controls["crs:GrainAmount"] = grain.amount;
    controls["crs:GrainSize"] = grain.size;
    controls["crs:GrainFrequency"] = grain.frequency;
  }
  const highlight = settingNumber(settings, "Highlight");
  if (highlight !== null) controls["crs:Highlights"] = clamp(highlight * 12, -100, 100);
  const shadow = settingNumber(settings, "Shadow");
  if (shadow !== null) controls["crs:Shadows"] = clamp(shadow * -12, -100, 100);
  const color = settingNumber(settings, "Color");
  if (color !== null) controls["crs:Vibrance"] = clamp(color * 10, -100, 100);
  const sharpness = settingNumber(settings, "Sharpness");
  if (sharpness !== null) controls["crs:Sharpness"] = clamp(40 + sharpness * 8, 0, 100);
  const clarity = settingNumber(settings, "Clarity");
  if (clarity !== null) controls["crs:Clarity2012"] = clamp(clarity * 10, -100, 100);

  const attributes = Object.entries(controls).map(([name, value]) => `    ${name}="${escapeXml(String(value))}"`).join("\n");
  const content = `<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/" x:xmptk="Fuji Pocket">
  <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
    <rdf:Description rdf:about=""
      xmlns:crs="http://ns.adobe.com/camera-raw-settings/1.0/"
      xmlns:dc="http://purl.org/dc/elements/1.1/"
      xmlns:fujiPocket="https://fuji-pocket.app/ns/1.0/"
      crs:PresetType="Normal"
      crs:Cluster="Fuji Pocket"
      crs:UUID="${stableId(recipe.id)}"
      fujiPocket:RecipeId="${escapeXml(recipe.id)}"
${attributes}>
      <crs:Name>${escapeXml(recipe.title)}</crs:Name>
      <dc:Identifier>${escapeXml(recipe.id)}</dc:Identifier>
    </rdf:Description>
  </rdf:RDF>
</x:xmpmeta>
<?xpacket end="w"?>
`;
  return { path: `Fuji Pocket Presets/${fileStem(recipe)}.xmp`, content, recipe, filmSimulation: simulation.canonical };
}

function readme(collection: LightroomPresetCollection) {
  return `# Fuji Pocket Lightroom Presets

This collection contains ${collection.files.length} recipe presets generated from Fuji X Weekly settings.

## Import

1. Download and unzip this archive.
2. In Lightroom Classic or Lightroom desktop, open Presets and choose **Import Presets**.
3. Select the XMP files in the \`Fuji Pocket Presets\` folder.
4. Apply a preset to a compatible Fujifilm RAF file.

## Compatibility and limits

- Each preset requests Lightroom's native Fujifilm Camera Matching profile. It works only if your RAF's camera model and Lightroom version expose that profile.
- Recipe settings are approximate adjustments after the native film-simulation base: Highlight is multiplied by 12, Shadow by -12, Color becomes Vibrance ×10, Sharpness starts at 40 and changes by 8 per Fuji step, and Clarity changes by 10 per Fuji step. Weak/Strong grain becomes 25/45 grain amount. Dynamic Range, Color Chrome, Color Chrome FX Blue, Fuji red/blue WB shifts, ISO, exposure compensation, and High ISO NR are deliberately not translated.
- These presets do not reproduce Fujifilm in-camera JPEG processing pixel-for-pixel.

${collection.skipped.length ? `## Skipped recipes\n\n${collection.skipped.length} recipe(s) have an ambiguous or unsupported film-simulation value. See \`unsupported-recipes.csv\`.\n` : ""}`;
}

function attribution() {
  return `# Attribution\n\nFuji Pocket researched Fujifilm simulation names and availability against https://github.com/abpy/FujifilmCameraProfiles. No LookTables, tone curves, LUTs, profiles, or other assets from that repository are included in this archive.\n`;
}

function skippedCsv(skipped: SkippedRecipe[]) {
  return ["recipe_id,title,film_simulation,reason,source_url", ...skipped.map(({ recipe, filmSimulation, reason }) => [recipe.id, recipe.title, filmSimulation, reason, recipe.sourceUrl].map(csvValue).join(","))].join("\n").concat("\n");
}

/** Builds all exportable presets and diagnostics without writing to disk. */
export function buildPresetCollection(recipes: Recipe[]): LightroomPresetCollection {
  const built = [...recipes].sort((left, right) => left.id.localeCompare(right.id)).map(buildLightroomPreset);
  const files = built.filter((entry): entry is PresetFile => "content" in entry);
  const skipped = built.filter((entry): entry is SkippedRecipe => "reason" in entry);
  return { files, skipped };
}

/** Creates a ZIP archive that can be downloaded directly in a browser. */
export function createPresetArchive(collection: LightroomPresetCollection) {
  const entries: Record<string, Uint8Array> = {
    "README.md": strToU8(readme(collection)),
    "ATTRIBUTION.md": strToU8(attribution()),
    "unsupported-recipes.csv": strToU8(skippedCsv(collection.skipped)),
  };
  for (const file of collection.files) entries[file.path] = strToU8(file.content);
  return zipSync(entries, { level: 6 });
}
