# Development

The root of this repo is deployment-first.

If you still want local source-workflow helpers, use the files in this folder.

## Local app development

Install dependencies:

```bash
cd dev
npm install
npm --prefix ../server install
npm --prefix ../web install
```

Run the UI and API in watch mode:

```bash
cd dev
npm run dev
```

Build the frontend bundle only:

```bash
cd dev
npm run build:web
```

## Local container build flow

Run the source-build compose file from the repo root after editing its hardcoded values if needed:

```bash
docker compose -f dev/docker-compose.build.yml up -d --build
```

## Editor helpers

VS Code recommendations and settings that used to live at the repo root are stored in `dev/vscode/`.