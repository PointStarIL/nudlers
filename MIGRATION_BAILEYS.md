# Baileys Migration Plan — replacing whatsapp-web.js

**Status:** queued. Phase 1 (Telegram + provider abstraction) is shipped on `feat/messaging-providers`. This doc covers the WhatsApp transport swap.

## Why migrate

`whatsapp-web.js` works by driving a real Chromium with Puppeteer. Concrete pain it causes us today:

| Pain | Cause |
|------|-------|
| 250–400 MB RSS per process | Chromium |
| 30–90s startup | Chromium boot + WA Web JS load + auth state restore |
| Random "frame detached" errors | Iframe lifecycle inside WA Web |
| Stale `SingletonLock` after crash | Chromium userDataDir lock |
| Node 22 + Puppeteer 24 stays a moving target | Chromium build cadence |

Baileys (`@whiskeysockets/baileys`) talks the WhatsApp **Multi-Device** protocol directly over WebSocket. No browser, no DOM. Our pain disappears at once:

- ~30 MB RSS, sub-second cold start
- Auth state is just JSON files (`useMultiFileAuthState`)
- No Chromium → no SingletonLock → no PUPPETEER_EXECUTABLE_PATH → no `--no-sandbox` calculus
- Friendlier reconnect/error semantics

## Risk summary

1. **One-time QR re-scan required.** Baileys uses a different auth state format than `whatsapp-web.js`. We cannot migrate the existing `.wwebjs_auth/session-nudlers-client/` directory. The user *must* re-scan a QR code once after deploy.
2. **Library is unofficial.** WhatsApp can rate-limit or ban accounts that misbehave. Same risk as today with `whatsapp-web.js`.
3. **Group send semantics differ slightly.** Group JIDs are still `<group-id>@g.us` but the discovery flow uses `sock.groupFetchAllParticipating()` not `client.getChats()`.

Mitigations:
- Land migration behind the existing provider abstraction so the public API (`whatsappProvider.send`) doesn't change.
- Keep the old client code on disk until the new one has been validated in production for at least a week.
- Provide a clear "you need to re-scan" banner in the WhatsApp settings panel when status is `DISCONNECTED` post-migration.

## Concrete migration steps

### 1. Dependency

```bash
cd app
npm install @whiskeysockets/baileys pino-multi-stream qrcode-terminal
```

`pino-multi-stream` is already implicit via Pino. `qrcode-terminal` we already use. Baileys also needs `link-preview-js` and `axios` as transitive deps — both small.

### 2. New client module

Create `app/utils/whatsapp-client-baileys.js` next to the existing one (don't replace yet). Mirror the same exports:

- `getClient()`, `getOrCreateClient()`, `initializeClient()`
- `getStatus()` returning `{ status, qr, timestamp }`
- `destroyClient()`, `restartClient()`, `clearSession()`, `renewQrCode()`
- `ensureConnected({ timeoutMs })`
- `hasPersistedSession()`

Skeleton:

```js
import { default as makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } from '@whiskeysockets/baileys';
import path from 'path';
import fs from 'fs';
import logger from './logger.js';

const AUTH_PATH = path.resolve(process.cwd(), '.baileys_auth');
const globalAny = global;

let sockInstance = globalAny.baileysSock || null;
let connectionStatus = globalAny.baileysStatus || 'DISCONNECTED';
let qrCode = globalAny.baileysQr || null;
let saveCreds = null; // bound during init

export function hasPersistedSession() {
    return fs.existsSync(path.join(AUTH_PATH, 'creds.json'));
}

async function buildSock() {
    const { state, saveCreds: save } = await useMultiFileAuthState(AUTH_PATH);
    saveCreds = save;
    const { version } = await fetchLatestBaileysVersion();
    const sock = makeWASocket({
        version,
        auth: state,
        printQRInTerminal: false,
        logger: pinoForBaileys(),
        // Avoid syncing full message history on reconnect — we don't read,
        // we only send.
        syncFullHistory: false,
    });
    return sock;
}

function wireSockEvents(sock) {
    sock.ev.on('creds.update', () => saveCreds && saveCreds());
    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;
        if (qr) {
            qrCode = qr;
            connectionStatus = 'QR_READY';
            globalAny.baileysQr = qr;
            globalAny.baileysStatus = 'QR_READY';
        }
        if (connection === 'open') {
            connectionStatus = 'READY';
            qrCode = null;
            globalAny.baileysQr = null;
            globalAny.baileysStatus = 'READY';
            logger.info('[baileys] connected');
        }
        if (connection === 'close') {
            const code = lastDisconnect?.error?.output?.statusCode;
            const loggedOut = code === DisconnectReason.loggedOut;
            connectionStatus = loggedOut ? 'LOGGED_OUT' : 'DISCONNECTED';
            globalAny.baileysStatus = connectionStatus;
            logger.warn({ code, loggedOut }, '[baileys] connection closed');
            if (!loggedOut) {
                // Auto-reconnect (Baileys does NOT do this for you).
                setTimeout(() => initializeClient().catch(() => {}), 2000);
            }
        }
    });
}

export async function initializeClient() {
    if (sockInstance) return sockInstance;
    sockInstance = await buildSock();
    wireSockEvents(sockInstance);
    globalAny.baileysSock = sockInstance;
    connectionStatus = 'INITIALIZING';
    globalAny.baileysStatus = 'INITIALIZING';
    return sockInstance;
}

// ... ensureConnected / destroyClient / clearSession / renewQrCode follow
//     the same shape as whatsapp-client.js
```

Send via Baileys:

```js
// In whatsapp.js, replace ensureConnected import + sendMessage call:
const sock = await ensureConnected();
const jid = chatId; // already normalised to @c.us / @g.us upstream
const sent = await sock.sendMessage(jid, { text: body });
return { id: sent.key.id };
```

The chatId normalization in `sendWhatsAppMessage` already produces the right JID format — Baileys uses the same `<num>@c.us` / `<groupId>@g.us` convention.

### 3. Feature flag the swap

Add a setting `whatsapp_transport` with values `web` | `baileys`. Default `web` initially. Wire `whatsappProvider.send` to dynamic-import the chosen transport.

This lets us:
- Ship the code without forcing the QR re-scan on existing users.
- Toggle one user (the dev's own install) to Baileys, observe for a week.
- Flip the default to `baileys` once happy.
- Delete the `web` path in a follow-up.

### 4. Settings UI

Add a transport selector in the WhatsApp section of `SettingsModal.tsx`:

```tsx
<Select value={settings.whatsapp_transport} onChange={...}>
  <MenuItem value="web">WhatsApp Web (legacy)</MenuItem>
  <MenuItem value="baileys">Baileys (recommended)</MenuItem>
</Select>
```

When the user switches transport, prompt: "Switching transport requires a new QR scan. Continue?"

### 5. Tests

Tests for the WhatsApp provider currently mock `sendWhatsAppMessage`. Those keep working — the transport swap is invisible at the provider level. Add a thin test that asserts the Baileys client wiring (mock `makeWASocket`).

### 6. Rollout

1. Land migration behind the flag (default `web`).
2. Switch own install to `baileys`. Monitor for ≥7 days through:
   - daily summary cron success rate
   - restart-with-locked-vault notifications
   - any "frame detached" / SingletonLock errors (should be zero — no Chromium).
3. Flip default to `baileys` in a small follow-up commit.
4. After 30 days with no regressions, delete `whatsapp-client.js` and `whatsapp-web.js` dependency.

### 7. Rollback plan

If Baileys breaks:
- Set `whatsapp_transport = web` in app_settings.
- Re-scan the legacy QR code (the `.wwebjs_auth/` directory was kept untouched).
- File a GitHub issue with the Baileys logs (`grep '\[baileys\]'`).

## Out of scope for the migration

- Reading WhatsApp messages (we don't do that and don't intend to).
- Sending media (we only send text; if we ever need this, Baileys handles it via `{ image: { url } }` payloads).
- Multi-account support.

## Estimated effort

~1 focused day. Skeleton is small (200 lines), most time goes to testing reconnect edges and writing the transport-switch UX.
