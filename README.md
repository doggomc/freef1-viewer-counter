# FreeF1 live viewer counter

A standalone Cloudflare Worker + hibernatable Durable Object for an approximate live count of open FreeF1 site connections. It is deliberately separate from the Netlify site and the Render backend. It does not write to either backend.

## Privacy and data flow

- A site page opens one secure WebSocket connection. The Durable Object counts its currently open sockets and pushes only `{ "type": "count", "count": N }` when a connection joins or leaves.
- The browser sends no application messages: no heartbeat, polling, visitor ID, page path, page history, or player activity.
- The Worker keeps no connection IDs and writes no visitor data to Durable Object storage. The SQLite migration is required by the Workers Free plan; this application does not create tables or persist counts.
- Idle sockets use Cloudflare's WebSocket Hibernation API so the Durable Object can hibernate between events.
- The count is an approximate number of open site connections, not unique people or confirmed video viewers. Browser closure, network loss, and reconnect timing can make it briefly stale. The public endpoint is not an anti-abuse or authentication system.
- Cloudflare necessarily terminates the network connection and may process standard network metadata (such as IP address and security/request metadata) under its own service policies. This Worker does not store that metadata. The site's privacy copy should be updated when the browser connection is enabled.

The only allowed browser Origin is currently `https://freef1.netlify.app`. No preview or local-development Origin is allowed in the deployed configuration. If local testing is needed, use a temporary `.dev.vars` file and never deploy that override.

## Check locally

Requires Node.js 20 or newer.

```sh
npm install
npm test
npm run check
```

The automated tests cover strict Origin checks, the fixed global room, the health route, query-string rejection, and the count message shape. They do not replace a deployed WebSocket load test.

For local Wrangler testing only, create `.dev.vars` with:

```dotenv
ALLOWED_ORIGINS=http://localhost:8787
```

Then run `npm run dev`. Delete `.dev.vars` before deployment. It is ignored by Git and must not replace the production Origin in `wrangler.jsonc`.

## Deploy to your Cloudflare account

1. Sign in to the Cloudflare account that should own this free service. The account needs Workers and SQLite-backed Durable Objects enabled.
2. In this folder, run:

   ```sh
   npx wrangler login
   npm run deploy
   ```

   `wrangler login` opens Cloudflare's browser authorization; do not paste API tokens into chat or commit them to this folder. Wrangler will create the Durable Object namespace/migration and deploy the Worker.
3. Record the deployed `workers.dev` hostname printed by Wrangler. The browser endpoint will be:

   ```text
   wss://freef1-viewer-counter.<your-workers-subdomain>.workers.dev/ws
   ```

   The exact account subdomain is only known after deployment. The public health check is `https://<deployed-host>/health`.
4. Send me the exact `wss://.../ws` URL. The site is intentionally not connected yet: its navigation pill, exact `wss:` Content Security Policy entry, and privacy/FAQ wording should be enabled together after the URL is known.

## Free-tier / capacity note

The object is configured as SQLite-backed and uses hibernatable WebSockets. Cloudflare documents a 100,000 Durable Object requests/day and 13,000 GB-seconds/day Free-plan allowance; limits are hard caps, and exceeding a Free-plan limit can make further operations fail until reset. Outgoing WebSocket messages and incoming protocol-level pings are not billed as Durable Object requests; the site sends no application-level messages. Check Cloudflare's current pricing and account limits before relying on it in production: <https://developers.cloudflare.com/durable-objects/platform/pricing/>

The expected race-weekend profile is approximately 200 concurrent viewers during each of FP1, FP2, and FP3; 400 during qualifying; and a peak of 800 during the race. The single global room is sized for that 800-connection peak, well below Cloudflare's documented per-object WebSocket connection limit. The website counter itself will report open site-page connections, not verified stream viewers or unique people. Connection churn and concurrent load have not been measured against your account. This implementation does not impose a monthly-hours counter or promise uninterrupted free service.

## Implementation references

- WebSocket Hibernation API: <https://developers.cloudflare.com/durable-objects/best-practices/websockets/>
- Durable Object state and WebSocket connections: <https://developers.cloudflare.com/durable-objects/api/state/>
- SQLite Durable Object migration example: <https://developers.cloudflare.com/durable-objects/examples/websocket-hibernation-server/>
