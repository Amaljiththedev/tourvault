# TourVault web app

Next.js 16 (App Router) + Redux Toolkit front end for the TourVault API.

```bash
cp .env.example .env.local   # points at the API, default http://localhost:8001
npm install
npm run dev                  # http://localhost:3000
npm run lint
npm run build
```

- `src/app/`: pages (`/login`, `/register`, `/tours`) and the Redux `StoreProvider`
- `src/store/`: the store, the `auth`, `tours` and `assets` slices, and typed hooks
- `src/lib/api.ts`: fetch wrapper, FastAPI error formatting, upload with progress
- `src/components/`: UI, including the Three.js `ModelViewer`

All permission checks happen in the API. The client hides admin controls for viewers, but the server refuses the requests anyway.
