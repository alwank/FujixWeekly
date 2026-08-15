import { useEffect, useMemo, useState } from "react";
import { buildPresetCollection, createPresetArchive } from "./lightroom";
import type { Recipe } from "./types";

const SAVED_KEY = "fuji-pocket-saved";
const HOME_URL = import.meta.env.BASE_URL;

type ExposureReferenceTable = {
  title: string;
  summary: string;
  rows: { setting: string; effect: string; bestFor: string }[];
};

const EXPOSURE_REFERENCE_TABLES: ExposureReferenceTable[] = [
  { title: "Aperture", summary: "Depth of field", rows: [
    { setting: "f/1.4", effect: "Most light · very shallow focus", bestFor: "Low light, strong subject isolation" },
    { setting: "f/1.8", effect: "Very wide · shallow focus", bestFor: "Portraits and indoor scenes" },
    { setting: "f/2.8", effect: "Wide · shallow focus", bestFor: "Portraits and events" },
    { setting: "f/4", effect: "Balanced · moderate depth", bestFor: "Travel and handheld shooting" },
    { setting: "f/5.6", effect: "Less light · moderate depth", bestFor: "Street, small groups" },
    { setting: "f/8", effect: "Narrow · deeper focus", bestFor: "Landscapes and groups" },
    { setting: "f/11", effect: "Narrow · deep focus", bestFor: "Landscape and architecture" },
    { setting: "f/16", effect: "Least light · very deep focus", bestFor: "Sunstars and expansive scenes" },
  ] },
  { title: "Shutter speed", summary: "Motion", rows: [
    { setting: "1/2000s", effect: "Very little light · freezes fast action", bestFor: "Birds, sports, splashes" },
    { setting: "1/1000s", effect: "Freezes most action", bestFor: "Sports, pets, children" },
    { setting: "1/500s", effect: "Freezes everyday movement", bestFor: "Cyclists and people walking" },
    { setting: "1/250s", effect: "Limits subject movement", bestFor: "Street and telephoto handheld" },
    { setting: "1/125s", effect: "General handheld speed", bestFor: "Travel and posed subjects" },
    { setting: "1/60s", effect: "Motion may begin to blur", bestFor: "Indoors and wide lenses" },
    { setting: "1/30s", effect: "Visible movement", bestFor: "Panning or stabilised handheld" },
    { setting: "1/15s", effect: "Strong motion blur", bestFor: "Creative blur or tripod work" },
    { setting: "1/4s", effect: "Flowing movement", bestFor: "Water and tripod work" },
    { setting: "1s", effect: "Long exposure", bestFor: "Light trails and night scenes" },
  ] },
  { title: "ISO", summary: "Brightness and noise", rows: [
    { setting: "Base", effect: "Cleanest file · most dynamic range", bestFor: "Bright light and tripod work" },
    { setting: "200", effect: "Very low noise", bestFor: "Overcast light and open shade" },
    { setting: "400", effect: "Low noise", bestFor: "Cloudy days and golden hour" },
    { setting: "800", effect: "Some noise in shadows", bestFor: "Window light and bright interiors" },
    { setting: "1600", effect: "Visible shadow noise", bestFor: "Indoor events and evening" },
    { setting: "3200", effect: "Noticeable noise", bestFor: "Dim interiors and night handheld" },
    { setting: "6400", effect: "Strong noise · reduced detail", bestFor: "Very low light when sharpness matters" },
  ] },
];

function useSaved() {
  const [saved, setSaved] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem(SAVED_KEY) ?? "[]"); } catch { return []; }
  });
  useEffect(() => localStorage.setItem(SAVED_KEY, JSON.stringify(saved)), [saved]);
  return [saved, (id: string) => setSaved((all) => all.includes(id) ? all.filter((entry) => entry !== id) : [...all, id])] as const;
}

const Icon = ({ name }: { name: "spark" | "bookmark" | "search" | "download" | "learn" | "arrow" }) => <span aria-hidden="true" className={`icon icon-${name}`} />;

export default function App() {
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [query, setQuery] = useState("");
  const [generation, setGeneration] = useState("All cameras");
  const [tab, setTab] = useState<"discover" | "saved" | "learn">("discover");
  const [selected, setSelected] = useState<Recipe | null>(null);
  const [saved, toggleSaved] = useSaved();
  const [downloadMessage, setDownloadMessage] = useState("");

  useEffect(() => { fetch(`${import.meta.env.BASE_URL}data/recipes.json`).then((r) => r.json()).then(setRecipes).catch(() => setRecipes([])); }, []);
  const generations = ["All cameras", ...Array.from(new Set(recipes.map((r) => r.cameraGeneration))).sort()];
  const shown = useMemo(() => recipes.filter((recipe) => {
    const haystack = `${recipe.title} ${recipe.categories.join(" ")} ${recipe.tags.join(" ")} ${recipe.settings.map((s) => `${s.label} ${s.value}`).join(" ")}`.toLowerCase();
    return (tab === "discover" || saved.includes(recipe.id)) && (generation === "All cameras" || recipe.cameraGeneration === generation) && haystack.includes(query.toLowerCase());
  }), [recipes, query, generation, tab, saved]);
  const featured = shown[0];
  const isLearn = tab === "learn";
  const downloadPresets = () => {
    const collection = buildPresetCollection(recipes);
    const archive = createPresetArchive(collection);
    const url = URL.createObjectURL(new Blob([archive], { type: "application/zip" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "fuji-pocket-lightroom-presets.zip";
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
    setDownloadMessage(`Downloaded ${collection.files.length} presets${collection.skipped.length ? `; ${collection.skipped.length} skipped` : ""}.`);
  };

  return <main className="app-shell">
    <header className="topbar"><a className="brand" href={HOME_URL} aria-label="Fuji Pocket home">FUJI<span>·</span>POCKET</a><button className="download-button" type="button" onClick={downloadPresets} disabled={!recipes.length}><Icon name="download" />Download Lightroom presets</button></header>
    {downloadMessage && <p className="download-status" role="status">{downloadMessage}</p>}
    <section className="intro"><p className="eyebrow">{isLearn ? "Camera fundamentals" : "Personal recipe companion"}</p><h1>{isLearn ? <>Read the light.<br /><em>Make</em> the picture.</> : <>Find a look<br /><em>before</em> you shoot.</>}</h1><p className="subtle">{isLearn ? "A practical guide to balancing brightness, motion, depth, and image quality." : "Search a source-linked collection, then keep your go-to settings close at hand."}</p></section>
    <nav className="tabs" aria-label="Fuji Pocket views"><button className={tab === "discover" ? "selected" : ""} onClick={() => setTab("discover")} aria-current={tab === "discover" ? "page" : undefined}><Icon name="spark" />Discover</button><button className={tab === "saved" ? "selected" : ""} onClick={() => setTab("saved")} aria-current={tab === "saved" ? "page" : undefined}><Icon name="bookmark" />Saved <small>{saved.length}</small></button><button className={tab === "learn" ? "selected" : ""} onClick={() => setTab("learn")} aria-current={tab === "learn" ? "page" : undefined}><Icon name="learn" />Learn</button></nav>
    {isLearn ? <LearnPage /> : <>
      <div className="search-wrap"><Icon name="search" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search mood, film sim, or recipe" aria-label="Search recipes" /></div>
      <div className="filters" aria-label="Camera compatibility">{generations.map((item) => <button key={item} className={generation === item ? "filter active" : "filter"} onClick={() => setGeneration(item)}>{item}</button>)}</div>
      {shown.length > 0 ? <section className="content">
      {tab === "discover" && featured && <button className="feature-card" onClick={() => setSelected(featured)}><div><p className="eyebrow">Latest recipe</p><h2>{featured.title}</h2><p>{featured.settings.slice(0, 3).map((setting) => `${setting.label}: ${setting.value}`).join(" · ")}</p><span className="generation">{featured.cameraGeneration}</span></div><Icon name="arrow" /></button>}
      <div className="section-heading"><h2>{tab === "saved" ? "Your saved recipes" : "Explore all recipes"}</h2><span>{shown.length}</span></div>
      <div className="recipe-list">{shown.slice(tab === "discover" ? 1 : 0).map((recipe) => <RecipeRow key={recipe.id} recipe={recipe} isSaved={saved.includes(recipe.id)} onOpen={() => setSelected(recipe)} onSave={() => toggleSaved(recipe.id)} />)}</div>
      </section> : <section className="empty"><Icon name="bookmark" /><h2>{recipes.length ? "Nothing matched that search." : "Your collection is ready to sync."}</h2><p>{recipes.length ? "Try a different camera generation or a broader search." : "Run the source-linked recipe sync to begin the backfill."}</p><code>npm run import</code></section>}
    </>}
    {selected && <RecipeSheet recipe={selected} isSaved={saved.includes(selected.id)} onClose={() => setSelected(null)} onSave={() => toggleSaved(selected.id)} />}
  </main>;
}

function LearnPage() {
  return <section className="learn-content" aria-label="Exposure triangle cheat sheet">
    <section className="triangle-card" aria-labelledby="triangle-title">
      <p className="eyebrow">Exposure triangle</p>
      <h2 id="triangle-title">Three controls.<br />One exposure.</h2>
      <p>Balance light with the setting that best serves the picture you want to make.</p>
      <div className="exposure-triangle" aria-label="Aperture, shutter speed, and ISO make up the exposure triangle">
        <svg viewBox="0 0 340 220" aria-hidden="true" focusable="false">
          <path d="M170 29 48 190h244Z" />
          <path className="triangle-spoke" d="M170 119 170 29M170 119 48 190M170 119 292 190" />
          <circle cx="170" cy="119" r="27" />
        </svg>
        <span className="triangle-side triangle-aperture"><b>Aperture</b><small>Depth</small></span>
        <span className="triangle-side triangle-shutter"><b>Shutter</b><small>Motion</small></span>
        <span className="triangle-side triangle-iso"><b>ISO</b><small>Noise</small></span>
        <span className="triangle-center">Light</span>
      </div>
    </section>

    <section className="learn-section" aria-labelledby="controls-title">
      <div className="learn-heading"><p className="eyebrow">Quick reference</p><h2 id="controls-title">Set what matters first.</h2></div>
      <div className="control-grid">
        <article className="control-card"><span className="control-number">01</span><h3>Aperture</h3><p>Controls how much is in focus.</p><dl><div><dt>Wide</dt><dd>f/1.4–f/2.8 · soft background</dd></div><div><dt>Deep</dt><dd>f/8–f/11 · more scene sharp</dd></div></dl></article>
        <article className="control-card"><span className="control-number">02</span><h3>Shutter speed</h3><p>Controls how movement appears.</p><dl><div><dt>Fast</dt><dd>1/500s+ · freeze action</dd></div><div><dt>Slow</dt><dd>1/30s or less · show motion</dd></div></dl></article>
        <article className="control-card"><span className="control-number">03</span><h3>ISO</h3><p>Brightens the image at a quality cost.</p><dl><div><dt>Low</dt><dd>Base ISO · cleanest file</dd></div><div><dt>High</dt><dd>1600+ · more visible noise</dd></div></dl></article>
      </div>
    </section>

    <section className="learn-section reference-section" aria-labelledby="reference-title">
      <div className="learn-heading"><p className="eyebrow">Settings reference</p><h2 id="reference-title">Know the useful range.</h2></div>
      <div className="reference-table-list">{EXPOSURE_REFERENCE_TABLES.map((table) => <ExposureTable key={table.title} table={table} />)}</div>
    </section>

    <section className="stop-card" aria-labelledby="stops-title"><p className="eyebrow">The stop rule</p><h2 id="stops-title">Every stop doubles or halves the light.</h2><p>Want a faster shutter without darkening the image? Open the aperture one stop or double the ISO one stop.</p><div className="stop-example"><span>f/5.6</span><i>→</i><span>f/4</span><b>+1 stop</b></div><div className="stop-example"><span>1/250s</span><i>→</i><span>1/500s</span><b>−1 stop</b></div></section>

    <section className="learn-section" aria-labelledby="scenes-title"><div className="learn-heading"><p className="eyebrow">Scene starters</p><h2 id="scenes-title">Pick a priority, then balance.</h2></div><div className="scene-grid">
      <article><h3>Portrait</h3><p>Soft background</p><span>f/1.8–f/2.8 · 1/125s+ · low ISO</span></article>
      <article><h3>Action</h3><p>Freeze movement</p><span>1/1000s+ · open aperture · Auto ISO</span></article>
      <article><h3>Landscape</h3><p>Front-to-back detail</p><span>f/8–f/11 · base ISO · tripod if needed</span></article>
      <article><h3>Low light</h3><p>Handheld and sharp</p><span>wide aperture · 1/60s+ · raise ISO</span></article>
    </div></section>

    <section className="decision-card" aria-labelledby="decision-title"><p className="eyebrow">A simple workflow</p><h2 id="decision-title">Decide in this order.</h2><ol><li><span>1</span><p><b>Name the priority.</b> Background blur, motion, or image quality?</p></li><li><span>2</span><p><b>Set aperture or shutter.</b> Choose the setting that creates that effect.</p></li><li><span>3</span><p><b>Let ISO finish the balance.</b> Raise it only as far as the light requires.</p></li></ol></section>

    <a className="learn-source-link" href="https://photographyicon.com/exposure-triangle-cheat-sheet/" target="_blank" rel="noreferrer">Further reading: Photography Icon’s exposure triangle reference <Icon name="arrow" /></a>
  </section>;
}

function ExposureTable({ table }: { table: ExposureReferenceTable }) {
  return <div className="reference-table-card">
    <table>
      <caption><span>{table.title}</span><small>{table.summary}</small></caption>
      <thead><tr><th scope="col">Setting</th><th scope="col">Effect</th><th scope="col">Best for</th></tr></thead>
      <tbody>{table.rows.map((row) => <tr key={row.setting}><th scope="row">{row.setting}</th><td>{row.effect}</td><td>{row.bestFor}</td></tr>)}</tbody>
    </table>
  </div>;
}

function RecipeRow({ recipe, isSaved, onOpen, onSave }: { recipe: Recipe; isSaved: boolean; onOpen: () => void; onSave: () => void }) {
  return <article className="recipe-row"><button className="recipe-copy" onClick={onOpen}><span className="generation">{recipe.cameraGeneration}</span><h3>{recipe.title}</h3><p>{recipe.settings.slice(0, 2).map((setting) => `${setting.label}: ${setting.value}`).join(" · ")}</p></button><button className={isSaved ? "save saved" : "save"} onClick={onSave} aria-label={`${isSaved ? "Remove" : "Save"} ${recipe.title}`}><Icon name="bookmark" /></button></article>;
}

function RecipeSheet({ recipe, isSaved, onClose, onSave }: { recipe: Recipe; isSaved: boolean; onClose: () => void; onSave: () => void }) {
  const exampleImages = recipe.exampleImages ?? [];
  return <div className="overlay" role="presentation" onMouseDown={onClose}>
    <section className="sheet" role="dialog" aria-modal="true" aria-label={recipe.title} onMouseDown={(event) => event.stopPropagation()}>
      <div className="sheet-handle" />
      <div className="sheet-top"><span className="generation">{recipe.cameraGeneration}</span><button className={isSaved ? "save saved" : "save"} onClick={onSave} aria-label="Save recipe"><Icon name="bookmark" /></button></div>
      <h2>{recipe.title}</h2>
      <div className="settings-grid">{recipe.settings.map((setting) => <div key={setting.label}><dt>{setting.label}</dt><dd>{setting.value}</dd></div>)}</div>
      {exampleImages.length > 0 && <section className="photo-gallery" aria-label="Example photographs">
        <div className="gallery-heading"><span>Example photographs</span><span>{exampleImages.length}</span></div>
        <div className="gallery-grid">{exampleImages.map((image, index) => <figure key={image.sourceUrl}><img src={image.sourceUrl} alt={image.alt || `Example photograph ${index + 1}`} loading="lazy" decoding="async" /><figcaption>{image.caption || `Photograph ${index + 1}`}</figcaption></figure>)}</div>
      </section>}
      <a className="source-link" href={recipe.sourceUrl} target="_blank" rel="noreferrer">Read the original on Fuji X Weekly <Icon name="arrow" /></a>
    </section>
  </div>;
}
