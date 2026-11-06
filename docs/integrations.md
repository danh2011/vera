# Integrations

The **Integrations Store** (sidebar → Integrations) is the front door: discover → install → set up if needed → connect → use. It renders the backend catalogue (`GET /api/v1/integrations`); the frontend has no second list of integrations or states.

Everything installable is **bundled with Vera and reviewed**. "Install" records state in SQLite; it never downloads or runs code. A third-party extension mechanism is deliberately *not* implemented. If one is added it needs its own design: signed manifests or trusted publishers, version pinning, permission isolation, review and removal.

## Requirements between integrations

An integration can declare that it **requires** another (manifest `requires`). *Notifications* requires *Home Assistant*, because notifications are sent only through Home Assistant. "Required" means the other integration is installed, fully set up, turned on **and its last connection test succeeded**: a saved credential is not enough. While a requirement isn't met:

* the integration shows **Needs another integration** and its tools report `needs_dependency` (the assistant isn't offered them),
* it cannot be turned on (`409 NEEDS_DEPENDENCY`),
* its setup wizard starts with a **Requirements** step that says exactly what is missing and offers the fix (Install / Set up / Test / Turn on) as a button; Continue stays blocked until it's satisfied,
* if you later turn off or remove the required integration, the dependent one drops back to *Needs another integration* automatically, and the uninstall dialog lists what will stop working.

## Install always leads into setup

Only integrations with nothing to configure (no setup form, sign-in, credentials or requirements: core utilities, tasks, notes, files) switch on by themselves. Everything else installs **off** and the Store opens its setup wizard immediately, so "installed" is never mistaken for "working".

## Lifecycle

`Available → Installed → (Needs setup / Needs authorisation) → Enabled → Connected`

* Installing is idempotent. Integrations that need no setup and contact nothing (core utilities, tasks, notes) turn on immediately; the rest install *off* and open the setup wizard.
* An integration can be installed but off, or on but disconnected; the detail view shows each fact separately (installed / configured / signed in / enabled / connected, with last test time).
* "Connected" appears **only** after a successful real test. A saved credential or an install never sets it. Changing configuration resets the test result to "untested".
* Incomplete integrations cannot be enabled, and clearing a required setting turns the integration off.
* Disabling stops tool execution immediately (checked on every call).
* Uninstall removes the integration's settings, secrets and permissions. It never deletes tasks, notes, memories or chats. The dialog lists both.
* Preinstalled defaults (core utilities, tasks, notes, operations) are installed once at first start; if you uninstall an optional one it is not reinstalled. Core utilities and Operations are required and cannot be removed.

## Permissions

Each manifest declares permissions (what, why, data accessed, access type). Sensitive ones start **off** (e.g. Home Assistant *Control devices*, calendar write, email read/draft) and can be toggled in the detail view; a tool whose permission is off reports "Permission off".

## Tools (50) and what they need

| Integration | Tools | Needs |
|---|---|---|
| Core utilities | `get_current_time`, `convert_timezone`, `calculate`, `convert_units`, `parse_date`, `format_text` | nothing; deterministic, offline |
| Tasks and reminders | `create_task`, `list_tasks`, `update_task`, `complete_task`, `delete_task`*, `create_reminder`, `list_reminders` | nothing for tasks. **Reminders are delivered** as a push notification through the Notifications integration once it works; before that they are kept and the tool/UI say they can't alert you yet (see Reminders below) |
| Notes and memory | `save_note`, `search_notes`, `update_note`, `delete_note`*, `save_memory`*, `search_memory` | nothing. The assistant must get approval (*) before saving a memory |
| Files and documents | `list_allowed_files`, `search_files`, `read_allowed_file`, `summarise_document` (local extractive), `get_document_metadata` | server setting `VERA_ALLOWED_FILE_ROOTS` |
| Web and research | `fetch_public_page`, `extract_page_text`, `get_public_page_metadata` / `search_web`, `search_news` | page tools: nothing. Search: your own SearXNG (json enabled) **or** a Brave Search API key |
| Home server | `get_host_status`, `get_cpu_memory_usage`, `get_disk_usage`, `get_network_status`, `list_approved_services`, `get_service_status`, `get_service_logs` | `VERA_ENABLE_MACHINE_READONLY=true`; approved-services list; optional read-only Docker proxy |
| Home Assistant | `list_home_assistant_entities`, `get_home_assistant_state`, `control_home_assistant_entity`, `activate_home_assistant_scene` | URL, long-lived token, entity allow-list; control permission turned on by you; locks/alarms/covers always ask* |
| Google Calendar and Gmail | `list_calendar_events`, `create_calendar_event`*, `update_calendar_event`*, `search_emails`, `create_email_draft`* | your own Google Cloud OAuth client + sign-in (below). **Never sends email** |
| Media | `get_media_server_status`, `search_media_library`, `get_download_service_status` | **Navidrome** (URL + username + password, Subsonic token auth), Jellyfin (URL + API key) and/or Radarr/Sonarr (URL + API key). Read-only |
| Notifications | `send_notification` | **Home Assistant, set up and connected.** You choose which of its notify services receives messages (the list comes live from your Home Assistant). Reports *accepted*, never *delivered* |
| Operations | `get_integration_health` | nothing |

\* asks for your approval first. Every tool has a Zod schema, risk level, permission, timeout, result cap and audit policy.

## Setup guides

**Home Assistant.** Profile (bottom-left) → Security → Long-lived access tokens → Create token "Vera". In Vera: URL as reachable *from the Vera container* (e.g. `http://192.168.1.20:8123`; `localhost` is the container itself), paste the token, list allowed entities (`light.*`, `scene.*`, `sensor.living_room_temperature`). Test connection. Then, if you want control, switch on *Control devices*. Errors: 401 → new token; unreachable → address/port/network; 403 → the token's user lacks rights. Data flow: Vera ↔ your Home Assistant only.

**Google Calendar / Gmail.** Vera is self-hosted, so you register your own Google "app" once (data never passes through anyone else's server): Google Cloud Console → new project → enable Calendar API (and Gmail API for email) → OAuth consent screen (External; add yourself as test user) → Credentials → OAuth client ID → *Web application*, authorised redirect URI = the address the wizard shows (`<VERA_PUBLIC_URL>/api/v1/oauth/callback`, exact match). Paste client ID and secret, choose *Calendar only* unless you want email, press *Sign in*. Uses PKCE and a one-time server-side `state` bound to your session. Apps in Google's Testing mode may need re-authorisation about every 7 days. Email access asks Google for `gmail.readonly` + `gmail.compose`; Vera has no send tool. **This flow has been tested only against Vera's own state/CSRF logic and mocked requests, not against live Google.**

**Web search.** SearXNG: add `json` to `search.formats` in its `settings.yml`, enter its URL. Brave: paste an API key. Queries go to the provider you choose; searches that look financial/credential-like are blocked first.

**Media.** Navidrome: use a normal Navidrome user (ideally one without admin rights); Vera sends only the Subsonic salted token, never the password. Jellyfin: Dashboard → API Keys. Radarr/Sonarr: Settings → General → API Key. Use container names on a shared Docker network or LAN addresses.

**Notifications.** Everything goes through your Home Assistant, so set that up first. Then pick your phone from the list (it looks like `notify.mobile_app_<device name>`; it appears after you sign in to the Home Assistant companion app and allow notifications). *Test connection* confirms the service exists without sending; *Send a test notification* actually sends one. If Home Assistant answers HTTP 400, Vera shows Home Assistant's own message; the usual cause is a service name that doesn't exist, which is why you choose from the live list instead of typing it.

## Reminders

Reminders are real. `create_reminder` (chat tool), the Tasks page "Remind me" option and `POST /reminders` all schedule one. Delivery:

* one timer is armed for the next future reminder (no polling), and any change to an integration re-checks immediately;
* due reminders are sent with `send_notification` through Home Assistant (title "Reminder"); the result is recorded as **Sent: accepted by Home Assistant** (it can't confirm the phone showed it);
* if Notifications isn't ready when a reminder comes due, it waits and is sent as soon as it is, up to 24 hours late, after which it is marked **Missed**;
* transient failures retry after 1 min, 5 min, 15 min, then show **Failed** with the reason;
* text that looks like banking, credentials or sensitive IDs is never sent (marked Failed);
* until Notifications works the Tasks page shows a call to action ("Set up reminders") that installs it and opens its wizard at the requirement.

If the server is stopped when a reminder comes due, it is sent at the next start (within the 24 hour window).

**Home server.** Set `VERA_ENABLE_MACHINE_READONLY=true`; list services as `name | http | http://host:port/health`, `name | tcp | host:port`, `name | docker | container`, `name | self`. For Docker status/logs run a read-only socket proxy and set `VERA_DOCKER_PROXY_URL`.

## Honest status of each adapter

All adapters are covered by automated tests against local fakes (Home Assistant, ntfy, SearXNG, HTTP services). **Not yet verified against the real third-party services:** Google OAuth/Calendar/Gmail, Brave Search, Jellyfin/Radarr/Sonarr response shapes beyond the documented API fields, Docker proxy log framing on a real daemon, live Gemini. Expect small fixes when you first connect them.

## Adding an integration (developers)

Create `server/src/integrations/adapters/<name>.ts` using `makeModule` and `defineTool`, add it to `adapters/index.ts`. Declare permissions, `dataAccess`, `sendsDataToThirdParty`, uninstall behaviour, config schema and setup steps; the Store, wizard and catalogue pick everything up from the manifest. Tool handlers throw `ToolError(code, message)` for user-safe failures.
