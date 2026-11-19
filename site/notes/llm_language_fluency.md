# LLM fluency and token efficiency of candidate agent-scripting languages (as of 2026-11-13)

Scope: how well current LLMs write each candidate language for "code mode" and short agent scripts, how token-efficient each language is, how code-mode systems chose their language, and whether typed tool APIs help. The tier table is my synthesis of the cited findings in the five sections below. Evidence strength varies a lot, so every row names its best evidence and date. Results from before 2024 are marked **[STALE <2024]**; 2024 GPT-4o-era results are marked **[2024]**.

**Tier definitions**

- **T1 Native:** frontier models at or near ceiling on standard tasks; chosen by the major code-mode systems.
- **T2 Strong:** mainstream language with abundant training data; frontier models write it reliably; measured gaps against Python are small or confounded by benchmark design; failures are mostly logic errors, not syntax.
- **T3 Usable with execution feedback:** models know the syntax but show measurable gaps, idiom errors, or have only sparse evidence; an interpreter-feedback loop closes most of the gap at extra token cost.
- **T4 Weak or unproven:** little training data or no evidence at all; hallucinated functions and syntax; documentation and few-shot examples help only partially.

| Language | Tier | Best evidence (benchmark, model, date) | Token-efficiency note |
|---|---|---|---|
| Python (CPython) | T1 | EsoLang-Bench v2 (May 2026): GPT-5.4 xhigh and Gemini 3.1 Pro solve 100% of 80 problems in Python. Agent study on MiniLCB (Jul to Oct 2026): GPT-5.5 100% ever-solved. Default language of Anthropic Programmatic Tool Calling, OpenAI Code Interpreter, Gemini code execution, smolagents, Pydantic Monty | Mid-pack on static solution size; **lowest total agent token cost** of Python/Java/Rust/OCaml because it needs the fewest repair iterations |
| JavaScript | T1 | Same EsoLang-Bench baseline: 100% for GPT-5.4 xhigh and Gemini 3.1 Pro. Cloudflare's Code Mode MCP server has the model write JavaScript against typed definitions (Feb 2026) | Most verbose dynamic language in the Rosetta Code comparison (GPT-4 tokenizer, Jan 2026) |
| TypeScript | T1 | Cloudflare (Sep 2025) and Anthropic (Nov 2025) present tools to the model as TypeScript APIs. McEval [2024]: GPT-4o TS 56 vs JS 62 | Writing TS costs about **31% more tokens than JS** on 5 tasks (cl100k, Jul 2026), almost all from type annotations |
| Python subset: Pydantic Monty | T1 to T2 | Pydantic code-mode benchmark (Oct 2026, 5,276 graded runs, 8 models): with code mode, long-horizon success 58% to 100% (7 of 8 models at 92% or higher). Unsupported features are rejected at parse time or by the bundled `ty` type checker | Same as Python |
| Python subset: Starlark | T2 (inferred) | No benchmark found. Practitioner anecdote that LLMs are "fluent in Starlark". No study of models respecting Starlark's restrictions | Same as Python |
| Python subset: MicroPython | T2 | EmbedBench: best models reach 73.8% when porting Arduino C++ to MicroPython on a Raspberry Pi Pico (embedded setting, not scripting) | Same as Python |
| Lua / Luau | T2 | LuauBench (community, 2026): GPT-5.4 80.3%, Claude Opus 4.5 and 4.6 77.5%, most frontier models 74% to 78%. MultiPL-E study (Jan 2025, older models): Lua only 3.6 points below Java on average. McEval [2024]: GPT-4o Lua 60 vs Python 76 | No measurement found |
| Ruby | T2 | AutoCodeBench (Aug 2025): Claude Opus 4 Ruby 61.0 (Python 40.3, but problem sets differ per language). SWE-bench Multilingual (2025, Claude 3.7 Sonnet): Ruby 43.2% vs 42.7% overall | Secondary posts place Ruby near the top of mainstream languages; not stated in the primary study's text |
| PHP | T2 | AutoCodeBench: PHP is the lowest language for most models (26.6 to 34.7). SWE-bench Multilingual (Claude 3.7): 48.8%. McEval [2024]: GPT-4o 64 | No measurement found |
| Go | T2 | Aider polyglot includes Go (GPT-5 high 88.0% overall; board frozen 2025-11-20). AutoCodeBench Go 22.0 to 41.9. SWE-bench Multilingual (Claude 3.7): 31.0% | Statically typed languages are markedly less token-efficient than dynamic ones; no Go figure published |
| bash / shell | T2 | AutoCodeBench Shell 36.7 to 51.6 (Claude Opus 4 reasoning best). McEval [2024]: GPT-4o 76 | No measurement found |
| SQL | T2 for syntax; task-dependent | BIRD text-to-SQL: Gemini-SQL2 80.04% single model (Jun 2026); best agentic system 82.39% (Sep 2026); human 92.96%. Errors are mostly schema and semantic grounding | Very compact for set operations (inference) |
| R | T3 | MultiPL-E study (Jan 2025, older models): R 24 to 34 points below Java and Python. AutoCodeBench R 42.4 to 52.5. McEval [2024]: GPT-4o 66 | No measurement found |
| Scheme / Racket | T3 | AutoCodeBench Racket 45.4 to 68.9 (Claude models highest). McEval [2024]: GPT-4o Scheme 76, Racket 66. MultiPL-E study (Jan 2025, older models): Racket weakest of six languages. CRUXEval-X: Racket least correlated with other languages | Lisps are token-efficient (Clojure tops the Rosetta study); Scheme itself not measured |
| Clojure | T3 (unmeasured) | In MultiPL-E (`humaneval-clj`), but no 2025 or 2026 frontier numbers found. PtcRunner chose a Clojure subset (PTC-Lisp) as its LLM-facing tool-calling language | **Most token-efficient of 19 mainstream languages: 109 tokens per task on average; C is 2.6x worse** |
| Tcl | T3 | McEval [2024]: GPT-4o Tcl 68 (Python 76). Nothing newer found | No measurement found |
| jq | T3 | jqBench (ICLR 2026): best model Claude Opus 4.1 reaches 76% (jqStack) and 81% (jqSpider) with feedback; "jq lags behind Python"; documentation did not help | Very compact for JSON transforms (inference) |
| q (kdb+) / K | T3 for q with an agent loop; K unmeasured | KX QEval (Aug 2026): one-shot Claude Opus 4.8 80.7% pass@10; coding agents: Claude Opus 5 97.6%, GPT-5.5 88.4% (94.5% with a q skill), Claude Haiku 4.5 37.2% | ASCII array languages are the most token-efficient measured (J: 70 tokens per task) |
| APL / BQN | T4 | Dyalog blog (Jul 2026): since Claude Opus 4.5 and GPT-5.2 (Nov 2025), models write "passable APL – still a bit naive and Python-like". No benchmark. Nothing found for BQN | APL 110 tokens per task: each glyph splits into several tokens, erasing the terseness advantage |
| Janet | T4 | GPT-4 [STALE <2024, May 2023] failed every attempt and hallucinated `==`, `bitand`, and `0b` literals. Nothing newer | No measurement found |
| Gleam | T4 | No-resource study (Jun 2026; GPT-4o, o3-mini, Qwen): zero-shot 0% to 1% on McEval-Hard; GPT-4o 5-shot 15.5% HumanEval, 30.4% MBPP | No measurement found |
| MoonBit | T4 | Same study: o3-mini 5-shot 39% / 46% / 12% (HumanEval / MBPP / McEval-Hard). SWE-AGI chose MoonBit because it is largely absent from pretraining data | Vendor claims only |
| Roc, Rhai, Rune, Wren | T4 (no evidence) | No benchmark, study, or credible anecdote found | No measurement found |
| Reference floor: esoteric languages | below T4 | EsoLang-Bench (2026): 0% to 11% for GPT-5.4 xhigh, Gemini 3.1 Pro, o4-mini, Qwen3-235B, Kimi K2.5 despite documentation in the prompt | n/a |

**Shortlist implication (inference, not a sourced finding):** benchmark the runtimes for T1 and T2 languages first (Python and its subsets, JavaScript/TypeScript, Lua/Luau, bash, SQL, and jq as a data-transform sublanguage). Treat Clojure, Scheme, Tcl, R, and q as contrast cases that must be run with an interpreter-feedback loop. Runtimes whose language is T4 (Rhai, Rune, Wren, Janet, Roc, Gleam, MoonBit, APL/BQN/K) are attractive embeddings but should only enter the benchmark as an explicit "docs plus examples plus feedback" experiment, because the evidence predicts high first-attempt failure rates and retry costs that outweigh their RAM and CPU savings.

## 1. What multilingual code-generation benchmarks show, the latest frontier numbers, and whether the popular-vs-niche gap has narrowed

### Takeaway

The classic multilingual suites (MultiPL-E, MultiPL-T, HumanEval-X, xCodeEval, McEval, CRUXEval-X) are 2022 to 2024 artifacts that frontier labs no longer report; the usable 2025 and 2026 frontier evidence comes from AutoCodeBench, Multi-LCB, SWE-bench Multilingual, the frozen Aider polyglot board, language-specific benchmarks (QEval, LuauBench, jqBench), and agent studies. For mainstream languages the gap has largely closed at the frontier, especially with execution feedback; for low-resource languages (R, Racket, OCaml, q) it persists in one-shot generation but shrinks sharply in agent loops, at a 1.3x to 3x token premium; for no-resource and esoteric languages it has not closed.

### Cited Findings

**Classic suites: coverage and dates**

- MultiPL-E's HumanEval translation covers 24 languages: Ada, Clojure, C++, C#, D, Dart, Elixir, Go, Haskell, Java, Julia, JavaScript, Lua, OCaml, PHP, Perl, R, Ruby, Racket, Rust, Scala, Shell, Swift, TypeScript (subsets `humaneval-adb` through `humaneval-ts`). ([MultiPL-E dataset](https://huggingface.co/datasets/nuprl/MultiPL-E))
- MultiPL-T (Cassano et al.; preprint Aug 2023, revised Sep 2024; published in PACMPL/OOPSLA 2024) targeted Julia, Lua, OCaml, R, and Racket by translating Python training data into each language and validating with tests; fine-tuned StarCoderBase and Code Llama models "outperform other open Code LLMs" on MultiPL-E. **[STALE <2024 models]** ([arXiv 2308.09895](https://arxiv.org/abs/2308.09895); [ACM](https://dl.acm.org/doi/full/10.1145/3689735))
- McEval (Chai et al., Jun 2024) covers 40 languages and 16K samples. Table 1 generation pass@1 for GPT-4o (2024-05-13): Python 76, JavaScript 62, TypeScript 56, Lua 60, Tcl 68, Scheme 76, Racket 66, Emacs Lisp 64, AWK 54, Shell 76, R 66, Julia 72, Haskell 90, Elixir 66, Ruby 64, PHP 64, Perl 64, Go 62, CoffeeScript 82, Fortran 66, Erlang 44, F# 78, PowerShell 72, VimScript 40. GPT-4 Turbo (2023-11-06): Python 78, Lua 56, Tcl 56, Scheme 58, Racket 62, Shell 72. **[2024]** ([McEval HTML](https://arxiv.org/html/2406.07436v1); [abstract](https://arxiv.org/abs/2406.07436))
- CRUXEval-X (Aug 2024, ACL 2025): 19 languages, 24 LLMs; "TypeScript and JavaScript show a significant positive correlation", "Racket has less correlation with other languages", and a model trained only on Python reaches at most 34.4% pass@1 in other languages. **[2024]** ([arXiv 2408.13001](https://arxiv.org/abs/2408.13001))
- CodeGolf Bench (May 2026) supports 60 languages but evaluated only Python and C++ "due to resource constraints", so it gives no niche-language data. ([alphaXiv 2605.30394](https://www.alphaxiv.org/abs/2605.30394))

**2025 MultiPL-E low-resource study (non-frontier models)**

- "Enhancing Code Generation for Low-Resource Languages: No Silver Bullet" (Giagnorio, Martin-Lopez, Bavota; Jan 2025) tested DeepSeek Coder 1B/7B/33B, Code Llama 7B/13B, and GitHub Copilot on MultiPL-E. Copilot pass@1: Julia 53.5, Lua 61.4, R 32.9, Racket 24.7, Java 57.2, Python 61.7. DeepSeek Coder 33B: Julia 43.3, Lua 53.8, R 30.9, Racket 33.1, Java 57.8, Python 67.5. ([arXiv 2501.19085](https://arxiv.org/html/2501.19085v1))
- Average gap against Java/Python in the same study: Julia 10.9/20.8 points, Lua 3.6/13.5, R 24.3/34.2, Racket 28.7/38.6. Julia and Lua approach high-resource performance for larger models; R and Racket stay weak. ([alphaXiv summary of 2501.19085](https://www.alphaxiv.org/abs/2501.19085))
- Agnostics (2025, ICLR 2026) built a universal RL environment for Lua, Julia, R, OCaml, and Fortran; a fine-tuned Qwen 3 4B often rivals or beats 16B to 70B open-weight baselines on MultiPL-E. No frontier numbers. ([arXiv 2508.04865](https://arxiv.org/html/2508.04865v4))

**AutoCodeBench (Tencent Hunyuan; arXiv Aug 12, 2025; ICLR 2026)**

- 3,920 problems across 20 languages (Python, C++, Java, JavaScript, Go, Shell, C#, Dart, Elixir, Julia, Kotlin, Perl, PHP, R, Racket, Ruby, Rust, Scala, Swift, TypeScript); Lua is not included. ([AutoCodeBench](https://arxiv.org/html/2508.09101v1))
- Table 4 pass@1, Claude Opus 4 (reasoning): average 52.4; Python 40.3, JS 38.6, TS 47.2, Shell 51.6, Ruby 61.0, PHP 28.1, R 52.5, Racket 68.9, Elixir 80.3, Julia 55.5, Perl 44.5, Go 37.2. ([AutoCodeBench](https://arxiv.org/html/2508.09101v1))
- Other averages: Claude Opus 4 non-reasoning 50.9; Claude Sonnet 4 reasoning 51.1; o3-high 51.1 (Go only 22.0); o4-mini 50.0; DeepSeek-R1-0528 50.2; Gemini 2.5 Pro 48.7; DeepSeek-V3-0324 48.1; GPT-4.1 48.0; Qwen3-235B-A22B-Thinking-2507 47.7; Qwen3-Coder-480B 44.8. Racket ranges from 45.4 (o4-mini) to 68.9 (both Claude reasoning models). ([AutoCodeBench](https://arxiv.org/html/2508.09101v1))
- The authors report a narrow spread across models on popular languages ("scores ranging from 50.4 to 53.8") that widens on low-resource languages (45.3 to 62.0), say Claude Opus 4 "outperforms other models significantly" on low-resource languages, and warn that low-resource scores may be inflated because the filtering model is weak in those languages. ([AutoCodeBench](https://arxiv.org/html/2508.09101v1))
- Blog summaries of AutoCodeBench disagree on several Claude numbers; the figures above are from the paper's Table 4. ([codemyspec](https://codemyspec.com/blog/why-elixir-is-the-best-language-for-llms); [justinhuangai](https://justinhuangai.github.io/posts/autocodebench-large-language-models-are-automatic-code-benchmark-generators/))

**Multi-LCB (ICLR 2026)**

- Extends LiveCodeBench to 12 languages (C++, C#, Python, Java, Rust, Go, TypeScript, JavaScript, Ruby, PHP, Kotlin, Scala) with release-date filtering; reports "Python overfitting", language-specific contamination, weaker results in statically typed or less common languages, and that Python performance does not reliably predict performance in other languages. ([OpenReview PDF](https://openreview.net/pdf/67b541bebca14bdcd927bd8f32454d60ef0175b9.pdf); [HF paper page](https://huggingface.co/papers/2606.20517))
- Per-model Multi-LCB numbers on aggregator sites are internally inconsistent (the same per-language figures are attached to two different models), so I did not use them. ([benchmarklist](https://benchmarklist.com/benchmarks/multi_lcb_extending_livecodebench_to_multiple_programming_languages/); [benchmarklist model page](https://benchmarklist.com/models/deepseek-coder-33b-instr/))

**Aider polyglot**

- 225 Exercism exercises in C++, Go, Java, JavaScript, Python, Rust. Last updated 2025-11-20. Top: gpt-5 (high) 88.0% ($29.08), gpt-5 (medium) 86.7%, o3-pro (high) 84.9%, gemini-2.5-pro-preview-06-05 (32k think) 83.1%, gpt-5 (low) 81.3%, o3 (high) 81.3%, grok-4 (high) 79.6%. ([Aider leaderboard](https://aider.chat/docs/leaderboards/))
- Third-party commentary notes the board has not been refreshed for the 2026 model generation. ([codemyspec Aider review](https://codemyspec.com/blog/aider-review-2026); [agentmarketcap](https://agentmarketcap.ai/blog/2026/04/06/aider-polyglot-leaderboard-2026-swe-bench-python-bias))

**SWE-bench Multilingual (agentic, repository-level)**

- 300 tasks from 42 repositories in 9 languages (C, C++, Go, Java, JavaScript, TypeScript, PHP, Ruby, Rust). The only published per-language results use SWE-agent with Claude 3.7 Sonnet (2025): C/C++ 28.57%, Go 30.95%, JS/TS 34.88%, Ruby 43.18%, PHP 48.84%, Java 53.49%, Rust 58.14%, overall 42.67%; the post concludes "LLMs are more proficient in Python than other languages." ([SWE-bench Multilingual](https://www.swebench.com/multilingual.html))
- 2026 aggregate (not per-language) leaderboards: Claude Opus 5 89.5%, Claude Opus 4.8 84.4% (BenchLM snapshot 2026-07-29); Claude Mythos Preview 87.30 (DataLearner, 2026-04-24). The two third-party sites disagree. ([BenchLM](https://benchlm.ai/benchmarks/swe-bench-multilingual); [DataLearner](https://www.datalearner.com/en/benchmarks/SWE-bench-Multilingual))

**2026 frontier and agent studies**

- "The Best Programming Language for Tokenmaxxing" (Wu, Anderson, Guha; Jul 2026, revised Oct 2026): 100 LiveCodeBench v6 problems (MiniLCB), 2,000 agent sessions. Ever-solved rate (Python/Java/Rust/OCaml): GPT-5.5 100/99/98/97; Claude Sonnet 4.6 92/96/96/95; GLM-5.2 100/97/97/99; Qwen3.6-35B-A3B 84/79/84/77; Gemma-4-26B-A4B 84/82/86/62. The abstract reports that agents often produce solutions that fail to compile in unfamiliar languages and prototype in Python before switching to the target language. ([arXiv 2607.22807v2](https://arxiv.org/html/2607.22807v2); [abstract](https://arxiv.org/abs/2607.22807))
- EsoLang-Bench (Sharma and Chopra; Mar 2026, v2 May 2026): the same 80 problems reach 100% in Python and JavaScript for GPT-5.4 xhigh and Gemini 3.1 Pro (98.8% for Kimi K2.5 and Qwen3-235B), while the esoteric versions score 0% to 11%. ([arXiv 2603.09678v2](https://arxiv.org/html/2603.09678v2); [abstract](https://arxiv.org/abs/2603.09678))
- KX QEval (q/kdb+; article Aug 10, 2026): when QEval launched in Aug 2025 the best models reached 74% pass@10; in 2026 Claude Opus 4.8 reaches 80.7% pass@10 one-shot, and coding agents reach 97.6% (Claude Opus 5), 95.1% (Fable 5 with skill), 94.5% (GPT-5.5 with skill), 88.4% (Claude Opus 4.8 with skill), 70.1% (Claude Sonnet 4.6 with skill), 37.2% (Claude Haiku 4.5 with skill). KX revised the grader, so old and new scores are not directly comparable. ([KX](https://kx.com/blog/llms-qeval-q-kdb-code-generation/))
- "Perish or Flourish?" (Jan 2026): FPBench, 721 tasks in Haskell, OCaml, Scala with Java as baseline, GPT-3.5/GPT-4o/GPT-5; performance "improves substantially with model advancement", error rates "remain significantly higher in purely functional languages" (Haskell, OCaml), and models "frequently generate non-idiomatic functional code that follows imperative patterns". Per-language numbers not in the abstract. ([arXiv 2601.02060](https://arxiv.org/abs/2601.02060))
- Informal test (HackerNoon, Mar 2026): 100 LeetCode problems in four languages; performance correlates with language popularity and Elixir trails Python and Java for most models. Low rigor. ([HackerNoon](https://hackernoon.com/lite/comparing-llms-coding-abilities-across-programming-languages))
- **[STALE <2024]** May 2023 GPT-4 test: success roughly tracked GitHub push rank; Python, JavaScript, Lua, and Julia passed; Ruby and Rust were mixed; Factor and Janet failed every attempt. ([vgel.me](https://vgel.me/posts/gpt4-javascript/))

### Inferences

- At the frontier, mainstream-language coding has converged: Aider polyglot reached 88% in 2025 and SWE-bench Multilingual aggregates reached roughly 87% to 90% in 2026 versus 42.67% for the 2025 per-language baseline. Remaining per-language variation in mainstream languages is smaller than model-to-model variation.
- AutoCodeBench's cross-language numbers are not comparable difficulty (each language has its own generated problems, and filtering may inflate low-resource scores). "Ruby 61 vs Python 40" does not mean models write Ruby better; use it only to compare models within a language.
- With execution feedback, frontier models solve OCaml and q at 95% to 98%, so for languages with some public training data the residual cost of a less common language is mostly extra iterations and tokens, not outright failure. That premium is real (see Section 3: OCaml 1.28x to 1.69x Python's token cost).
- For no-resource and esoteric languages, feedback loops do not rescue performance (EsoLang-Bench peak 11.2%; Gleam and MoonBit near 0% zero-shot on hard tasks). The gap narrowing is a training-data effect, not a reasoning effect.
- Low-resource performance is model-family dependent (Claude led on low-resource languages in AutoCodeBench; GPT-5.5 gained most from q skills). A runtime benchmark that uses a niche language should test at least two model families.

### Gaps

- I found no 2025 or 2026 frontier-model MultiPL-E numbers; frontier labs no longer publish them, and the recent MultiPL-E studies use small or open models.
- HumanEval-X and xCodeEval (both 2023) were not re-examined; they are pre-2024 and stale for frontier models.
- Aider polyglot publishes no per-language breakdown, and its board predates the 2026 models.
- No per-language SWE-bench Multilingual numbers for 2026 frontier models were found.
- Multi-LCB per-model numbers could not be verified against the paper.

## 2. Evidence for niche embedded languages, whether documentation or few-shot examples mitigate drops, and restricted language subsets

### Takeaway

Quality does drop for niche languages, and the drop tracks training-data volume: Lua/Luau, Starlark, and MicroPython look close to mainstream; jq, Tcl, Scheme/Racket, Clojure, R, and q are usable but weaker or under-measured; APL, Janet, Gleam, MoonBit are weak; Rhai, Rune, Wren, Roc, BQN, and K have no evidence at all. Documentation in the prompt helps little or not at all; few-shot examples help modestly; **execution feedback is the strongest mitigation** and its benefit shrinks as base fluency rises. No study measures how often models write unsupported features in a restricted Python subset (Monty, Starlark), but Monty now rejects them before execution and recommends type checking instead of prompt rules.

### Cited Findings

**Lua / Luau**

- LuauBench (community benchmark; 61 models; 30 Luau tasks, each run 3 times; weights: logic completion 35%, bug correction 35%, type system 15%, execution tests 15%; page "Updated: 07/03/2026"): GPT-5.4 80.3%, Gemini 3 Flash Preview 77.9%, Claude Opus 4.6 77.5%, Claude Opus 4.5 77.5%, Kimi K2 0711 77.4%, Claude Haiku 4.5 76.7%, GPT-5.2 Chat 76.7%, Claude Sonnet 4.6 75.8%, GPT-5.2-Codex 74.5%. Some strong models score near zero (Gemini 3 Pro Preview 4.8%, Kimi K2.5 2.7%, GLM 4.7 Flash 0.0%), which suggests harness or output-format failures rather than language knowledge. ([LuauBench](https://luaubench.pages.dev/); [methodology](https://luaubench.pages.dev/methodology))
- Roblox's OpenGameEval (Dec 2025) is an open-source benchmark of 47 manually curated Roblox Studio test cases scored with executable unit tests (pass@k, cons@k, all@k). I did not retrieve per-model results. ([Roblox newsroom](https://about.roblox.com/newsroom/2025/12/opengameeval-benchmark-agentic-ai-assistants-roblox-studio))
- MultiPL-E evidence above: Lua is only 3.6 points below Java on average across six 2023 and 2024 models, the smallest gap of the four low-resource languages. ([alphaXiv summary of 2501.19085](https://www.alphaxiv.org/abs/2501.19085))

**Starlark**

- A 2025 ACL Findings paper says build configuration has no dedicated evaluation and that only about 1% of SWE-bench patches touch build configuration. ([ACL Findings 2025](https://preview.aclanthology.org/landing_page/2025.findings-acl.528.pdf))
- A practitioner reports that "LLMs seem to have enough training set data to be fluent in Starlark". Anecdote, not a measurement. ([stanislav.blog, via reader](https://hn.jakechampion.name/reader/https://stanislav.blog/bazel-is-not-scary-anymore/))

**jq**

- jqBench (Verbruggen, Parnin, Le, Gulwani; ICLR 2026): 1,496 Stack Overflow instances (jqStack) and 859 Spider-derived instances (jqSpider); "the best model (Opus 4.1) scores 76% on the jqStack benchmarks and 81% on the jqSpider benchmarks" using implicit feedback; "jq lags behind Python"; "access to the documentation surprisingly does not help"; "automatic feedback (and therefore examples) is crucial". ([jqBench](https://mlanthology.org/iclr/2026/verbruggen2026iclr-jqbench/))
- jq-bench (Hugging Face) has 30 hand-curated tasks; frontier-model scores are listed as future work. ([jq-bench dataset](https://huggingface.co/datasets/DominuZ/jq-bench))

**SQL (reference)**

- BIRD: Google's Gemini-SQL2 (built on Gemini 3.1 Pro) posted 80.04% execution accuracy on the single-model track in June 2026; Huawei's DataGallery-Text2SQL system ranked first overall at 82.39% EX as of 2026-09-09; the human baseline is 92.96%. These are secondary news reports, not the live leaderboard. ([aiweekly](https://aiweekly.co/alerts/googles-gemini-sql2-tops-bird-text-to-sql-at-8004); [Technology Magazine](https://technologymagazine.com/news/huawei-datagallery-tops-benchmark-for-enterprise-text2sql-ai))

**Clojure, Scheme, Tcl**

- PtcRunner (an Elixir library) uses PTC-Lisp, described as "a small, safe, deterministic subset of Clojure designed for Programmatic Tool Calling" that is "LLM-friendly: minimal syntax, easy to generate correctly", with `pmap`/`pcalls` for concurrent tool calls. It is a 0.x project; I found no verified accuracy data. ([PtcRunner docs](https://hexdocs.pm/ptc_runner/readme.html); [PTC-Lisp spec](https://hexdocs.pm/ptc_runner/ptc-lisp-specification.html); [readme](https://ptc-runner.hexdocs.pm/readme.md))
- Scheme, Racket, and Tcl evidence is the McEval [2024], AutoCodeBench (Aug 2025), CRUXEval-X [2024], and MultiPL-E (Jan 2025) numbers in Section 1.

**K, q, APL, BQN**

- q is hard because of right-to-left evaluation, heavy operator overloading, transparent vectorization, terse syntax, and scarce public code (most production q is proprietary). Coding agents with execution raised performance from roughly 50% one-shot to over 80%; adding q skills raised agent performance to about 85% overall, but per model the skill effect was +1.2 points (Claude Opus 4.8), +6.1 points (GPT-5.5), and -1.9 points (Claude Opus 5). Vendor-reported. ([KX](https://kx.com/blog/llms-qeval-q-kdb-code-generation/))
- Dyalog (Stefan Kruger, Jul 2026): before Claude Opus 4.5 and GPT-5.2 (Nov 2025), "LLM performance on APL was abysmal"; afterward models write "passable APL – still a bit naive and Python-like"; "enabling APL evaluation unlocks a lot of APL ability in the latest models"; the setup uses `dyalogscript` evaluation and a documentation-search skill; a model still hallucinated `⎕ARG`. No benchmark. ([Dyalog blog](https://dyalogprod.gos.dyalog.com/?p=56667))
- I found nothing on BQN or on K proper (only q).

**Janet, Wren, Rhai, Rune, Roc**

- **[STALE <2024]** GPT-4 (May 2023) "started actively hallucinating operators and functions that didn't exist" in Factor and Janet; in Janet, `==` and `bitand` are not real functions and `0b` is not a valid numeric prefix. This is the only direct evidence found for any of these five languages (see Gaps). ([vgel.me](https://vgel.me/posts/gpt4-javascript/))

**Gleam and MoonBit (no-resource languages)**

- "No Resource, No Benchmarks, No Problem?" (Giagnorio, Martin-Lopez, Bavota; Jun 2026) evaluated GPT-4o, o3-mini, and Qwen 2.5/Qwen 3 models. Zero-shot on McEval-Hard: high-resource 59% to 89%, low-resource 27% to 84%, no-resource 0% to 1% (best: o3-mini on MoonBit, 1%). Zero-shot on HumanEval/MBPP for no-resource languages: 0% to 20%, average 9%. 5-shot: GPT-4o on Gleam 15.45% / 30.37% / 1.23% (HumanEval / MBPP / McEval-Hard); o3-mini on MoonBit 39% / 46% / 12%. ([HF paper page 2606.16827](https://huggingface.co/papers/2606.16827); [arXiv PDF](https://arxiv.org/pdf/2606.16827))
- Same paper: few-shot beat retrieval of documentation (RAG) in 7 of 12 Gleam cases and 8 of 12 MoonBit cases, and cut syntax errors by 15.36% versus 8.94% for RAG. An in-prompt language manual gave Qwen 2.5 Coder 32B Instruct Gleam 15.58 / 25.07 / 1.76 and MoonBit 32.47 / 39.44 / 6.61, which the authors call an optimistic upper bound. Further pre-training plus "instruction transfer" was best (Gleam up to 26%, MoonBit 33% on McEval-Hard) but requires model weights. ([HF paper page 2606.16827](https://huggingface.co/papers/2606.16827))
- SWE-AGI (Feb 2026) uses MoonBit as its implementation language partly because it is largely absent from pretraining corpora. ([arXiv 2602.09447](https://arxiv.org/pdf/2602.09447))
- MoonBit's own materials claim AI-friendliness (flat code that is KV-cache friendly, a type-aware sampler that avoids some type errors, internal first-attempt success); no independent methodology. ([MoonBit blog](https://www.moonbitlang.com/blog/moonbit-ai); [LLM4Code 2024 paper](https://conf.researchr.org/details/icse-2024/llm4code-2024-papers/9/MoonBit-Explore-the-Design-of-an-AI-Friendly-Programming-Language))

**Do documentation or few-shot examples mitigate the drop?**

- MultiPL-E low-resource study (Jan 2025): there is "no silver bullet". Few-shot was the best in-context technique for several models (Copilot on R: 32.7 to 41.1); "translation examples" from Python were "a safe bet" (+0.9 to +6.3 points); "translation rules" were weakest and made things worse for 2 of 6 models on R and 4 of 6 on Racket; fine-tuning helped only the 1B model and hurt the 33B model (R 30.2 to 25.3). ([arXiv 2501.19085](https://arxiv.org/html/2501.19085v1))
- EsoLang-Bench (2026) includes the language documentation in the zero-shot prompt; "Few-shot prompting adds only 0.8 percentage points over zero-shot" (Wilcoxon p = 0.505); interpreter-feedback self-scaffolding is the strongest strategy (GPT-5.4 xhigh reaches 11.2% on Befunge-98 versus 2.5% zero-shot); an LLM critic performs about the same as raw interpreter feedback (Spearman 0.94, p = 0.803). ([arXiv 2603.09678v2](https://arxiv.org/html/2603.09678v2))
- NeurIPS 2025 esoteric-language paper (Minipy, Pyth, Rhokell, 0815): with documentation and sparse examples, LLMs "can now generate some correct code ... however, performance remains far below" common languages; inserting verified solutions as examples raised Pyth from 16.67% to 30.82% and Minipy HumanEval from 51% to 65%. ([NeurIPS 2025](https://neurips.cc/virtual/2025/131647))
- jqBench: documentation does not help; feedback is crucial. ([jqBench](https://mlanthology.org/iclr/2026/verbruggen2026iclr-jqbench/))
- QEval: agents (execution and revision) were "the largest single advance"; skills added +1.2, +6.1, and -1.9 points depending on the model. ([KX](https://kx.com/blog/llms-qeval-q-kdb-code-generation/))
- Tokenmaxxing study: for Gemma on OCaml, 92% of failed snapshots were compile-time errors and the model often oscillated between broken attempts; agents also revise solutions that already pass. ([arXiv 2607.22807v2](https://arxiv.org/html/2607.22807v2))
- Anthropic's Tool Use Examples (concrete call examples beside the schema) raised accuracy on complex parameter handling from 72% to 90% in internal testing. ([Anthropic](https://www.anthropic.com/engineering/advanced-tool-use))

**Restricted language subsets**

- Pydantic Monty's current limitations page: supported features include functions, closures, lambdas, simple classes (no inheritance), dataclasses (limited), try/except, `with`, `match`, f-strings, async/await with `asyncio.gather`. "Rejected at parse time, with `NotImplementedError` before any code runs": class inheritance and metaclasses, `@classmethod`/`@staticmethod`/`@property`, generators (`yield`), `del`, exception groups, PEP 695 type aliases, `async with`/`async for`, wildcard imports, t-strings. Missing: user-defined exceptions, `super`, `enum`, `contextlib`, `io`, `logging`, `uuid`, `urllib`, and all third-party packages. The page advises "Turn on [type checking] rather than memorising this page" and says "Unsupported APIs generally fail before they run." ([Monty limitations](https://pydantic.dev/docs/monty/limitations/))
- At launch (Feb 2026) Monty lacked classes, `match`, and context managers; Pydantic said "from our testing LLMs strongly assume a REPL", that it would add features "if LLMs want it", and asked users to report "any Python behaviour you see LLMs wanting to use". The feature list has since grown to cover those three. ([Pydantic Monty](https://pydantic.dev/articles/pydantic-monty); [Monty limitations](https://pydantic.dev/docs/monty/limitations/))
- Pydantic's code-mode benchmark (Oct 2026) reports 0.56 failed `run_code` snippets per run for gpt-6-luna on everyday tasks (not broken down by cause) and warns "A snippet that fails halfway and gets rerun can do its first half twice"; three gpt-6-luna long-tier failures created duplicate records. ([Pydantic](https://pydantic.dev/articles/why-code-mode-is-the-future))
- smolagents' `LocalPythonExecutor` is an AST-walking interpreter: imports are disallowed unless allowlisted, submodule access is blocked, operation counts are capped, and "Any operation that has not been explicitly defined in our custom interpreter will raise an error". ([smolagents docs](https://huggingface.co/docs/smolagents/tutorials/secure_code_execution))
- Gemini's code execution tool lets the model regenerate code after an error "up to 5 times". ([Gemini docs](https://aistudio.google.com/docs/code-execution))
- EmbedBench: top models reach 73.8% when porting an Arduino C++ design to MicroPython on a Raspberry Pi Pico, which the overview attributes to MicroPython's higher-level libraries compared with ESP-IDF C. ([alphaXiv overview](https://www.alphaxiv.org/overview/2506.11003v3))

### Inferences

- Lua/Luau and the Python subsets are the best "cheap runtime, still fluent" candidates. Lua's measured gap to mainstream languages is small and frontier models cluster tightly on LuauBench; Python subsets inherit Python fluency as long as violations are reported before execution with clear errors.
- The Minipy result (51% versus near-ceiling Python) is a warning for Python lookalikes: surface similarity to Python does not guarantee Python-level accuracy when semantics or builtins differ. Monty and Starlark should be measured directly, especially the first-attempt rate of unsupported-feature errors.
- Documentation in the prompt is the weakest lever (jqBench and EsoLang-Bench found no benefit; few-shot beat RAG for Gleam and MoonBit). Worked examples of the exact host API and an interpreter error loop should be the default harness for any non-T1 language in the benchmark.
- Skills and documentation matter less as models improve (q skills: -1.9 to +6.1 points). For frontier models the main cost of a T2 or T3 language is extra iterations, which shows up as tokens and latency rather than task failure.
- Rhai, Rune, Wren, and Roc have syntax close to Rust, JavaScript, or ML-family languages, so models will likely produce plausible code mixing in host-language idioms (the Janet hallucinations are the only direct evidence of this failure mode, and they are from 2023).
- A failed snippet that already called side-effecting tools is a correctness hazard in code mode; tool APIs used for the benchmark should be idempotent or the harness should count duplicate side effects.

### Gaps

- No public measurement of how often models emit unsupported features under Monty, Starlark, smolagents' interpreter, or MicroPython, or of the retry cost by error cause.
- No benchmarks found for Rhai, Rune, Wren, Roc, BQN, or K; nothing for Janet since 2023, Tcl since McEval 2024, or Clojure with frontier models.
- LuauBench is a community benchmark with anomalous near-zero scores for some strong models; OpenGameEval per-model results were not retrieved.
- A PTC-Lisp "demo benchmark" reportedly reached 99.3% (149/150) for one model in May 2026, but that figure came only from a search snippet and the benchmark page returned HTTP 404, so it is unverified. ([ptc-runner benchmark page, 404 at fetch time](https://ptc-runner.hexdocs.pm/benchmark-eval.html))
- The Gleam and MoonBit study used GPT-4o and o3-mini, not 2026 frontier models; current frontier performance on those languages is unknown.

## 3. Token efficiency: tokens per equivalent program across languages

### Takeaway

On static size, dynamic and type-inferred languages are cheapest: Clojure was the most token-efficient of 19 mainstream languages (109 tokens per Rosetta Code task, GPT-4 tokenizer), J was lower still (70), APL lost its terseness to glyph tokenization (110), C was worst (2.6x Clojure), JavaScript was the most verbose dynamic language, and TypeScript costs about 31% more than JavaScript because of annotations. But **total agent token cost is dominated by fluency**, not verbosity: agents are cheapest in Python, and OCaml costs 1.28x to 1.69x more tokens than Python even though the final solutions are similar in size.

### Cited Findings

- Martin Alderson (Jan 8, 2026): Rosetta Code tasks (acmeism/RosettaCodeData mirror) that have solutions in all 19 selected languages, tokenized with Xenova/gpt-4 (a port of the GPT-4 tokenizer). TypeScript was excluded for lack of tasks. Clojure was most efficient (109 tokens average); C was least efficient (2.6x Clojure); Haskell and F# were "barely less efficient" than the best dynamic languages (attributed to type inference); dynamic languages were generally more efficient; JavaScript was the most verbose dynamic language. In updates, APL placed 4th at 110 tokens on a smaller like-for-like set because glyphs such as ⍳, ⍴, ⌽ tokenize into multiple tokens, and J averaged 70 tokens, "nearly half of Clojure". The author calls it "not a scientific study". ([Alderson](https://martinalderson.com/posts/which-programming-languages-are-most-token-efficient/))
- The full per-language values are only in a chart image; discussion notes that Julia's `end` may be a single token and that results depend on the tokenizer. ([Julia Discourse](https://discourse.julialang.org/t/julia-is-one-of-the-most-token-efficient-programming-languages/134996))
- Some secondary write-ups misreport the study's tokenizer; the primary post names Xenova/gpt-4. Secondary posts also rank Ruby second among mainstream languages, which the primary text does not state. ([UBOS summary](https://ubos.tech/news/token%E2%80%91efficient-programming-languages-rankings-and-insights/); [ivanturkovic](https://www.ivanturkovic.com/2026/01/17/ruby-token-efficiency-llm-ai-friendly-language/))
- TypeScript vs JavaScript (Kucherenko, HackerNoon, Jul 2, 2026): five idiomatic tasks (add, fizzbuzz, debounce, groupBy, EventEmitter) tokenized with tiktoken cl100k_base: ZeroLang 231, CoffeeScript 239, JavaScript 287, Civet 320, TypeScript 377 tokens; TypeScript is +31% over JavaScript; "The cost is the types, not the syntax." Small sample. ([HackerNoon](https://hackernoon.com/we-measured-the-llm-token-cost-of-5-languages-typescript-costs-31percent-more-than-javascript))
- Agent token consumption by language (Wu, Anderson, Guha; Jul and Oct 2026): token cost relative to Python on the same problems is significantly higher for OCaml in all five models (about 1.28x to 1.69x); Java and Rust effects are model-dependent. Median output tokens per trajectory, Python vs OCaml: Qwen3.6 2,830 vs 8,546; Gemma-4 11,099 vs 23,097; GPT-5.5 643 vs 965; Claude Sonnet 4.6 1,348 vs 1,865. Median input tokens are highest for OCaml for every model (Gemma: 84,781 OCaml vs 9,558 Python). The paper attributes OCaml's cost to iterative error recovery; median final-solution size for OCaml is in line with Java and Rust. ([arXiv 2607.22807v2](https://arxiv.org/html/2607.22807v2))
- SimPy (Sun et al., ISSTA 2024): an AI-oriented grammar for Python reduced token usage by 13.5% (CodeLlama) and 10.4% (GPT-4) while the models "maintain or even improve their performance". **[2024]** ([arXiv 2404.16333](https://arxiv.org/abs/2404.16333))
- MoonBit vendor and secondary claims: flattened code is more KV-cache friendly; one Chinese-language report found MoonBit used fewer source tokens than Rust on a database task at roughly equal cost, with the author's own caveats. ([MoonBit blog](https://www.moonbitlang.com/blog/moonbit-ai); [Sohu](https://www.sohu.com/a/1088519554_115128))
- For scale, code mode itself saves far more than any language choice: Cloudflare's 2,500-endpoint API drops from 1.17 million tokens to about 1,000 (tiktoken) ([Cloudflare](https://blog.cloudflare.com/code-mode-mcp/)); Anthropic's MCP example drops from 150,000 to 2,000 tokens (98.7%) ([Anthropic](https://www.anthropic.com/engineering/code-execution-with-mcp)); Programmatic Tool Calling cut average usage from 43,588 to 27,297 tokens (37%) ([Anthropic](https://www.anthropic.com/engineering/advanced-tool-use)); Pydantic's long-horizon tasks cost 58% less ([Pydantic](https://pydantic.dev/articles/why-code-mode-is-the-future)).

### Inferences

- Static-size ranking under the GPT-4 tokenizer, as far as published: J < Clojure ≈ APL < Haskell/F# and the other dynamic languages < JavaScript < typed mainstream languages (TypeScript, Go, Java, C#) < C. Unicode-glyph languages (APL, and by extension BQN) pay a tokenizer penalty that ASCII array languages (J, K, q) do not.
- Verbosity differences between candidate languages are tens of percent; retry penalties for a less fluent language are 1.3x to 3x; code mode's context savings versus JSON tool calls are 37% to 99.9%. The benchmark should rank languages by first-attempt success and retries before verbosity.
- For code mode, most input tokens are the tool API description and tool results, not the script. Declaring the API in a compact typed form (TypeScript declarations or Python stubs) while letting the model write untyped JavaScript or plain Python avoids the roughly 31% annotation cost of writing TypeScript; this is what Cloudflare's server does (JavaScript against typed definitions).
- Domain languages (jq, SQL) are likely the most compact way to express data transforms, but jq's lower accuracy than Python (jqBench) means a Python or JavaScript transform may be cheaper overall once retries are counted.

### Gaps

- No per-language token measurements found for Lua, Tcl, jq, bash, SQL, Janet, Wren, Rhai, Rune, Gleam, Roc, or MoonBit (beyond vendor claims).
- All published static comparisons use OpenAI tokenizers (GPT-4 or cl100k); rankings under Claude, Gemini, or o200k tokenizers were not measured.
- No study measures tokens per code-mode script across languages for the same tool API, including retries.

## 4. How code-mode systems choose their language, and the reasons they give

### Takeaway

There are two camps. TypeScript/JavaScript in V8 isolates (Cloudflare Code Mode; Anthropic's "code execution with MCP" design) and Python (Anthropic Programmatic Tool Calling, OpenAI Code Interpreter, Gemini code execution, smolagents, Pydantic Monty), plus one small Clojure-subset DSL (PtcRunner). The stated reasons are training-data familiarity ("They have seen a lot of code. They have not seen a lot of tool calls"), composability, and keeping intermediate data out of context; the sandbox technology (V8 isolates versus containers versus a custom interpreter) clearly drives the choice too. No vendor has published a measured comparison of languages.

### Cited Findings

- **Cloudflare Code Mode (Sep 26, 2025; Kenton Varda and Sunil Pai):** the Agents SDK converts an MCP server's schema into a TypeScript API with doc comments (input and output interfaces, functions on a `declare const codemode` object returning Promises). Reasons: "LLMs have an enormous amount of real-world TypeScript in their training set"; tool calling "must be specially trained ... based on synthetic training data"; LLMs "have seen a lot of code. They have not seen a lot of 'tool calls'". Code runs in a fresh V8 isolate per snippet via the Dynamic Worker Loader API; `fetch()` and `connect()` throw; tools are reached through bindings; API keys stay with the supervisor. No accuracy, latency, or token numbers. ([Cloudflare](https://blog.cloudflare.com/code-mode/))
- **Cloudflare Code Mode MCP server (Feb 20, 2026; Matt Carey):** two tools, `search()` and `execute()`; the agent "writes JavaScript against a typed representation of the OpenAPI spec", while in the client-side version "The model writes TypeScript against typed SDKs"; 1.17 million tokens without Code Mode versus about 1,000 with it ("reduces the number of input tokens used by 99.9%"); runs in "a lightweight V8 sandbox with no file system, no environment variables". No accuracy evaluation. ([Cloudflare](https://blog.cloudflare.com/code-mode-mcp/))
- **Anthropic, "Code execution with MCP" (Nov 4, 2025):** tools presented as a file tree of TypeScript files (`servers/google-drive/getDocument.ts`) with typed input and response interfaces; agents list directories and read only what they need; 150,000 tokens to 2,000 (98.7%); cites Cloudflare's finding that "LLMs are adept at writing code"; drawbacks: agent-generated code "requires a secure execution environment", sandboxing, resource limits, and monitoring. ([Anthropic](https://www.anthropic.com/engineering/code-execution-with-mcp))
- **Anthropic Programmatic Tool Calling (Nov 24, 2025):** Claude writes Python that runs in the Code Execution sandbox; "Code is a natural fit for orchestration logic, such as loops, conditionals, and data transformations"; 37% fewer tokens; internal knowledge retrieval 25.6% to 28.5%; GIA benchmarks 46.5% to 51.2%; a 20-call orchestration avoids 19 or more inference passes. ([Anthropic](https://www.anthropic.com/engineering/advanced-tool-use))
- **OpenAI Code Interpreter:** "Allow models to write and run Python to solve problems" in a hosted container. No language rationale published. ([OpenAI docs](https://developers.openai.com/api/docs/guides/tools-code-interpreter))
- **Google Gemini code execution:** "Gemini is only able to execute code in Python"; preinstalled numpy, pandas, matplotlib, scipy, scikit-learn and others; "You can't install your own libraries"; 30-second runtime limit. ([Gemini docs](https://aistudio.google.com/docs/code-execution))
- **Hugging Face smolagents (Dec 31, 2024):** `CodeAgent` writes Python actions; reasons are composability, object management, generality ("code is built to express simply anything you can have a computer do"), and "Representation in LLM training corpus"; cites the CodeAct paper; sandboxes via E2B, Docker, Modal, Blaxel, or a restricted local AST interpreter. The blog's comparison chart has no published numbers in the text ("spoilers: code works better"). ([HF blog](https://huggingface.co/blog/smolagents); [smolagents docs](https://huggingface.co/docs/smolagents/tutorials/secure_code_execution))
- **Pydantic Monty (launch Feb 27, 2026; Samuel Colvin):** a Python interpreter written in Rust for LLM-written code; start latency 0.004 ms versus Docker 195 ms, sandbox services about 1,000 ms or more, Pyodide 2,800 ms; about 4.5 MB package; bundled `ty` type checking (4.8 ms with checking, 4.5 µs without); a JavaScript API is in progress. The launch post does not explain why Python rather than JavaScript. ([Pydantic Monty](https://pydantic.dev/articles/pydantic-monty)) The README describes an MIT-licensed "Python 3.14 sandbox" that "avoids the latency, complexity and cost of a container based sandbox", starting in under 1 ms from a running pool versus about 1,500 ms for a sandbox service. ([GitHub](https://github.com/pydantic/monty))
- **Pydantic code-mode results (Oct 28, 2026; Michael Pfaffenberger):** 5,276 graded runs across 8 models on five small CRUD apps; long-horizon tasks: cost -58%, wall time -51%, success +16.0 points; everyday tasks: cost -16%, wall time -11%, success roughly flat (+1.6, noise). The author argues "models are much better at writing a loop than at being one" and guesses code helps because "code is checkable", labeled as a guess. ([Pydantic](https://pydantic.dev/articles/why-code-mode-is-the-future))
- **PtcRunner (Elixir):** PTC-Lisp, a Clojure subset, with tools "discovered in a REPL rather than listed in the prompt", running in isolated BEAM processes with resource limits. ([PtcRunner readme](https://ptc-runner.hexdocs.pm/readme.md); [PtcRunner docs](https://hexdocs.pm/ptc_runner/readme.html))

### Inferences

- Language choice is coupled to the sandbox. The TypeScript/JavaScript camp gets millisecond-scale isolates with no filesystem; the Python camp historically paid for containers (hundreds of ms to seconds) to get the data-science stack, and Monty and smolagents trade the stack for a fast restricted interpreter. The benchmark should separate language fluency from runtime cost so the trade can be seen explicitly.
- Every major vendor picked a T1 language. Nobody shipping code mode at scale uses a niche language, and the one DSL design (PTC-Lisp) has no public accuracy data.
- Restricted Python runtimes (Monty, smolagents' local executor) give up third-party packages, so "data processing" and "artifact generation" scripts must lean on host-provided tools; full-Python sandboxes (OpenAI, Gemini, Anthropic) keep pandas and matplotlib. This matters for the data-processing and artifact workloads in the benchmark plan.

### Gaps

- No vendor has published an A/B test of the same code-mode harness in Python versus TypeScript/JavaScript, or versus Lua.
- OpenAI and Google document Python-only execution but give no rationale.
- Cloudflare published no accuracy data for Code Mode, only token counts.
- A vendor case study (Factory) reportedly saw a Terminal-Bench gain and lower model spend after adopting Code Mode, but it appeared only in secondary summaries and was not verified.

## 5. Do typed tool APIs (TypeScript declarations, Python type hints) improve tool-calling accuracy in code mode compared with JSON tool calls?

### Takeaway

Code mode with typed stubs beats or matches JSON tool calling for most current models, with the largest gains on chained, high-fan-out, and long-horizon tasks; it is neutral or worse on simple and parallel calls and for older models. **No controlled study isolates the contribution of the types themselves** (typed versus untyped signatures, or TypeScript declarations versus Python stubs). The indirect evidence says type information helps most as a pre-execution check (most compile errors are type errors) and that concrete examples improve parameter accuracy more than schemas alone.

### Cited Findings

- **"The Bitter Lesson of Tool Calling" (Patel, Sen, Lumer, Subbiah, PwC; Aug 6, 2026):** tools are exposed as typed Python stubs compiled from BFCL v4 schemas; 14 models. PTC "matches or exceeds native JSON tool calling in 11 of 14 models". JSON vs PTC overall: Claude Haiku 4.5 81.9 vs 85.8; Claude Sonnet 4.5 86.4 vs 87.7; Claude Sonnet 4.6 80.9 vs 87.4; Claude Opus 4.8 84.8 vs 84.8; Claude Sonnet 5 84.5 vs 86.1; GPT-4o 81.9 vs 55.0; GPT-4.1 81.9 vs 62.1; GPT-5-nano 66.7 vs 68.3; GPT-5 71.5 vs 76.1; GPT-5.4-mini 79.3 vs 55.0; GPT-5.4 79.3 vs 81.9; GPT-5.6-Luna 76.1 vs 80.3; GPT-5.6-Sol 72.2 vs 82.8; GPT-5.6-Terra 73.5 vs 84.1. ([arXiv 2608.06370](https://arxiv.org/html/2608.06370v1))
- Same paper, macro-averaged categories (JSON vs PTC): simple 86.1 vs 89.5; multiple 95.4 vs 93.9; parallel and parallel_multiple 85.5 vs 71.4; live_simple 76.6 vs 76.3; live_multiple 73.1 vs 83.0; live_parallel 66.1 vs 56.8; overall 78.6 vs 77.0. PTC trails JSON by 14.1 points on parallel categories, partly because GPT-4o, GPT-4.1, and GPT-5.4-mini write literal "\n" escape sequences instead of newlines and produce syntax errors. In a fan-out probe on Claude Sonnet 5 at N=100, JSON enumeration accuracy was 0% and PTC was 100%. GPT-5 ran at 2.8x baseline latency under PTC. The paper does not test type hints against untyped stubs or other languages. The abstract gives the GPT-5.6 gain as 10.6 points and the conclusion as 10.7. ([arXiv 2608.06370](https://arxiv.org/html/2608.06370v1))
- Secondary summaries of the paper report the largest gains on long chains (an 18.8-point gap at chains of 12 or more); I could not confirm that figure in the fetched text. ([co-r-e](https://co-r-e.com/method/programmatic-tool-calling); [Daniel Vaughan](https://codex.danielvaughan.com/2026/08/12/bitter-lesson-tool-calling-programmatic-vs-json-codex-cli-mcp-agent-tool-use/))
- **Pydantic code mode (Oct 2026), success with code mode off then on, long-horizon tier:** gpt-6.1-sol 92% to 100% (noise); gpt-6-luna 14% to 58%; gpt-6-astra 86% to 92% (noise); claude-haiku-5-5 64% to 94%; claude-sonnet-5-5 83% to 100%; muse-spark-1.3-contributor 94% to 97% (noise); muse-wonder-1.0-contributor 100% to 100%; deepseek-v4.1-flash 81% to 100%. Everyday tier: mostly flat, gpt-6-luna 66% to 85%, muse-spark-1.3-contributor 98% to 92% (worse). ([Pydantic](https://pydantic.dev/articles/why-code-mode-is-the-future))
- **Anthropic Programmatic Tool Calling:** knowledge retrieval 25.6% to 28.5%; GIA 46.5% to 51.2%. **Tool Use Examples:** complex parameter handling 72% to 90%. **Tool Search:** Opus 4 49% to 74%, Opus 4.5 79.5% to 88.1% on MCP evaluations. ([Anthropic](https://www.anthropic.com/engineering/advanced-tool-use))
- **Type-constrained decoding (Mündler et al., PLDI 2025):** on HumanEval and MBPP in TypeScript, 94% of compilation errors came from failing type checks; type-constrained decoding "reduces compilation errors by more than half" and raises functional correctness by 3.5% to 5.5% relative, for open models from 2B to 34B. ([arXiv 2504.09246](https://arxiv.org/abs/2504.09246); [PLDI 2025](https://pldi25.sigplan.org/details/pldi-2025-papers/25/Type-Aware-Constraining-for-LLM-Code-Generation))
- AI agents writing TypeScript use the `any` escape hatch about 9 times as often as humans (mined from projects, not a correctness study). ([arXiv 2602.17955](https://arxiv.org/html/2602.17955v1))
- Monty bundles the `ty` type checker to check model code against user-supplied stubs and recommends type checking to catch unsupported APIs before execution. ([Pydantic Monty](https://pydantic.dev/articles/pydantic-monty); [Monty limitations](https://pydantic.dev/docs/monty/limitations/))
- **[STALE <2024]** May 2023 GPT-4 maze task: prompting with JavaScript-style function calls took 17.60 steps on average versus 24.40 for a custom DSL, and three DSL runs hit the step limit. ([vgel.me](https://vgel.me/posts/gpt4-javascript/))

### Inferences

- The accuracy benefit of code mode comes mainly from moving control flow (loops, chaining, filtering, fan-out) out of the model, and it scales with task length; it is not evidence that types per se help.
- Types are most useful as compact API documentation plus a pre-execution checker (`tsc` or `ty`): they turn runtime tool-argument errors into cheap, pre-side-effect failures. That argues for runtimes with a fast type-check pass (Monty with `ty`, TypeScript checked before running) over runtimes that only fail at call time, especially given the duplicate-write hazard of partial reruns.
- Parallel fan-out is the weak spot for code mode with weaker models. The benchmark should include explicit parallel-call tasks (`Promise.all`, `asyncio.gather`, Lua coroutines) and check for escape-sequence and formatting failures in how the script is delivered.
- Older or smaller models can regress badly under code mode (GPT-4o -26.9 points, GPT-5.4-mini -24.3 on BFCL), so per-model results matter as much as per-language results.

### Gaps

- No controlled study compares typed versus untyped tool signatures within code mode, or TypeScript declarations versus Python stubs for the same tools and model.
- The CodeAct paper's numbers (cited by smolagents) were not re-verified in this pass.
- No study measures whether a type-check pass before execution reduces total retries or tokens in code mode.
