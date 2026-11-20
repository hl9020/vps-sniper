# VPS-Sniper

Get a Hetzner Cloud server the moment it becomes available.

Many Hetzner Cloud server types are sold out in some locations for days and come back for short windows, often at night. VPS-Sniper checks the official API every few seconds, emails you when a server you want is available and can order it right away.

> Unofficial project, not affiliated with Hetzner Online GmbH. Order jobs create billable servers in your account.

## How it works

You create **jobs**. A job is one server type in one location with one action:

- **Notify**: sends an email when the server type becomes available in that location. It keeps watching and emails again every time it switches from sold out to available. No mail while it stays available or when it sells out.
- **Notify + order**: orders exactly one server as soon as it is available, emails you the details and then stops.

Want two servers? Create two order jobs. Want a cx33 in either Falkenstein or Nuremberg? Create a notify job for each, or an order job for each if you are fine with possibly getting both.

Behind the scenes a single request to `GET /v1/server_types` returns every server type with a per-location `available` flag. Hetzner describes that flag as an indicator, not a guarantee, so an order can still be rejected. In that case VPS-Sniper retries every 30 seconds while the server stays available. Any other error (missing permissions, limits, invalid image) stops the job and emails you the reason.

Servers are created with server type, location, image, SSH keys, public IPv4 on or off (IPv6 always on) and the label `managed-by=vps-sniper`. Firewalls, networks and volumes are left out on purpose: they take a minute to attach once the server exists, the scarce part is the server.

## Quick start

1. Get a Hetzner API token and SMTP credentials, see [Getting your credentials](#getting-your-credentials).
2. Copy [.env.example](.env.example) to `.env` and fill it in.
3. Start it:

```bash
docker compose up -d
```

4. Open `http://localhost:8080`, log in with `ADMIN_USER` and `ADMIN_PASSWORD`, click "Send test mail", add jobs, enable watching and save.

Tip: start with a notify job for a server type that currently shows "available". You should get a mail within seconds, which confirms token, SMTP and jobs work before you let it order anything.

The compose file binds to `127.0.0.1` only. To reach the UI from elsewhere put a reverse proxy with HTTPS in front, the login uses HTTP Basic Auth.

Without compose:

```bash
docker run -d --name vps-sniper --env-file .env -v vps-sniper-data:/data -p 127.0.0.1:8080:8080 ghcr.io/hl9020/vps-sniper:latest
```

Note: `docker run --env-file` keeps quotes as part of the value. If your SMTP password is quoted in `.env`, use compose instead or remove the quotes for `docker run`.

## Getting your credentials

### Hetzner API token

1. Open the [Hetzner Console](https://console.hetzner.com/) and select the project where ordered servers should end up. A separate project just for VPS-Sniper keeps things tidy while you test; servers can be moved to another project later.
2. Click **Security** in the left menu, then **API tokens** at the top.
3. Click **Generate API token**, enter a description such as `vps-sniper` and choose **Read & Write**. Read is enough if you only use notify jobs.
4. Copy the token right away. Hetzner shows it only once.
5. Put it into `.env` as `HCLOUD_TOKEN`.

Official guide: [Generating an API token](https://docs.hetzner.com/cloud/api/getting-started/generating-api-token/).

### Optional: polling token

Only needed for intervals below about 3 seconds, see [Rate limit](#rate-limit). Create a second, empty project, generate a **Read** token there the same way and put it into `.env` as `HCLOUD_POLL_TOKEN`. Leave it empty otherwise.

### SSH key (recommended for order jobs)

SSH keys belong to a Hetzner project, keys from your other projects are not visible to the token.

1. Get your public key, the line starting with `ssh-ed25519` or `ssh-rsa`:
   - existing private key: `ssh-keygen -y -f path/to/your.key`
   - new key: `ssh-keygen -t ed25519 -f vps-sniper.key`, the public key is in `vps-sniper.key.pub`
2. In the Hetzner Console open the project, then **Security**, **SSH keys**, **Add SSH key**, paste the public key and save.
3. Reload VPS-Sniper (the key list refreshes within a minute), tick the key under Order settings and save.

Never paste the private key anywhere. Without an SSH key Hetzner mails a root password for each ordered server.

### SMTP

Any mailbox that allows SMTP login works, for example the one of your domain or web hosting. You need host, port, user name and password, usually listed in your mail provider's settings or help pages.

```dotenv
SMTP_HOST=mail.example.com
SMTP_PORT=465
SMTP_USER=alerts@example.com
SMTP_PASS='your,#password'
SMTP_FROM=VPS-Sniper <alerts@example.com>
SMTP_TO=you@example.com, someone@example.com
```

- Port **465** uses TLS from the start, **587** uses STARTTLS. Nothing else to configure.
- Wrap the password in **single quotes** if it contains `#`, spaces or quotes. Without quotes everything after `#` is treated as a comment and cut off.
- Gmail, Outlook and other providers with two-factor login need an app password instead of your normal password.
- `SMTP_FROM` should use the address of the mailbox you log in with, otherwise many servers reject the mail.

"Send test mail" in the UI shows the exact SMTP error if something is wrong.

## Rate limit

The Hetzner Cloud API allows 3600 requests per hour per project, refilling one request per second. Checking every second uses the full budget of a project.

Recommended for fast intervals:

1. Create a separate, empty project with a **read-only** token and use it as `HCLOUD_POLL_TOKEN`. It is used for checking availability only.
2. Use a **read & write** token of the project where servers should be created as `HCLOUD_TOKEN`.

Then 1 to 2 second intervals do not slow down orders or other tools in your main project. With a single token, 3 seconds or more leaves room for everything else.

## Configuration

Credentials and mail recipients live in environment variables. Jobs, interval and order settings are set in the UI and stored in `DATA_DIR/settings.json`.

| Variable | Required | Description |
|---|---|---|
| `HCLOUD_TOKEN` | yes | Token of the project where servers get ordered. Read is enough if you only use notify jobs. |
| `HCLOUD_POLL_TOKEN` | no | Read token of a separate project used only for checking availability. Defaults to `HCLOUD_TOKEN`. |
| `ADMIN_USER` | no | UI login user, default `admin`. |
| `ADMIN_PASSWORD` | yes | UI login password. |
| `SMTP_HOST` | yes | SMTP server, e.g. `mail.example.com`. |
| `SMTP_PORT` | yes | `465` (TLS) or `587` (STARTTLS). |
| `SMTP_USER` | yes | SMTP login, usually the full mail address. |
| `SMTP_PASS` | yes | SMTP password, in single quotes if it contains `#` or spaces. |
| `SMTP_FROM` | yes | Sender, e.g. `VPS-Sniper <alerts@example.com>`. |
| `SMTP_TO` | yes | Recipients, comma separated. |
| `PORT` | no | Default `8080`. |
| `DATA_DIR` | no | Default `./data`, `/data` in the container. |

## Notes

- Hetzner currently limits cloud server creation for new and some existing accounts. If your account is affected, the first order fails, the job stops and you get an email with the API error.
- A finished or failed order job can be set back to watching with "Reset".
- Without SSH keys Hetzner sends the root password to your account email.

## Development

Node.js 22 or newer:

```bash
npm ci
npm run dev        # reads .env, restarts on changes
npm run typecheck
npm run lint
npm run build && npm start
```

Build the image locally with `docker build -t vps-sniper .`.

New versions are published to `ghcr.io` by the publish workflow when a GitHub release is created.

## License

MIT
