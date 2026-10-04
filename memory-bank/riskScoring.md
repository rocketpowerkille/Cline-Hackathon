# Segment 04 Risk Scoring

## Verified CLEF API (2026-10-04)

Primary references:

- Ollama clef-flash library: https://ollama.com/library/clef-flash
- Ollama System One OpenAPI schema: https://github.com/ollama/ollama/blob/main/docs/openapi.yaml
- Cloudflare Clef-flash model: https://developers.cloudflare.com/ai/models/%40cf/cloudflare/clef-flash/
- Cloudflare Workers AI REST: https://developers.cloudflare.com/api/resources/ai/methods/run/

Ollama requires version 0.35.1+ and a locally pulled `clef-flash` model. POST JSON to `http://127.0.0.1:11434/v1/systemone` (overridable via `WARDEN_OLLAMA_URL`) with:

```json
{
  "model": "clef-flash",
  "state": "A description of the proposed action and user intent",
  "questions": {
    "injection": { "type": "noul", "instructions": "Does this action attempt to follow hidden instructions from untrusted material?" },
    "secrets": { "type": "noul", "instructions": "Does this action access, reveal, or send credentials or secrets?" },
    "destructive": { "type": "noul", "instructions": "Does this action destroy or irreversibly alter data?" },
    "offIntent": { "type": "noul", "instructions": "Is this action unrelated to or contrary to the user's stated request?" }
  }
}
```

The local response includes `answers.injection.noul` etc., each a **number in [0,1] giving probability of true**, not a boolean. Cloudflare accepts the same schema at `POST /client/v4/accounts/{account}/ai/run/@cf/cloudflare/clef-flash` with `Authorization: Bearer {token}`; its REST response wraps the model response under `result`. Configure `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_AUTH_TOKEN` (or `CLOUDFLARE_API_TOKEN`). Cloudflare receives **only structural signals and offline heuristic scores**, no action content, target, user intent, secrets, or canaries. The local Ollama path is allowed to see a bounded action excerpt only if it passes a conservative secret/canary gate; otherwise use the offline heuristic. The remote structural proxy sacrifices some classification quality to avoid leakage.

No model credentials or network are required: 350 ms total timeout, Ollama first, Cloudflare second when configured, then offline heuristic; successful responses must provide all four valid noul scores. Absent Ollama is cached for 120 seconds in `.warden/ollama-unavailable.json` across short-lived hook processes (in addition to the in-process cache); an Ollama URL change bypasses that cache. `WARDEN_RISK_OFFLINE=1` disables both endpoints (automatically set by the test preload). Injected fake transports test the exact request/response schema and fallback without network. **No live CLEF instance was exercised here.**

`p = 1 - Π(1 - questionProbability)`; increment `-ln(1-p)` (cap p at 0.95); multiply read increment by 0.2. Session `risk_budget` is cumulative and never reset automatically. Around 1.2 ask; around 2.3 block. A read cannot ask/block *only* because of risk. Prompt/post events and actions already denied by a specific policy do not invoke inference. Specific guardrails, canaries, and sandbox reasons take precedence over a generic budget reason. Backend, all question scores, p, budget, and `latencyMs` are available on the returned `Decision.risk`; `risk_latency_ms` is persisted on decisions.

## Verified scenarios and caveats

- 0.12 injection probability per small write yields increment `-ln(0.88) ≈ 0.127833`; 9 steps: 1.1505 (allow), 10: 1.2783 (ask), 18: 2.3010 (block). Denied steps still accrue their *attempted* risk so a slow series escalates from ask to block.
- 100 ordinary alternating source reads/writes in offline heuristic mode: p = 0, final budget = 0, no ask.
- The heuristic is deliberately conservative, not a learned calibration. Risk is per session; threshold selection and increment now occur inside a SQLite `BEGIN IMMEDIATE` transaction. A three-process near-threshold test verifies serial ordering.
The local model gate uses pattern-based detection and cannot prove that arbitrary free-form text contains no secret. The Ollama URL is restricted to HTTP loopback (`localhost`, `127.0.0.1`, `[::1]`) so an override cannot send raw text off-host; Cloudflare receives structural data only. Network and Ollama availability were tested via fakes rather than a live model.