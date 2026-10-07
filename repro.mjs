import { createElement as h, Suspense, use } from "react";
import { resume } from "react-dom/server";
import { prerender } from "react-dom/static";

const controller = new AbortController();
const never = new Promise(() => {});
let prerendering = true;

// A second hole, so the prerender produces postponed state to resume.
function Hole() {
	if (prerendering) use(never);
	return null;
}

// Aborts the prerender synchronously while rendering, below a host element inside a Suspense boundary.
function AbortsDuringRender() {
	if (prerendering) controller.abort();
	return h("p", null, "item");
}

const App = () =>
	h(
		"html",
		null,
		h(
			"body",
			null,
			h(Suspense, null, h(Hole)),
			h(
				Suspense,
				{ fallback: h("section", null, "fallback") },
				h("section", { className: "root" }, h("h2", null, "header"), h(AbortsDuringRender)),
			),
		),
	);

const read = async (stream) => {
	let out = "";
	for await (const chunk of stream) out += Buffer.from(chunk).toString();
	return out;
};

const { prelude, postponed } = await prerender(h(App), { signal: controller.signal, onError() {} });
const preludeHtml = await read(prelude);

prerendering = false;
const resumed = await resume(h(App), JSON.parse(JSON.stringify(postponed)), { onError() {} });
const resumedHtml = await read(resumed);

const body = preludeHtml.slice(preludeHtml.indexOf("<body>"), preludeHtml.indexOf("<script"));
const segments = [...resumedHtml.matchAll(/<div hidden id="(S:\w+)">(.*?)<\/div>/g)].map(([, id, html]) => ({ id, html }));
const broken = segments.find((s) => s.html.startsWith("<p>"));

console.log("react-dom", (await import("react-dom/package.json", { with: { type: "json" } })).default.version);
console.log("prelude body :", body);
for (const s of segments) console.log(`resumed ${s.id}  :`, s.html || "(empty)");
console.log(
	broken
		? `\nBROKEN: ${broken.id} resumed as "${broken.html}" without the <section> and <h2> rendered before the abort`
		: "\nOK: the boundary resumed with its <section> and <h2>",
);
process.exit(broken ? 1 : 0);
