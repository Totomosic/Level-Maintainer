# Level Maintainer Web

Simple web editor for `Level-Maintainer/config.lua`.

## Stack

- Frontend: Vue 3 + TypeScript (Vite)
- Backend: Express + TypeScript

## Routes

- `GET /config` returns the raw `config.lua` file
- `GET /api/items` returns parsed `cfg["items"]`
- `POST /api/items` adds or updates one item entry in `cfg["items"]` (optional `group`, `priority` of `standard|low`)
- `DELETE /api/items/:name` removes one item entry
- `GET /api/sleep` returns `cfg["sleep"]`
- `PUT /api/sleep` updates `cfg["sleep"]`

Numeric fields accept optional metric suffixes:

- `k` = 1,000
- `m` = 1,000,000
- `g` = 1,000,000,000
- `t` = 1,000,000,000,000

Item groups are optional labels and are stored only as comments in `config.lua`, for example:

```lua
-- @group: AE2 Drops
["drop of Molten SpaceTime"] = {nil, 1, "spacetime", "standard"},
```

In the UI, configured items are shown by group and each row has a group dropdown to move the item between existing groups (or to `Ungrouped`).

## Run

From `Level-Maintainer/web`, you can run both services together:

```bash
cd /home/jordan/oc_scripts/Level-Maintainer/web
./run-web-dev.sh
```

### Backend

```bash
cd backend
npm install
npm run dev
```

Backend defaults:

- Port: `3001`
- Config path: `../../config.lua` (relative to `backend` directory)

Optional env vars:

- `PORT`
- `CONFIG_PATH`

### Frontend

```bash
cd frontend
npm install
npm run dev
```

Frontend runs on `http://localhost:5173` and proxies `/api` + `/config` to `http://localhost:3001`.
