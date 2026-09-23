# Installing on the shop's Linux server

About fifteen minutes, most of it waiting for downloads. These steps are for
Ubuntu or Debian; any Linux with systemd works the same way with its own
package commands.

What you end up with: the app running as a service that starts with the
machine, reachable at `https://<machine-name>.<your-tailnet>.ts.net` from
any device signed in to your Tailscale network, and nowhere else. The AI
runs on the same machine; nothing is sent to an outside service.

## 1. Tailscale

If the server isn't on your tailnet yet:

```bash
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up
```

In the Tailscale admin console, under **DNS**, make sure **MagicDNS** and
**HTTPS Certificates** are on. That is what gives the app its
`https://….ts.net` address.

## 2. The app, in one command

```bash
sudo apt-get install -y git
sudo git clone https://github.com/jcm11215/Assembly-workflow-app.git /opt/assembly-workflow
sudo /opt/assembly-workflow/deploy/install.sh
```

(If the repository is private, `git clone` asks for your GitHub username and a
[personal access token](https://github.com/settings/tokens) with read access
in place of the password.)

The install script asks before it installs anything else, and each answer
defaults to yes:

- **Node.js 22**, if this machine doesn't have 22.13 or newer.
- **Ollama**, which runs the AI.
- **The AI models**: `minicpm-v` reads drawings, `qwen2.5:7b` answers
  questions and `nomic-embed-text` searches documents. They are about 10 GB
  in all. Say no to download them later from the app instead.
- **An old Local AI install**, if it finds one in `/home/*/localai`. It
  brings in the old documents and corrections, and switches off the old
  `localai` service. See [MIGRATING.md](MIGRATING.md).

Then it:

- creates a system account `assembly` that runs the app (no login shell),
- starts the `assembly-workflow` service, listening on this machine only, with
  its data in `/var/lib/assembly-workflow`,
- publishes it to your tailnet over HTTPS (on port 8443 if the machine's main
  address already serves something else),
- installs the `assembly-workflow` command for looking after it,
- prints the address to open and a **setup code**.

## 3. First admin

Open the printed address on any device on the tailnet. The page asks for
the setup code, your name, a username and a password. That account is the
first admin.

Lost the code? Run `assembly-workflow setup-code`. Or make the admin from
the server instead: `assembly-workflow create-admin`.

## 4. Check the AI

In the app, open **Settings** (your name, bottom left; on a phone, your
initials, top right). The AI card should say **The AI is ready**.

If a model is missing, the card says so; press **Set up the AI** and the
missing models download in the background. You can leave the page while
they do. If Ollama isn't running, the card says that too, with the command
to fix it.

Under **Advanced** you can pick different models, point the app at Ollama
on another tailnet machine, or download any model by name. For Ollama on
another machine, set `OLLAMA_HOST=0.0.0.0` for its service there.

The **Knowledge** screen (admins) is where the assistant's documents go:
procedures, spec sheets and vendor manuals.

## 5. Add the team

**Team → Add a person** creates a login directly. Or make a shop access
code under **Team → Access codes** and let people create their own from the
sign-in screen (they start as Assembler B).

## 6. Phones and tablets

Each device needs the Tailscale app, signed in to your tailnet. Then open
the `….ts.net` address in the browser, and use **Add to Home Screen** to
get an app icon.

To stop a device reaching the app, remove it from the tailnet in the
Tailscale admin console, or switch the person off under **Team**.
