# Fuji Pocket

Fuji Pocket is a source-linked, mobile-first companion for Fujifilm recipe settings. It stores recipe metadata, normalized camera settings, and remote URLs for example photographs, then directs readers to the original Fuji X Weekly post. It does not retain article bodies, excerpts, source photos, or downloaded media.

Live site: [lozijak.github.io/FujixWeekly](https://lozijak.github.io/FujixWeekly/)

## Run locally

```bash
npm install
npm run dev
```

## Recipe sync

`npm run import` performs a resumable, low-rate sync from Fuji X Weekly's public WordPress API. It inventories post metadata, fetches the HTML of only new or modified posts for transient parsing, and stores a recipe only if it has a Film Simulation plus at least five recognized settings. It also retains remote image URLs, alt text, and captions found in the recipe's Example Photographs section; images are never downloaded or served from this repository.

```bash
npm run import
npm run import -- --delay=2000
npm run import -- --refresh-images
```

The first run evaluates the complete catalog and may take about an hour. Progress is kept in `data/fujixweekly-sync.json`, so interrupted runs resume. `--refresh-images` re-fetches only previously accepted recipes that need their one-time example-photo upgrade. The app data is regenerated at `public/data/recipes.json`; its recipe IDs are stable WordPress source IDs to preserve saved recipes after future syncs.

GitHub Actions deploys the static app to GitHub Pages on every push to `main`. The scheduled sync runs daily (and can be started manually), commits only changed generated data, and deploys its updated build directly to Pages. The initial scheduled sync completes the full, resumable catalog backfill.

Before running in production, confirm that this use remains allowed by Fuji X Weekly's terms, robots directives, and rate limits.

## Checks

```bash
npm test
npm run build
```
