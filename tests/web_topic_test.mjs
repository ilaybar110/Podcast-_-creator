// Node test for docs/js/research.js (run by tests/test_app.py): research with a fake Gemini and
// a fake Wikipedia, then the topic script, including resuming without repeating requests.
import assert from "node:assert/strict";
const R = await import(new URL("../docs/js/research.js", import.meta.url));
const { QuotaExhausted } = await import(new URL("../docs/js/gemini.js", import.meta.url));

const wikiFetch = async (url) => ({ json: async () => url.includes("list=search")
  ? { query: { search: [{ title: "Memory" }] } }
  : { query: { pages: [{ extract: "Memory is the faculty of the mind. ".repeat(20) }] } } });

const angles = [1, 2, 3, 4, 5, 6].map((i) => ({ title: `Angle ${i}`, description: `About ${i}` }));
function fakeGemini({ searchFails = false } = {}) {
  const calls = { search: 0, text: 0 };
  return {
    calls,
    async searchText(prompt) {
      calls.search++;
      if (searchFails) throw new QuotaExhausted("no search today", new Date());
      if (prompt.includes("THE LISTENER CHOSE")) {
        return { text: '{"notes": "deep facts", "outline": ["seg one", "seg two"]}', sources: [{ title: "deep.org", url: "https://deep.org" }] };
      }
      return { text: "Here you go:\n" + JSON.stringify({ title: "Memory", summary: "S", angles, notes: "facts" }),
        sources: [{ title: "a.com", url: "https://a.com" }, { title: "a.com", url: "https://a.com/2" }] };
    },
    async writeText(prompt) {
      calls.text++;
      if (prompt.includes("ONLY one JSON object")) return JSON.stringify({ title: "T", summary: "S", angles, notes: "wiki facts" });
      if (prompt.includes("dialogue lines")) return "Noa: hello there friend\nYoni: hi, what a topic\nNoa: indeed it is";
      return "## Part 1\n" + "A warm sentence about memory [1]. ".repeat(20);
    },
  };
}

// research: one search + wikipedia, duplicate sources merged
let g = fakeGemini();
const r = await R.research("human memory", "en", g, { fetchFn: wikiFetch });
assert.equal(g.calls.search, 1); assert.equal(g.calls.text, 0);
assert.equal(r.angles.length, 6); assert.ok(r.searched);
assert.deepEqual(r.sources.map((s) => s.title), ["a.com", "Memory"]);
assert.ok(r.notes.includes("Wikipedia: Memory"));

// no free search today -> falls back to Wikipedia + one text request
g = fakeGemini({ searchFails: true });
const r2 = await R.research("human memory", "en", g, { fetchFn: wikiFetch });
assert.equal(r2.searched, false); assert.equal(g.calls.text, 1); assert.equal(r2.angles.length, 6);

// script: 20 min English = 2 parts; deep dive once; resuming repeats nothing
assert.equal(R.scriptParts(20, "en"), 2);
const plan = R.topicPlan(10, "he", "narrator", 3000);
assert.equal(plan.gemini_tts, 3); assert.equal(plan.gemini_text, 1); assert.equal(plan.gemini_search, 1);
for (const mode of ["narrator", "conversation"]) {
  g = fakeGemini();
  const saved = [];
  const job = { warnings: [], request: { language: "en", mode, text: "",
    topic: { topic: "memory", notes: r.notes, sources: r.sources, focus: ["Angle 1 - About 1"], minutes: 20 } } };
  const opts = { hostNames: ["Noa", "Yoni"], genders: ["female", "male"] };
  const ui = { progress() {} };
  await R.writeTopicScript(job, g, ui, opts, async (j) => saved.push(JSON.stringify(j)));
  assert.equal(g.calls.search, 1); assert.equal(g.calls.text, 2);
  assert.ok(job.request.text.length > 100);
  assert.ok(!job.request.text.includes("[1]") && !job.request.text.includes("Part 1"));
  assert.equal(job.sources.length, 3);
  if (mode === "conversation") assert.equal(job.script.length, 6); else assert.ok(job.narration.length >= 2);
  // resume from the save made after the first part: only the second part is written again
  const mid = JSON.parse(saved.find((s) => JSON.parse(s).written?.length === 1));
  const g2 = fakeGemini();
  await R.writeTopicScript(mid, g2, ui, opts, async () => {});
  assert.equal(g2.calls.search, 0); assert.equal(g2.calls.text, 1);
}
console.log("ok");
