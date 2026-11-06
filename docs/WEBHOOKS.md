# Webhook Deliveries

A Cronium webhook sends events to a URL you choose. This page is for whoever writes the receiver: what each request contains, how to check that it came from Cronium, and what changes when a delivery is retried. Webhooks are managed through the `webhookSystem` tRPC procedures named below.

Sending events _to_ Cronium uses a different scheme. See [Sending to Cronium](#sending-to-cronium).

## What a delivery contains

Each attempt is one `POST` to the webhook's URL, with a JSON body:

```json
{
  "id": "42",
  "event": "webhook.order.created",
  "timestamp": "2026-11-05T11:59:58.000Z",
  "data": { "order": 1 },
  "metadata": { "webhookId": 7, "source": "webhook" }
}
```

| Field       | What it is                                                                                                                                                                                                      |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`        | The event's id, as a string. It stays the same on every attempt, so it is what to dedupe on. One event sent to several webhooks has the same `id` on each, and ids are only unique within one Cronium instance. |
| `event`     | The event's name.                                                                                                                                                                                               |
| `timestamp` | When the event happened, not when this attempt was made. It stays the same on every attempt.                                                                                                                    |
| `data`      | The event's contents.                                                                                                                                                                                           |
| `metadata`  | Details about where the event came from. Left out when the event has none.                                                                                                                                      |

A body can be up to 8 MB (8,388,608 bytes), so check that your receiver and anything in front of it will take that much. nginx, for example, refuses more than 1 MB unless `client_max_body_size` says otherwise, and its 413 counts as a failed attempt like any other answer. An event that would be longer isn't sent at all: see [Attempts and retries](#attempts-and-retries).

Both signatures cover the body. The request also has these headers:

| Header                   | Value                                                                      | Signed                      |
| ------------------------ | -------------------------------------------------------------------------- | --------------------------- |
| `Content-Type`           | `application/json`                                                         | No                          |
| `X-Webhook-Id`           | The id of the webhook sending this.                                        | No                          |
| `X-Webhook-Event`        | A copy of the body's `event`.                                              | No, but the body's copy is  |
| `X-Webhook-Timestamp`    | A copy of the body's `timestamp`: the event's time, not the attempt's.     | No, but the body's copy is  |
| `X-Delivery-Id`          | The id of this attempt. Every attempt has a new one.                       | By `X-Webhook-Signature-V2` |
| `X-Delivery-Timestamp`   | When this attempt was made, in ISO 8601. Every attempt has a new one.      | By `X-Webhook-Signature-V2` |
| `X-Webhook-Signature-V2` | The signature to check. See [Verifying a delivery](#verifying-a-delivery). |                             |
| `X-Webhook-Signature`    | An older signature over the body alone. See [below](#x-webhook-signature). |                             |

Any custom headers configured on the webhook are added to these, but none can replace a signature or anything a signature covers, because that would stop you verifying the delivery. `webhookSystem.create` and `webhookSystem.update` refuse the names `X-Webhook-Signature`, `X-Webhook-Signature-V2`, `X-Delivery-Id` and `X-Delivery-Timestamp`, in any letter case. A webhook set up before that rule can still have one stored. It isn't sent, and setting the webhook's headers again without it removes it.

They also refuse `Content-Length`, `Transfer-Encoding` and `Trailer`, because the HTTP client works out how to send each body, and a wrong value can truncate it, hang the delivery or stop it being sent at all. They refuse `Content-Encoding` too, unless its value is `identity`, because the body is never compressed. A webhook set up before these rules can have one of these stored as well, and it's treated the same way: it isn't sent, and the delivery goes out with the HTTP client's own framing.

A custom header also has to be something HTTP can carry. A name can only use letters, digits and ``!#$%&'*+-.^_`|~``, and a value can't hold line breaks, control characters other than tabs, or anything above U+00FF. Whitespace and line breaks around a name or a value are removed, so a value pasted with its line ending arrives without one. A webhook that already has a name HTTP can't carry sends nothing: each attempt is recorded as failed, with an error giving the start of the name, until its headers are set again. One that already has such a value sends it with those characters removed, which may be what its receiver accepts.

A custom header with the name of any other header above replaces it, so a webhook's owner can change what those say. No signature covers them, so the delivery still verifies. If it matters, read `event` and `timestamp` from the body, which custom headers can't change. `Content-Type` can be whatever the receiver asks for, and the body is the same JSON regardless, so if your code matches on it, as `express.raw` does, match what the webhook sends. Other headers, such as `User-Agent`, come from the HTTP client and aren't something to rely on.

### Which events are sent

An event from an inbound endpoint goes to each of the owner's active webhooks whose `events` list names it or contains `*`. A test event goes only to the webhook named in the call, whatever its `events` list says, and gets one attempt with no automatic retries.

| Event            | Sent when                                                                                              | `data`                                                                                                                                                                                      | `metadata`                 |
| ---------------- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------- |
| `webhook.<type>` | A request is accepted at one of the owner's inbound endpoints. `<type>` is the name that request gave. | `eventType`, `receivedAt` and `webhookId`, plus the request's JSON fields (or its body under `data` if that wasn't a JSON object). Strings have `&`, `<`, `>`, `"` and `'` escaped as HTML. | `webhookId`, `source`      |
| `webhook.test`   | `webhookSystem.test` is called for this webhook.                                                       | `test`, `timestamp` and any test data given.                                                                                                                                                | `webhookId`, `triggeredBy` |

## Verifying a delivery

`X-Webhook-Signature-V2` is `sha512=` followed by the hex HMAC-SHA512, keyed with the webhook's secret, of these three parts, separated by line feeds (`\n`), with nothing after the body:

```text
<X-Delivery-Timestamp>
<X-Delivery-Id>
<raw body>
```

A header value can't contain a line feed, so no bytes can move between the headers and the body without changing what's signed.

To handle a delivery:

1. **Read the raw body before parsing it.** The signature covers the exact bytes sent, and serializing the parsed JSON again won't reproduce them. In Express, for example, use `express.raw({ type: "application/json" })` on this route.
2. **Recompute the signature and compare it in constant time.** If it doesn't match, refuse the request. Don't trust any other header until this passes.
3. **Check `X-Delivery-Timestamp`.** Refuse a time more than 5 minutes from now, in either direction. This limits how long a captured request can be replayed, and a late retry still passes, because each attempt is signed with its own time.
4. **Refuse an `X-Delivery-Id` you've already seen.** Cronium never sends one twice, so a repeat is a replay. Remember ids for twice your window: a request stamped at the far future edge of a 5 minute window stays acceptable for 10 minutes.
5. **If you've already handled the body's `id`, do no more work, and answer with a 2xx.** This is an honest retry. An attempt can fail on Cronium's side after you've processed it, for example by timing out, and any answer other than a 2xx gets it retried again. If one receiver serves several webhooks or several Cronium instances, include which one in the key, because `id` alone can repeat across them.

Don't apply a freshness check to the body's `timestamp` or to `X-Webhook-Timestamp`. They hold the event's time, so a late retry carries an old one and gets refused, and Cronium records that as one more failed attempt.

Steps 2 and 3 in Node:

```js
const crypto = require("node:crypto");

const WINDOW_MS = 5 * 60 * 1000;

// `headers` has lower-case names, as Node gives them. `rawBody` is a Buffer.
function verifyDelivery(headers, rawBody, secret) {
  const timestamp = headers["x-delivery-timestamp"];
  const deliveryId = headers["x-delivery-id"];
  const signature = headers["x-webhook-signature-v2"];
  if (!timestamp || !deliveryId || !signature) return false;

  const digest = crypto
    .createHmac("sha512", secret)
    .update(`${timestamp}\n${deliveryId}\n`)
    .update(rawBody)
    .digest("hex");
  const expected = Buffer.from(`sha512=${digest}`);
  const received = Buffer.from(signature);
  if (
    received.length !== expected.length ||
    !crypto.timingSafeEqual(received, expected)
  ) {
    return false;
  }

  // Only now can the time be trusted.
  return Math.abs(Date.now() - Date.parse(timestamp)) <= WINDOW_MS;
}
```

And in Python:

```python
import hashlib
import hmac
from datetime import datetime, timezone

WINDOW_SECONDS = 5 * 60


# `headers` is case-insensitive, as in Flask and Django. `raw_body` is bytes.
def verify_delivery(headers, raw_body, secret):
    timestamp = headers.get("X-Delivery-Timestamp")
    delivery_id = headers.get("X-Delivery-Id")
    signature = headers.get("X-Webhook-Signature-V2")
    if not timestamp or not delivery_id or not signature:
        return False

    signed = f"{timestamp}\n{delivery_id}\n".encode() + raw_body
    digest = hmac.new(secret.encode(), signed, hashlib.sha512).hexdigest()
    if not hmac.compare_digest(signature.encode(), f"sha512={digest}".encode()):
        return False

    # Only now can the time be trusted.
    sent_at = datetime.fromisoformat(timestamp.replace("Z", "+00:00"))
    age = datetime.now(timezone.utc) - sent_at
    return abs(age.total_seconds()) <= WINDOW_SECONDS
```

To test your own code, here is a delivery with its signatures. The body has no trailing newline. With these values, your signature check should match, though the freshness check will refuse a date this old.

```text
secret:                 example-secret
X-Delivery-Timestamp:   2026-11-05T12:00:00.000Z
X-Delivery-Id:          V1StGXR8_Z5jdHi6B-myT
body:                   {"id":"42","event":"webhook.test","timestamp":"2026-11-05T11:59:58.000Z","data":{"test":true}}
X-Webhook-Signature-V2: sha512=a11490346f854822a05832ffe5bbd95f9650d6d85e683117133dc4bb36101cb5a03bfb745942b6a795fdef54e7e793ffc2b69bd56e6b41b38c7c2f84f2c19988
X-Webhook-Signature:    sha256=f40c2611e30cf157174fa298d1d561edc8fc6f05f156910ac4160d3702d48445
```

### `X-Webhook-Signature`

This is the signature Cronium has always sent, and it stays so that existing receivers keep working: `sha256=` followed by the hex HMAC-SHA256, keyed with the webhook's secret, of the raw body alone.

It shows that the body came from someone holding the secret, but it covers nothing about the attempt. So a captured request verifies forever, and a receiver's only defences against a replay are remembering every `id` it has ever handled, or checking the body's `timestamp` and refusing late retries along with replays. New receivers should use `X-Webhook-Signature-V2`. Moving to it from this one means checking a different header, signed string and hash, and adding steps 3 and 4.

## Attempts and retries

An event can reach you more than once, so handle deliveries with the steps above. Compared with the first attempt, a retry sends:

| Part of the request                                               | Automatic retry                      | Manual retry               |
| ----------------------------------------------------------------- | ------------------------------------ | -------------------------- |
| `id`, `event`, `timestamp`, `data` and `metadata`, by value       | The same                             | The same                   |
| `X-Webhook-Timestamp`                                             | The same                             | The same                   |
| Body bytes                                                        | The same                             | Can differ, as below       |
| `X-Webhook-Signature`                                             | The same                             | Can differ, as below       |
| `X-Delivery-Id`, `X-Delivery-Timestamp`, `X-Webhook-Signature-V2` | New                                  | New                        |
| URL, secret, custom headers                                       | As when the first attempt was queued | The webhook's current ones |

**A manual retry's bytes can differ from the first attempt's.** It rebuilds the body from the stored event, and Postgres `jsonb` doesn't keep key order, so `{"zebra":1,"apple":2}` can come back as `{"apple":2,"zebra":1}`. It is the same event, and both signatures cover the bytes actually sent, so they still verify. But the bytes, and therefore `X-Webhook-Signature`, can differ from the first attempt's even when the secret hasn't changed. Compare events by the body's `id`, never by their bytes or signature.

**Automatic retries** follow a failed attempt, on the webhook's `retryConfig`. `maxRetries` counts every attempt including the first, so the default of 3 means up to three requests, the second about 1 second after the first fails and the third about 2 seconds after the second fails (`retryDelay`, multiplied by `backoffMultiplier` each time). These retries are held in memory, so a restart of the app loses any that are waiting.

**Attempts run at most 5 at a time for one webhook**, and 10 at a time across one owner's webhooks. Anything beyond that waits in memory, retries included, so a receiver that stops answering falls behind without holding up other webhooks, and a restart loses what's waiting. A backlog goes out at about one request a second for each webhook, plus one for each new event, so a retry can come later than its `retryConfig` says. How much can wait is limited: see [When the queue is full](#when-the-queue-is-full).

**A host whose name server doesn't answer** fails that attempt with `Could not resolve host` after 6 to 8 seconds, or about 20 if `/etc/resolv.conf` lists three name servers, and it's retried like any other failed attempt. It holds up nothing but that webhook's deliveries.

**A manual retry** is one call to `webhookSystem.retryDelivery`. It makes one attempt and reports what the receiver answered, and a failure isn't repeated. It works on any recorded delivery, including one that succeeded or one for an event the webhook no longer subscribes to, until the record is removed after `CRONIUM_WEBHOOK_RETENTION_DAYS` (30 days by default). It is refused if the webhook is disabled or the event isn't recorded under the webhook's owner. Each user can make 10 of these calls a minute, though calls made at the same moment can get past that limit.

**An event past 8 MB is never sent, so it isn't retried.** Every attempt would send the same bytes, so another couldn't change anything. The queue records one failed attempt on each subscribed webhook, with no status and an `error` giving the length. `webhookSystem.test` and `webhookSystem.retryDelivery` refuse such an event with `PRECONDITION_FAILED`, and nothing is sent or recorded.

## When the queue is full

Deliveries wait in memory, and a receiver that stops answering falls behind while events keep arriving. So each Cronium process limits what it holds:

| Held for                    | Limit  |
| --------------------------- | ------ |
| One webhook                 | 32 MB  |
| All of one owner's webhooks | 64 MB  |
| Everything in the process   | 256 MB |

What counts is each event's delivery body in bytes, and for each delivery about 2 KB plus the length of the webhook's URL, secret and custom headers. An event going to several webhooks counts in full against each of them, but only once against the owner and the process, because they share one copy. A delivery counts from when its event is accepted until its last attempt ends, whether it's running or waiting. So one webhook can hold about 2,700 events of 10 KB, about 15,000 tiny ones, or 5 of the longest one inbound request can make.

**An event that doesn't fit is refused, and whoever sent it is told.** The [inbound endpoint](#sending-to-cronium) answers `503` with `Retry-After: 60` and an `error` saying which limit it reached. Nothing is stored or sent, so it isn't in any webhook's history and there's nothing to retry from. The sender is the one holding the event, and sending it again later is all it takes. If it never does, that event is gone, which is why it's told.

**Nothing already accepted makes way for it.** Whoever sent an event waiting in the queue has been told it was accepted, and can't be told otherwise, so it keeps its place, and that includes its automatic retries. They were counted when the event was accepted, and don't ask for room again.

**An event still goes to the webhooks with room.** When at least one of the webhooks an event goes to has room, the request gets a `200` and the event goes to those. Refusing it would hold them up for as long as the other stayed behind, however long that is, and a webhook subscribed to `*` would hold up everything its owner sends. Each webhook without room gets a failed attempt in its history instead, with no status and an `error` saying why. No request was made for it, and no automatic retries follow. `webhookSystem.retryDelivery` sends it, like any other recorded delivery, once the deliveries ahead of it have gone out. So one receiver going down doesn't stop the same owner's other webhooks, until enough are down to reach the owner's limit, when their events are refused as well.

`webhookSystem.test` and `webhookSystem.retryDelivery` don't use the queue, so these limits don't apply to them. The limits are for each process, so each replica has its own.

## Answering a delivery

- **A 2xx means delivered, as soon as the status arrives.** Anything else is recorded as a failed attempt and retried if retries remain. That includes a 3xx, because redirects aren't followed.
- **Send a 2xx only once you've taken the event.** Cronium keeps your answer's body for the record and nothing else, so what happens to the body can't change the status. A 2xx isn't sent again if its connection then drops, or its body runs long or can't be decompressed. When a body doesn't finish, the delivery's `error` says so, and a manual retry can send the event again.
- **You have 30 seconds to send the status.** That starts with the request, so the time a long body takes to reach you uses some of it. After that the attempt counts as failed. If your work can take longer, answer first and do it afterwards.
- **Let the body arrive before you close the connection.** If you refuse a long body by answering and closing straight away, your status can be lost. The attempt is then recorded with an error such as `write EPIPE` and no status, and retried like any other failed attempt.
- **The body gets another 30 seconds and 1 MB, after decompression.** Cronium stops reading at either limit and closes the connection.
- **The first 1,000 characters of your answer are stored** in the delivery history, so don't put anything sensitive in them.

Cronium won't deliver to internal addresses (loopback, private ranges and cloud metadata endpoints). The attempt is recorded as failed without a request being made.

## The secret

`webhookSystem.create` returns the secret once, and uses one you supply if you give it. `webhookSystem.regenerateSecret` replaces it and returns the new one once. One secret serves both directions: it signs deliveries and checks requests to the webhook's inbound endpoint.

Automatic retries already queued keep signing with the old secret, so if you rotate while deliveries are failing, accept both until those retries have finished.

## Sending to Cronium

Each webhook also has an inbound endpoint, `POST /api/webhooks/<key>`, and its scheme is not the same as a delivery's:

|                  | Sent by Cronium (a delivery)                          | Sent to Cronium (inbound)                                  |
| ---------------- | ----------------------------------------------------- | ---------------------------------------------------------- |
| Signature header | `X-Webhook-Signature-V2`                              | `X-Webhook-Signature`                                      |
| Algorithm        | HMAC-SHA512, as `sha512=<hex>`                        | HMAC-SHA256, as `sha256=<hex>`                             |
| Signed string    | `<X-Delivery-Timestamp>\n<X-Delivery-Id>\n<raw body>` | `<X-Webhook-Timestamp>.<X-Webhook-Delivery-Id>.<raw body>` |
| Time header      | `X-Delivery-Timestamp`                                | `X-Webhook-Timestamp`                                      |
| Id header        | `X-Delivery-Id`                                       | `X-Webhook-Delivery-Id`                                    |
| Who checks       | Your receiver, as above                               | Cronium: within 5 minutes, each id accepted once           |

**A request's body can be up to 1 MB (1,048,576 bytes),** and a longer one gets a 413. The delivery can be longer than the request, because of the fields added and the escaping described under [Which events are sent](#which-events-are-sent): plain text made only of `"` comes out 6 times as long, and nothing a request can contain grows more than that. That still fits in a delivery, so what the endpoint accepts can go out. The exception is a webhook with stored `transformations` that copy fields. If that would take an event past 8 MB, the request gets a 413, and nothing is stored or sent.

**A 503 means Cronium's delivery queue is full, and nothing happened.** See [When the queue is full](#when-the-queue-is-full). Send the same event again after the `Retry-After`. You can keep its `X-Webhook-Delivery-Id`, because a refused request doesn't use it up. Sign it again if more than 5 minutes have passed, since the signature covers the time. A sender's other requests can be refused for the same reason until the receivers behind this endpoint catch up, so keep events you've been told to send again rather than dropping them.

**One Cronium can't receive from another: a delivery sent to an inbound endpoint gets a 401.** That is deliberate. A webhook has one secret for both directions, so accepting deliveries would let anyone holding a captured delivery and the endpoint's URL replay it into that webhook, and a webhook subscribed to `*` whose URL is an inbound endpoint could trigger itself. To forward events between instances, put a small relay between them that verifies the delivery and signs a new inbound request.
