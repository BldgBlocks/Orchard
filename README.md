# Orchard

Orchard is a small self-hosted UI for folder-first Docker Compose maintenance.

It is for people who keep apps in their own folders, want a clean overview, and want simple actions like update, restart, start, and stop without turning the whole thing into a heavy container platform.

## What Orchard does

- Scans a chosen folder for `docker-compose.yml`, `docker-compose.yaml`, `compose.yml`, and `compose.yaml`
- Groups related compose folders into apps
- Shows app status, service counts, and recent run history
- Runs transparent actions using normal `docker compose` commands
- Supports scheduled sweeps
- Persists settings and history in `./orchard-data` on the host, mounted to `/data` in the container

## Important security note

Orchard's full management mode expects this mount:

```yaml
- /var/run/docker.sock:/var/run/docker.sock
```

That gives Orchard access to the host Docker daemon.

In plain terms: this is a high-privilege admin tool. That is fine for a trusted homelab setup, but it is not a low-privilege sandbox.

The default compose file binds Orchard to `127.0.0.1` only. That is intentional. If you want remote access, put a reverse proxy or other access control in front of it instead of exposing Orchard directly.

Without the Docker socket, Orchard can still scan compose files from disk, but it falls back to limited read-only discovery:

- it can still find apps and read compose manifests
- it cannot manage live Docker state reliably
- actions are disabled

## Quick start

The root [docker-compose.yml](docker-compose.yml) is the deployment compose file.

1. Build the image once:

```bash
sudo docker build -t orchard:local .
```

2. Copy [docker-compose.yml](docker-compose.yml) to something like `~/Orchard/docker-compose.yml`
3. Edit the values directly in that file.
	Set `./workspace:/workspace` to the folder Orchard should scan.
	Keep `./orchard-data:/data` if you want Orchard state stored beside the compose file.
	Leave `127.0.0.1:4747:3000` alone unless you intentionally want direct network exposure.
4. Start it:

```bash
sudo docker compose up -d --remove-orphans
```

5. Open `http://127.0.0.1:4747`

## Deploy helper

[deploy.sh](deploy.sh) is now a convenience script for spinning up a local parallel test instance.

It:

1. builds the image
2. writes a small test-instance compose file into a separate deploy folder
3. restarts that test deployment on its own port
4. prints the local URL when it is ready

Example:

```bash
./deploy.sh
```

That defaults to a separate instance under `~/Services/Orchard-dev` on `http://127.0.0.1:4748`.

If you want a different test folder or port:

```bash
./deploy.sh --deploy-dir ~/Services/Orchard-playground --host-port 4749 --container-name orchard-playground
```

## Settings that matter most

- `WORK_PATH`: path inside the container to scan, usually `/workspace`
- `127.0.0.1:4747:3000`: localhost-only host port binding for the UI; keep it private by default and publish it through a reverse proxy if you want remote access
- `./workspace:/workspace`: host path mounted into Orchard; point this at the folder that contains the compose apps you want Orchard to manage
- `./orchard-data:/data`: Orchard's local state directory on the host; this keeps settings and history next to the compose file instead of in a Docker-managed volume
- `SCAN_DEPTH`: how deep Orchard scans for compose files under the mounted workspace; `4` is a reasonable default for nested app folders
- `MAX_PARALLEL_JOBS`: how many apps Orchard processes at once during batch actions; keep it modest unless your host is strong and your apps are independent
- `AUTO_REFRESH_SECONDS`: dashboard polling interval for open browser sessions
- `DEFAULT_MODE`: internal fallback only; Orchard uses this if an action request arrives without an explicit mode
- `SCHEDULED_SWEEP_INTERVAL_DAYS`: how often the built-in scheduler runs when enabled; the shipped safe default is `14`
- `SCHEDULED_SWEEP_TIME`: local time Orchard uses for day-based scheduled sweeps; the shipped safe default is `21:00`
- `SCHEDULED_SWEEP_MODE`: what kind of sweep the scheduler runs; leave this at `smart` unless you have a specific reason to force a different action style
- `ACTION_QUEUE_LIMIT`: how many queued or running operations Orchard allows before it starts rejecting new ones; `50` is a deliberate safety cap, not a throughput target
- `ACTION_COOLDOWN_MS`: minimum time between newly queued operations; `1000` ms helps absorb double-clicks and bursty requests
- `SKIP_SELF_PROJECT`: prevents Orchard from operating on its own deployment when Orchard is discovered inside the scanned tree

## Scheduling

Orchard uses its own built-in scheduler.

That means:

- no cron job
- no extra scheduler container
- the schedule is visible in the app itself

The scheduler defaults are intentionally conservative.

Orchard manages Docker Compose apps that may pull fresh upstream artifacts, images, or dependency chains. For high-trust or security-sensitive services, "update immediately" is not a safe default. A supply-chain incident can be detected, discussed, and contained by the community long before it would have reached your host through a delayed schedule.

Because of that, Orchard ships with a default scheduled sweep cadence of every 14 days at 9:00 PM instead of a short-term interval. The goal is to reduce the chance that Orchard becomes the first thing in your environment to pull a bad upstream release.

If you want faster updates, you can still choose them explicitly. Orchard should make the safer posture easy and the riskier posture deliberate.

## Dev files

Development-only helpers now live under `dev/`.

- `dev/docker-compose.build.yml`: local source build flow
- `dev/package.json`: convenience scripts for local UI/API development
- `dev/vscode/`: editor settings and extension recommendations

## Notes

- Orchard is meant to live outside the tree it manages.
- All deployment config now lives directly in [docker-compose.yml](docker-compose.yml). There is no separate env file to keep in sync.
- Orchard does not enable CORS. The shipped UI talks to the shipped backend on the same origin only.
- Mutating API routes require explicit JSON requests from the Orchard UI and are intentionally not designed as a general integration surface.
- If a compose app depends on local `.env` files or relative paths, Orchard runs commands from that compose directory so behavior matches normal shell usage.
- Orchard passes only Docker and basic client environment variables to `docker compose`. If a managed app depends on custom environment values, put them in that app's own `.env` file or compose manifest instead of relying on Orchard container environment inheritance.
- Orchard does not redeploy its own container from inside the UI. For Orchard itself, use an external terminal in its compose folder or the local deploy helper.
- The root of this repo is now deployment-first; local source-workflow helpers are intentionally kept in `dev/`.
