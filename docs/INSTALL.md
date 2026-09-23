# Installing on the shop's Linux server

About fifteen minutes. These steps are for Ubuntu or Debian; any Linux with
systemd works the same way with its own package commands.

What you end up with: the app running as a service that starts with the
machine, reachable at `https://<machine-name>.<your-tailnet>.ts.net` from
any device signed in to your Tailscale network, and nowhere else.

## 1. Node.js 22

The app needs Node.js **22.13 or newer** and nothing else -- no database
server, no `npm install`.

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs git
node --version          # v22.13.0 or later
```

## 2. Tailscale

If the server isn't on your tailnet yet:

```bash
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up
```

In the Tailscale admin console, under **DNS**, make sure **MagicDNS** and
**HTTPS Certificates** are on -- that is what gives the app its
`https://….ts.net` address. (`tailscale serve` below offers to turn HTTPS
on if it isn't.)

## 3. The app

```bash
sudo git clone https://github.com/jcm11215/Assembly-workflow-app.git /opt/assembly-workflow
cd /opt/assembly-workflow
sudo deploy/install.sh
```

(If the repository is private, `git clone` asks for your GitHub username and a
[personal access token](https://github.com/settings/tokens) with read access
in place of the password.)

The install script:

- creates a system account `assembly` that runs the app (no login shell),
- installs and starts the `assembly-workflow` service -- listening on
  `127.0.0.1:8080` only, with its data in `/var/lib/assembly-workflow`,
- runs `tailscale serve --bg 8080` to publish it to your tailnet over HTTPS,
- prints a **setup code**.

## 4. First admin

Open the address `tailscale serve` printed (or run `tailscale serve status`)
on any device on the tailnet. The page asks for the setup code, your name, a
username and a password. That account is the first admin.

Lost the code? `journalctl -u assembly-workflow | grep -A1 "setup code"`, or
create the admin from the server instead: `sudo -u assembly env
DATA_DIR=/var/lib/assembly-workflow node server/cli.mjs create-admin`.

## 5. Set up the AI

The AI runs on your own hardware, with [Ollama](https://ollama.com); nothing
is sent to an outside service. Install Ollama on this machine (skip if it's
already there):

```bash
curl -fsSL https://ollama.com/install.sh | sh
```

Then in the app, **Settings → AI**, under *Download a model*, fetch a vision
model for drawings (`minicpm-v`), a chat model for the assistant
(`qwen2.5:7b`, or `qwen2.5:14b` with 12 GB+ of GPU memory) and
`nomic-embed-text` for the knowledge base. Pick them in the three model
boxes, **Save**, and **Test the saved settings**. Ollama on another tailnet
machine works too: give its address, and on that machine set
`OLLAMA_HOST=0.0.0.0` for its service.

The **Knowledge** screen (admins) is where the assistant's documents go:
procedures, spec sheets, vendor manuals.

## 6. Add the team

**Admin → Team → Add a person** creates a login directly. Or make a shop
access code under **Admin → Access codes** and let people create their own
from the sign-in screen (they start as Assembler B).

## 7. Phones and tablets

Each device needs the Tailscale app, signed in to your tailnet. Then open
the `….ts.net` address in the browser, and use **Add to Home Screen** to
get an app icon.

To stop a device reaching the app, remove it from the tailnet in the
Tailscale admin console, or switch the person off under **Admin → Team**.
