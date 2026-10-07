# Fizz: aborting a prerender during render drops the boundary's host elements on resume

If `prerender()` is aborted synchronously while a component is rendering, and that component sits below a host element inside a Suspense boundary, the postponed state records the hole inside that host element. The host elements rendered before the abort end up in neither the prelude nor the resume. Hydration then fails with #418.

Next.js triggers this in production. With `cacheComponents`, it aborts the prerender synchronously when a client component calls `Math.random()` or `Date.now()` during render. See https://github.com/sannajammeh/next-sync-io-resume-repro.

## Steps

```sh
npm install
npm run repro
```

## Expected

Either outcome is fine:

- `S:0` contains `<section class="root"><h2>header</h2><p>item</p></section>`, so the whole boundary is a hole.
- `<section>` and `<h2>` are in the prelude and only `<p>` resumes.

## Actual

```
prelude body : <body><!--$?--><template id="B:1"></template><!--/$--><!--$?--><template id="B:0"></template><section>fallback</section><!--/$-->
resumed S:1  : (empty)
resumed S:0  : <p>item</p>

BROKEN: S:0 resumed as "<p>item</p>" without the <section> and <h2> rendered before the abort
```

Reproduces on `react-dom@19.2.5` and `react-dom@19.3.0-canary-17eca7b0-20261006`.

## Cause

1. `abort()` skips `request.currentTask`, so the boundary's content task keeps rendering.
2. After the aborting component returns, `if (request.aborted) throw null` unwinds the task. Each `renderNode` on the way up truncates `segment.chunks`, so `<section><h2>` is removed from the boundary's root segment. `task.keyPath` and `task.childIndex` are not restored on this path.
3. The aborted branch of `retryRenderTask`'s catch calls `abortTask`/`finishAbortedTask`, which calls `trackPostpone` with the stale `keyPath` (inside `section`, `childIndex: -1`). Because `keyPath` is not the boundary's `contentKeyPath`, the boundary's root segment id is never set (`rootSegmentID: null`). The resume replays `section` as if it were already in the prelude and renders only its children from the hole.

## Fix that works locally

Save `task.keyPath` and `task.childIndex` before `retryNode` in `retryRenderTask`, and restore them in the `request.aborted` branch before `abortTask`/`finishAbortedTask`. The segment is already truncated back to the task's start, so the postpone is then recorded at the task's start. The whole boundary becomes a hole, and `S:0` resumes with `<section>` and `<h2>`.

Applied to the React bundled in Next.js 16.4.0 and 16.5.0-canary.2, this fixes both the Next.js repro and the production app, with no hydration error.
