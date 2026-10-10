# Solaria frontend

This directory contains two React + TypeScript + Vite experiences:

- The standalone, judge-facing **Constellation Unfolder** in `src/constellations/`.
- The research-workbench components in `src/views/` and `src/three/`, which consume the FastAPI routes under `/api`.

## Constellation Unfolder

```bash
npm ci
npm run dev:constellations
```

Open `http://localhost:5174/constellations.html`.

Production build:

```bash
npm run build:constellations
```

## Research frontend

Start the backend on port 8000, then run:

```bash
npm ci
npm run dev
```

The Vite development server proxies `/api` to `http://127.0.0.1:8000`.

