import { useEffect, useMemo, useState } from "react";
import type { Recipe } from "./types";

const SAVED_KEY = "fuji-pocket-saved";
const HOME_URL = import.meta.env.BASE_URL;

function useSaved() {
  const [saved, setSaved] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem(SAVED_KEY) ?? "[]"); } catch { return []; }
  });
  useEffect(() => localStorage.setItem(SAVED_KEY, JSON.stringify(saved)), [saved]);
  return [saved, (id: string) => setSaved((all) => all.includes(id) ? all.filter((entry) => entry !== id) : [...all, id])] as const;
}

const Icon = ({ name }: { name: "spark" | "bookmark" | "search" | "settings" | "arrow" }) => <span aria-hidden="true" className={`icon icon-${name}`} />;

export default function App() {
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [query, setQuery] = useState("");
  const [generation, setGeneration] = useState("All cameras");
  const [tab, setTab] = useState<"discover" | "saved">("discover");
  const [selected, setSelected] = useState<Recipe | null>(null);
  const [saved, toggleSaved] = useSaved();

  useEffect(() => { fetch(`${import.meta.env.BASE_URL}data/recipes.json`).then((r) => r.json()).then(setRecipes).catch(() => setRecipes([])); }, []);
  const generations = ["All cameras", ...Array.from(new Set(recipes.map((r) => r.cameraGeneration))).sort()];
  const shown = useMemo(() => recipes.filter((recipe) => {
    const haystack = `${recipe.title} ${recipe.categories.join(" ")} ${recipe.tags.join(" ")} ${recipe.settings.map((s) => `${s.label} ${s.value}`).join(" ")}`.toLowerCase();
    return (tab === "discover" || saved.includes(recipe.id)) && (generation === "All cameras" || recipe.cameraGeneration === generation) && haystack.includes(query.toLowerCase());
  }), [recipes, query, generation, tab, saved]);
  const featured = shown[0];

  return <main className="app-shell">
    <header className="topbar"><a className="brand" href={HOME_URL} aria-label="Fuji Pocket home">FUJI<span>·</span>POCKET</a><button className="icon-button" aria-label="Open preferences"><Icon name="settings" /></button></header>
    <section className="intro"><p className="eyebrow">Personal recipe companion</p><h1>Find a look<br /><em>before</em> you shoot.</h1><p className="subtle">Search a source-linked collection, then keep your go-to settings close at hand.</p></section>
    <div className="search-wrap"><Icon name="search" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search mood, film sim, or recipe" aria-label="Search recipes" /></div>
    <div className="filters" aria-label="Camera compatibility">{generations.map((item) => <button key={item} className={generation === item ? "filter active" : "filter"} onClick={() => setGeneration(item)}>{item}</button>)}</div>
    <nav className="tabs" aria-label="Recipe views"><button className={tab === "discover" ? "selected" : ""} onClick={() => setTab("discover")}><Icon name="spark" />Discover</button><button className={tab === "saved" ? "selected" : ""} onClick={() => setTab("saved")}><Icon name="bookmark" />Saved <small>{saved.length}</small></button></nav>
    {shown.length > 0 ? <section className="content">
      {tab === "discover" && featured && <button className="feature-card" onClick={() => setSelected(featured)}><div><p className="eyebrow">Latest recipe</p><h2>{featured.title}</h2><p>{featured.settings.slice(0, 3).map((setting) => `${setting.label}: ${setting.value}`).join(" · ")}</p><span className="generation">{featured.cameraGeneration}</span></div><Icon name="arrow" /></button>}
      <div className="section-heading"><h2>{tab === "saved" ? "Your saved recipes" : "Explore all recipes"}</h2><span>{shown.length}</span></div>
      <div className="recipe-list">{shown.slice(tab === "discover" ? 1 : 0).map((recipe) => <RecipeRow key={recipe.id} recipe={recipe} isSaved={saved.includes(recipe.id)} onOpen={() => setSelected(recipe)} onSave={() => toggleSaved(recipe.id)} />)}</div>
    </section> : <section className="empty"><Icon name="bookmark" /><h2>{recipes.length ? "Nothing matched that search." : "Your collection is ready to sync."}</h2><p>{recipes.length ? "Try a different camera generation or a broader search." : "Run the source-linked recipe sync to begin the backfill."}</p><code>npm run import</code></section>}
    {selected && <RecipeSheet recipe={selected} isSaved={saved.includes(selected.id)} onClose={() => setSelected(null)} onSave={() => toggleSaved(selected.id)} />}
  </main>;
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
