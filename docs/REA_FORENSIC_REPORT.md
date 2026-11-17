# SimpleTun — REA (`morluto/rea`) Forensic Analysis & Clean-Room Verification Report

## 1. Overview
SimpleTun is an open-source clean-room clone of [SimpliGen](https://www.simpligen.io/) constructed from forensic static JavaScript application analysis and artifact inspection performed with **REA** (`rea-agents@6.9.0`, [github.com/morluto/rea](https://github.com/morluto/rea)).

---

## 2. Analyzed Upstream Targets & Observed REA Metrics

| Target | SHA-256 Digest | Parsed JS Files | Bytes Read | AST Nodes Visited | Findings | Parse Failures | Evidence File |
|---|---|---|---|---|---|---|---|
| `@simpligen/mcp@0.9.1` (`rea-evidence/targets/simpligen-mcp/package`) | `54fa05c4eb4a623c680ead8895dac0a2b4fbacd86d20a396e542a9fe47745dde` | 8 | 84,489 | 9,076 | 65 | 0 | `rea-evidence/mcp-evidence.json` |
| `simpligen.io` Next.js Web Chunks (`rea-evidence/targets/simpligen-web`) | `8672c49e3fd86a7d1e4eae3941494ed68cba7862415890ac3957bcc2707dd3b4` | 12 | 629,656 | 119,278 | 215 | 0 | `rea-evidence/web-chunks-evidence.json` |

### Key Recovered Contracts from `@simpligen/mcp@0.9.1`
1. **74 MCP Tools** (`TOOL_NAMES`), including:
   - Core & Engine Lifecycle (`list_capabilities`, `get_status`, `start_engine`, `stop_engine`, `restart_engine`, `list_projects`, `create_project`, `upload_file`, `generate`, `list_loras`, `get_prompt_guide`, `get_job`, `wait_for_result`, `list_jobs`, `cancel_job`, `prepare_preset`, `get_result_image`)
   - In-App Assistant / Approvals (`wait_for_approval`, `get_app_context`, `fill_generate_form`, `open_screen`)
   - Character Studio (`list_characters`, `get_character`, `list_character_features`, `list_character_presets`, `remove_character`, `create_character`, `generate_character_image`, `generate_character_video`, `generate_character_frame`, `animate_character`, `set_character_preset`, `enhance_character_media`, `regenerate_character_base`, `accept_character_base`)
   - Recipe Composer & Studios (`list_recipe_blocks`, `compose_recipe`, `validate_recipe`, `list_recipes`, `get_recipe`, `publish_recipe`, `run_recipe`, `get_recipe_run`, `wait_for_recipe_run`, `list_recipe_runs`, `cancel_recipe_run`, `list_subjects`, `list_products`, `create_product`, `remove_product`)
   - Video Studio & Locations (`list_films`, `create_film`, `get_film`, `update_film_settings`, `add_track`, `move_track`, `detect_tempo`, `add_clip`, `import_clip`, `update_clip`, `move_clip`, `trim_clip`, `remove_clip`, `apply_film_plan`, `set_fades`, `add_marker`, `set_export_range`, `render_clips`, `wait_for_renders`, `list_takes`, `use_take`, `export_film`, `list_locations`, `create_location`)
2. **Loopback Control API Discovery & Security Contract**:
   - Port discovery via `agent-api.json` (default `127.0.0.1:48199`).
   - Loopback-only `Host` DNS-rebinding guard (`403 forbidden_host`).
   - Bearer pairing token authentication (`401 unauthorized`) and spend cap enforcement (`402 exceeds_spend_cap`).
   - 21-minute extended socket timeout for `POST /films/:id/export`.

---

## 3. SimpleTun Self-Verification with REA

SimpleTun's server source (`./src`) was analyzed and audited with `rea-agents@6.9.0`:

| Check | Result | Artifact |
|---|---|---|
| `rea analyze-javascript-application ./src` | 10 JS files parsed, 239,875 bytes read, 36,202 AST nodes, 185 findings, 0 parse failures | `rea-evidence/simpletun-src-summary.json` |
| `rea audit-release-exposure ./src` | `exposed: 0`, `no_exposure_observed_in_assessed_checks: true` (`text.credential_markers: not_observed` across 10 scanned files) | `rea-evidence/simpletun-self-audit.json` |
| Integration Tests (`npm test`) | 10/10 passing assertions (Control API, Real Hardware Probe, Safetensors Scanner, Mock ComfyUI HTTP/WS + PNG `tEXt` metadata + Strict Mode, Real 120 BPM WAV DSP + Silent `400 no_pulse`, Character Studio, Product/UGC Recipes, Video Studio, 74-Tool MCP stdio, Electron syntax) | `tests/simpletun.test.js` |
