// packages/mcp-server/src/tools.js
// Registers all 74 SimpleTun MCP tools on the SimpleTunMcpServer instance.
import { buildResultImageContent } from "./resultImage.js";

export const TOOL_NAMES = [
  "list_capabilities", "get_status", "start_engine", "stop_engine", "restart_engine",
  "list_projects", "create_project",
  "wait_for_approval", "get_app_context", "fill_generate_form", "open_screen",
  "upload_file", "generate", "list_loras", "get_prompt_guide", "get_job", "wait_for_result", "list_jobs",
  "cancel_job", "prepare_preset", "get_result_image",
  "list_characters", "get_character", "list_character_features", "list_character_presets",
  "remove_character", "create_character", "generate_character_image", "generate_character_video",
  "generate_character_frame", "animate_character", "set_character_preset",
  "enhance_character_media", "regenerate_character_base", "accept_character_base",
  "list_recipe_blocks", "compose_recipe", "validate_recipe", "list_recipes", "get_recipe", "publish_recipe",
  "run_recipe", "get_recipe_run", "wait_for_recipe_run", "list_recipe_runs", "cancel_recipe_run",
  "list_subjects", "list_products", "create_product", "remove_product",
  "list_films", "create_film", "get_film", "update_film_settings", "add_track", "move_track", "detect_tempo",
  "add_clip", "import_clip", "update_clip", "move_clip", "trim_clip", "remove_clip", "apply_film_plan", "set_fades", "add_marker",
  "set_export_range", "render_clips", "wait_for_renders", "list_takes", "use_take", "export_film", "list_locations", "create_location",
];

export const STUDIO_TOOL_NAMES = TOOL_NAMES.slice(TOOL_NAMES.indexOf("list_films"));

const ok = (data) => ({ content: [{ type: "text", text: JSON.stringify(data, null, 2) }] });
const fail = (err) => ({ isError: true, content: [{ type: "text", text: `${err.errorCode ? err.errorCode + ": " : ""}${err.message || String(err)}` }] });
const wrap = (fn) => async (args) => {
  try {
    return ok(await fn(args || {}));
  } catch (e) {
    return fail(e);
  }
};

const dropNull = (o, keys) =>
  Object.fromEntries(Object.entries(o).filter(([k, v]) => !(keys.includes(k) && v === null)));

export function registerTools(server, client, { now = Date.now, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  server.registerTool("list_capabilities", {
    title: "List capabilities",
    description: "List every SimpleTun preset the agent can generate with (image/video), inputs/options, local readiness, and cloud cost.",
    inputSchema: {},
  }, wrap(() => client.getCapabilities()));

  server.registerTool("get_status", {
    title: "Get status",
    description: "Report local engine running state, cloud connection, credit balance, and active project.",
    inputSchema: {},
  }, wrap(() => client.getStatus()));

  server.registerTool("start_engine", {
    title: "Start engine",
    description: "Start the local engine if not running.",
    inputSchema: {},
  }, wrap(() => client.startEngine()));

  server.registerTool("stop_engine", {
    title: "Stop engine",
    description: "Stop the local engine and free VRAM.",
    inputSchema: {},
  }, wrap(() => client.stopEngine()));

  server.registerTool("restart_engine", {
    title: "Restart engine",
    description: "Restart the local engine.",
    inputSchema: {},
  }, wrap(() => client.restartEngine()));

  server.registerTool("list_projects", {
    title: "List projects",
    description: "List output container projects.",
    inputSchema: {},
  }, wrap(() => client.listProjects()));

  server.registerTool("create_project", {
    title: "Create project",
    description: "Create a new project.",
    inputSchema: { name: { type: "string" } },
    required: ["name"],
  }, wrap(({ name }) => client.createProject(name)));

  server.registerTool("upload_file", {
    title: "Upload file",
    description: "Upload a local image, video, or audio file and receive an opaque upload handle.",
    inputSchema: { path: { type: "string" } },
    required: ["path"],
  }, wrap(({ path }) => client.uploadFile(path)));

  server.registerTool("generate", {
    title: "Generate",
    description: "Start an image or video generation. Read get_prompt_guide before writing the prompt.",
    inputSchema: {
      presetId: { type: "string" },
      mediaType: { type: "string", enum: ["image", "video"] },
      prompt: { type: "string" },
      packId: { type: "string" },
      backend: { type: "string", enum: ["local", "cloud", "auto"] },
      negativePrompt: { type: "string" },
      project: { type: "string" },
      image: { type: "string" },
      referenceImages: { type: "array" },
      video: { type: "string" },
      audio: { type: "string" },
      referenceAudios: { type: "array" },
      referenceVideos: { type: "array" },
      dialogue: { type: "string" },
      dialogueDelivery: { type: "string" },
      loras: { type: "array" },
      options: { type: "object" },
    },
    required: ["presetId", "mediaType", "prompt"],
  }, wrap((args) => client.generate(args)));

  server.registerTool("list_loras", {
    title: "List LoRAs",
    description: "List installed user LoRAs.",
    inputSchema: {},
  }, wrap(() => client.listLoras()));

  server.registerTool("get_prompt_guide", {
    title: "Get prompt guide",
    description: "Read the prompting guide for a preset before writing its prompt.",
    inputSchema: { presetId: { type: "string" } },
    required: ["presetId"],
  }, wrap(({ presetId }) => client.getPromptGuide(presetId)));

  server.registerTool("get_job", {
    title: "Get job",
    description: "Get status and result of a generation job.",
    inputSchema: { jobId: { type: "string" } },
    required: ["jobId"],
  }, wrap(({ jobId }) => client.getJob(jobId)));

  server.registerTool("list_jobs", {
    title: "List jobs",
    description: "List recent generation jobs.",
    inputSchema: {},
  }, wrap(() => client.listJobs()));

  server.registerTool("cancel_job", {
    title: "Cancel job",
    description: "Cancel a queued or running job.",
    inputSchema: { jobId: { type: "string" } },
    required: ["jobId"],
  }, wrap(({ jobId }) => client.cancelJob(jobId)));

  server.registerTool("prepare_preset", {
    title: "Prepare preset",
    description: "Prepare/install a local preset pack so it becomes localReady.",
    inputSchema: {
      presetId: { type: "string" },
      mediaType: { type: "string", enum: ["image", "video"] },
      packId: { type: "string" },
    },
    required: ["presetId", "mediaType"],
  }, wrap((args) => client.preparePreset(args)));

  server.registerTool("wait_for_result", {
    title: "Wait for result",
    description: "Block until a job finishes or times out.",
    inputSchema: {
      jobId: { type: "string" },
      timeoutSeconds: { type: "number" },
      pollMs: { type: "number" },
    },
    required: ["jobId"],
  }, wrap(async ({ jobId, timeoutSeconds = 300, pollMs = 150 }) => {
    const deadline = now() + timeoutSeconds * 1000;
    while (true) {
      const { job } = await client.getJob(jobId);
      if (!job || ["completed", "failed", "cancelled"].includes(job.status)) return job;
      if (now() >= deadline) return { ...job, note: "timeout_still_running" };
      await sleep(pollMs);
    }
  }));

  server.registerTool("get_result_image", {
    title: "Get result image",
    description: "Return a completed image job inline as base64 image content.",
    inputSchema: { jobId: { type: "string" }, maxBytes: { type: "number" } },
    required: ["jobId"],
  }, async ({ jobId, maxBytes }) => {
    try {
      const { job } = await client.getJob(jobId);
      return await buildResultImageContent(job, { budgetBytes: maxBytes });
    } catch (e) {
      return fail(e);
    }
  });

  server.registerTool("wait_for_approval", {
    title: "Wait for approval",
    description: "Wait until an approval card resolves.",
    inputSchema: { proposalId: { type: "string" }, timeoutSeconds: { type: "number" } },
    required: ["proposalId"],
  }, wrap(async ({ proposalId, timeoutSeconds = 60 }) => {
    const r = await client.waitForApproval(proposalId, timeoutSeconds);
    return r;
  }));

  server.registerTool("get_app_context", {
    title: "Get app context",
    description: "Return current UI screen, selected preset/character/film, and form state.",
    inputSchema: {},
  }, wrap(() => client.getAppContext()));

  server.registerTool("fill_generate_form", {
    title: "Fill generate form",
    description: "Populate the Generate form fields in the UI without starting a job.",
    inputSchema: {
      presetId: { type: "string" },
      prompt: { type: "string" },
      negativePrompt: { type: "string" },
      characterId: { type: "string" },
      settings: { type: "object" },
    },
    required: ["presetId", "prompt"],
  }, wrap((a) => client.fillGenerateForm(a)));

  server.registerTool("open_screen", {
    title: "Open screen",
    description: "Navigate the UI to a specific screen.",
    inputSchema: { screen: { type: "string" }, id: { type: "string" } },
    required: ["screen"],
  }, wrap((a) => client.openScreen(a)));

  // ---- Character Studio ----
  server.registerTool("list_characters", { title: "List characters", description: "List saved characters.", inputSchema: {} }, wrap(() => client.listCharacters()));
  server.registerTool("get_character", { title: "Get character", description: "Get a character by ID.", inputSchema: { characterId: { type: "string" } }, required: ["characterId"] }, wrap(({ characterId }) => client.getCharacter(characterId)));
  server.registerTool("list_character_features", { title: "List character features", description: "List available identity feature options.", inputSchema: {} }, wrap(() => client.listCharacterFeatures()));
  server.registerTool("list_character_presets", { title: "List character presets", description: "List available character presets.", inputSchema: {} }, wrap(() => client.listCharacterPresets()));
  server.registerTool("remove_character", { title: "Remove character", description: "Delete a character.", inputSchema: { characterId: { type: "string" } }, required: ["characterId"] }, wrap(({ characterId }) => client.removeCharacter(characterId)));

  server.registerTool("create_character", {
    title: "Create character",
    description: "Create a character via describe ('generate') or 'upload'.",
    inputSchema: {
      name: { type: "string" },
      gender: { type: "string", enum: ["woman", "man", "nonbinary"] },
      mode: { type: "string", enum: ["generate", "upload"] },
      identity: { type: "object" },
      baseFilePath: { type: "string" },
      timeoutSeconds: { type: "number" },
      pollMs: { type: "number" },
    },
    required: ["name", "gender", "mode"],
  }, async ({ name, gender, mode, identity, baseFilePath, timeoutSeconds = 60, pollMs = 150 }) => {
    try {
      if (mode === "upload") {
        const up = await client.uploadFile(baseFilePath);
        const char = await client.createCharacter({ name, gender, mode: "upload", identity, baseHandle: up.handle });
        return ok({ ...char, ready: true });
      }
      const c = await client.createCharacter({ name, gender, mode: "generate", identity });
      const { characterId } = c;
      const deadline = now() + timeoutSeconds * 1000;
      while (true) {
        const { character } = await client.getCharacter(characterId);
        if (character?.base_image_url) return ok(character);
        if (now() >= deadline) return ok({ ...character, base_pending: true });
        await sleep(pollMs);
      }
    } catch (e) {
      return fail(e);
    }
  });

  server.registerTool("generate_character_image", {
    title: "Generate character image",
    description: "Generate scene image(s) for a character.",
    inputSchema: {
      characterId: { type: "string" },
      prompt: { type: "string" },
      aspect: { type: "string" },
      count: { type: "number" },
      presetId: { type: "string" },
    },
    required: ["characterId", "prompt"],
  }, wrap(({ characterId, prompt, aspect, count, presetId }) => client.generateCharacterImage(characterId, { prompt, aspect, count, ...(presetId ? { presetId } : {}) })));

  server.registerTool("generate_character_frame", {
    title: "Generate character frame",
    description: "Generate a single starting frame for a character.",
    inputSchema: { characterId: { type: "string" }, prompt: { type: "string" }, aspect: { type: "string" }, presetId: { type: "string" } },
    required: ["characterId", "prompt"],
  }, wrap(({ characterId, prompt, aspect, presetId }) => client.generateCharacterFrame(characterId, { prompt, aspect, ...(presetId ? { presetId } : {}) })));

  server.registerTool("animate_character", {
    title: "Animate character",
    description: "Animate a character from a completed frame job or local path.",
    inputSchema: {
      characterId: { type: "string" },
      jobId: { type: "string" },
      filePath: { type: "string" },
      motion: { type: "string" },
      aspect: { type: "string" },
      videoPresetId: { type: "string" },
    },
    required: ["characterId"],
  }, wrap(({ characterId, jobId, filePath, motion, aspect, videoPresetId }) =>
    client.animateCharacter(characterId, { frameJobId: jobId, framePath: filePath, motion, aspect, presetId: videoPresetId })));

  server.registerTool("generate_character_video", {
    title: "Generate character video",
    description: "Generate a starting frame then animate it for a character.",
    inputSchema: {
      characterId: { type: "string" },
      prompt: { type: "string" },
      motion: { type: "string" },
      aspect: { type: "string" },
      timeoutSeconds: { type: "number" },
      pollMs: { type: "number" },
      framePresetId: { type: "string" },
      videoPresetId: { type: "string" },
    },
    required: ["characterId", "prompt"],
  }, async ({ characterId, prompt, motion, aspect, timeoutSeconds = 60, pollMs = 150, framePresetId, videoPresetId }) => {
    try {
      const frame = await client.generateCharacterFrame(characterId, { prompt, aspect, presetId: framePresetId });
      const { jobIds: [frameJobId] } = frame;
      const deadline = now() + timeoutSeconds * 1000;
      while (true) {
        const { job } = await client.getJob(frameJobId);
        if (job?.status === "completed") break;
        if (job?.status === "failed") return fail({ errorCode: "frame_failed", message: `Frame failed: ${frameJobId}` });
        if (now() >= deadline) return fail({ errorCode: "frame_timeout", message: `Frame timeout: ${frameJobId}` });
        await sleep(pollMs);
      }
      const video = await client.animateCharacter(characterId, { frameJobId, motion, aspect, presetId: videoPresetId });
      return ok({ frameJobId, videoJobId: video.jobIds[0] });
    } catch (e) {
      return fail(e);
    }
  });

  server.registerTool("set_character_preset", {
    title: "Set character preset",
    description: "Set sticky default presets for a character.",
    inputSchema: { characterId: { type: "string" }, imagePresetId: { type: ["string", "null"] }, videoPresetId: { type: ["string", "null"] } },
    required: ["characterId"],
  }, wrap(({ characterId, imagePresetId, videoPresetId }) => client.setCharacterPreset(characterId, { imagePresetId, videoPresetId })));

  server.registerTool("enhance_character_media", {
    title: "Enhance character media",
    description: "Upscale/enhance a character image, video, or base portrait.",
    inputSchema: {
      characterId: { type: "string" },
      jobId: { type: "string" },
      filePath: { type: "string" },
      target: { type: "string" },
      mediaType: { type: "string" },
      presetId: { type: "string" },
      scale: { type: "number" },
      keepResolution: { type: "boolean" },
      applyAsBase: { type: "boolean" },
    },
    required: ["characterId"],
  }, wrap(({ characterId, ...rest }) => client.enhanceCharacterMedia(characterId, rest)));

  server.registerTool("regenerate_character_base", {
    title: "Regenerate character base",
    description: "Regenerate a character's base portrait in place.",
    inputSchema: { characterId: { type: "string" }, basePresetId: { type: "string" }, identity: { type: "object" }, timeoutSeconds: { type: "number" }, pollMs: { type: "number" } },
    required: ["characterId"],
  }, async ({ characterId, basePresetId, identity, timeoutSeconds = 60, pollMs = 150 }) => {
    try {
      const regen = await client.regenerateCharacterBase(characterId, { basePresetId, identity });
      const { baseJobId } = regen;
      const deadline = now() + timeoutSeconds * 1000;
      while (true) {
        const { job } = await client.getJob(baseJobId);
        if (job?.status === "completed") {
          await client.acceptBase(characterId, { altImageId: baseJobId });
          return ok(await client.getCharacter(characterId));
        }
        if (now() >= deadline) return ok({ baseJobId, note: "timeout_still_running" });
        await sleep(pollMs);
      }
    } catch (e) {
      return fail(e);
    }
  });

  server.registerTool("accept_character_base", {
    title: "Accept character base",
    description: "Make a completed base portrait job the active base of a character.",
    inputSchema: { characterId: { type: "string" }, jobId: { type: "string" } },
    required: ["characterId", "jobId"],
  }, wrap(({ characterId, jobId }) => client.acceptBase(characterId, { altImageId: jobId })));

  // ---- Recipes, Products, Subjects ----
  server.registerTool("list_recipe_blocks", { title: "List recipe blocks", description: "List recipe entry points and preset building blocks.", inputSchema: {} }, wrap(() => client.listRecipeBlocks()));
  server.registerTool("compose_recipe", { title: "Compose recipe", description: "Compose and save a multi-step recipe.", inputSchema: { spec: { type: "object" } }, required: ["spec"] }, wrap(({ spec }) => client.composeRecipe({ spec })));
  server.registerTool("validate_recipe", { title: "Validate recipe", description: "Validate a recipe spec or config.", inputSchema: { spec: { type: "object" }, config: { type: "object" } } }, wrap((args) => client.validateRecipe(args)));
  server.registerTool("list_recipes", { title: "List recipes", description: "List installed and authored recipes.", inputSchema: {} }, wrap(() => client.listRecipes()));
  server.registerTool("get_recipe", { title: "Get recipe", description: "Get a recipe by ID.", inputSchema: { id: { type: "string" } }, required: ["id"] }, wrap(({ id }) => client.getRecipe(id)));
  server.registerTool("publish_recipe", { title: "Publish recipe", description: "Publish a recipe to the marketplace.", inputSchema: { id: { type: "string" }, changelog: { type: "string" }, priceTokens: { type: "number" } }, required: ["id"] }, wrap(({ id, changelog, priceTokens }) => client.publishRecipe(id, { changelog, priceTokens })));
  server.registerTool("run_recipe", { title: "Run recipe", description: "Execute a multi-step recipe with inputs.", inputSchema: { id: { type: "string" }, inputs: { type: "object" }, engine: { type: "string" } }, required: ["id", "inputs"] }, wrap(({ id, inputs, engine }) => client.runRecipe(id, { inputs, ...(engine ? { engine } : {}) })));
  server.registerTool("get_recipe_run", { title: "Get recipe run", description: "Get status of a recipe run.", inputSchema: { runId: { type: "string" } }, required: ["runId"] }, wrap(({ runId }) => client.getRecipeRun(runId)));
  server.registerTool("wait_for_recipe_run", {
    title: "Wait for recipe run",
    description: "Wait until a recipe run completes.",
    inputSchema: { runId: { type: "string" }, timeoutSeconds: { type: "number" }, pollMs: { type: "number" } },
    required: ["runId"],
  }, wrap(async ({ runId, timeoutSeconds = 120, pollMs = 150 }) => {
    const deadline = now() + timeoutSeconds * 1000;
    while (true) {
      const { run } = await client.getRecipeRun(runId);
      if (run && ["completed", "failed", "cancelled"].includes(run.status)) return { run };
      if (now() >= deadline) return { run, note: "timeout_still_running" };
      await sleep(pollMs);
    }
  }));
  server.registerTool("list_recipe_runs", { title: "List recipe runs", description: "List recent runs for a recipe.", inputSchema: { id: { type: "string" } }, required: ["id"] }, wrap(({ id }) => client.listRecipeRuns(id)));
  server.registerTool("cancel_recipe_run", { title: "Cancel recipe run", description: "Cancel a running recipe.", inputSchema: { runId: { type: "string" } }, required: ["runId"] }, wrap(({ runId }) => client.cancelRecipeRun(runId)));
  server.registerTool("list_subjects", { title: "List subjects", description: "List characters and products.", inputSchema: {} }, wrap(() => client.listSubjects()));
  server.registerTool("list_products", { title: "List products", description: "List saved products.", inputSchema: {} }, wrap(() => client.listProducts()));
  server.registerTool("create_product", { title: "Create product", description: "Create a product from an uploaded photo.", inputSchema: { name: { type: "string" }, image: { type: "string" }, description: { type: "string" }, category: { type: "string" } }, required: ["name", "image"] }, wrap((args) => client.createProduct(args)));
  server.registerTool("remove_product", { title: "Remove product", description: "Remove a product.", inputSchema: { id: { type: "string" } }, required: ["id"] }, wrap(({ id }) => client.removeProduct(id)));

  // ---- Video Studio & Locations ----
  server.registerTool("list_films", { title: "List films", description: "List Video Studio films.", inputSchema: { projectId: { type: "string" } } }, wrap(({ projectId }) => client.listFilms(projectId)));
  server.registerTool("create_film", { title: "Create film", description: "Create a Video Studio film.", inputSchema: { name: { type: "string" }, projectId: { type: "string" }, aspect: { type: "string" }, quality: { type: "string" }, renderOn: { type: "string" }, presets: { type: "object" } }, required: ["name"] }, wrap((a) => client.createFilm(a)));
  server.registerTool("get_film", { title: "Get film", description: "Get a film's timeline.", inputSchema: { filmId: { type: "string" } }, required: ["filmId"] }, wrap(({ filmId }) => client.getFilm(filmId)));
  server.registerTool("update_film_settings", { title: "Update film settings", description: "Update film settings.", inputSchema: { filmId: { type: "string" }, aspect: { type: "string" }, quality: { type: "string" }, hires2x: { type: "boolean" }, renderOn: { type: "string" }, presets: { type: "object" }, subject: { type: "string" }, cast: { type: "array" }, location: { type: ["string", "null"] } }, required: ["filmId"] }, wrap(({ filmId, ...rest }) => client.updateFilmSettings(filmId, rest)));
  server.registerTool("add_track", { title: "Add track", description: "Add an audio track to a film.", inputSchema: { filmId: { type: "string" }, upload: { type: "string" }, name: { type: "string" }, kind: { type: "string" }, at: {} }, required: ["filmId", "upload"] }, wrap(({ filmId, ...rest }) => client.addTrack(filmId, rest)));
  server.registerTool("move_track", { title: "Move track", description: "Move, mute, or adjust volume on a track.", inputSchema: { filmId: { type: "string" }, track: { type: "string" }, at: {}, muted: { type: "boolean" }, volume: { type: "number" } }, required: ["filmId", "track"] }, wrap(({ filmId, track, ...rest }) => client.moveTrack(filmId, track, rest)));
  server.registerTool("detect_tempo", { title: "Detect tempo", description: "Detect BPM and bar offsets from an audio track.", inputSchema: { filmId: { type: "string" }, track: { type: "string" } }, required: ["filmId"] }, wrap(({ filmId, track }) => client.detectTempo(filmId, track ? { track } : {})));
  server.registerTool("add_clip", { title: "Add clip", description: "Add an empty clip to the timeline.", inputSchema: { filmId: { type: "string" }, at: {}, length: {}, name: { type: "string" }, lane: { type: "string" } }, required: ["filmId"] }, wrap(({ filmId, ...rest }) => client.addClip(filmId, rest)));
  server.registerTool("import_clip", { title: "Import clip", description: "Import an existing completed video job as a clip.", inputSchema: { filmId: { type: "string" }, generationId: { type: "string" }, at: {}, length: {}, name: { type: "string" }, lane: { type: "string" } }, required: ["filmId", "generationId"] }, wrap(({ filmId, ...rest }) => client.importClip(filmId, rest)));
  server.registerTool("update_clip", { title: "Update clip", description: "Update shots, cast, location, link, tracks, or preset of a clip.", inputSchema: { filmId: { type: "string" }, clip: { type: ["string", "number"] }, shots: { type: "array" }, cast: { type: "array" }, location: { type: "string" }, link: { type: "string" }, hears: { type: "array" }, preset: { type: ["string", "null"] } }, required: ["filmId", "clip"] }, wrap(({ filmId, clip, ...rest }) => client.updateClip(filmId, clip, rest)));
  server.registerTool("move_clip", { title: "Move clip", description: "Move a clip on the timeline.", inputSchema: { filmId: { type: "string" }, clip: { type: ["string", "number"] }, at: {}, lane: { type: "string" } }, required: ["filmId", "clip"] }, wrap(({ filmId, clip, ...rest }) => client.moveClip(filmId, clip, dropNull(rest, ["at"]))));
  server.registerTool("trim_clip", { title: "Trim clip", description: "Trim clip length or trimIn offset.", inputSchema: { filmId: { type: "string" }, clip: { type: ["string", "number"] }, length: {}, trimIn: {} }, required: ["filmId", "clip"] }, wrap(({ filmId, clip, ...rest }) => client.trimClip(filmId, clip, dropNull(rest, ["length", "trimIn"]))));
  server.registerTool("remove_clip", { title: "Remove clip", description: "Remove a clip from the timeline.", inputSchema: { filmId: { type: "string" }, clip: { type: ["string", "number"] } }, required: ["filmId", "clip"] }, wrap(({ filmId, clip }) => client.removeClip(filmId, clip)));
  server.registerTool("apply_film_plan", { title: "Apply film plan", description: "Atomically validate and apply a multi-clip film layout.", inputSchema: { filmId: { type: "string" }, mode: { type: "string" }, discardTakes: { type: "boolean" }, start: {}, cast: { type: "array" }, location: { type: "string" }, clips: { type: "array" } }, required: ["filmId", "clips"] }, wrap(({ filmId, ...plan }) => client.applyFilmPlan(filmId, plan)));
  server.registerTool("set_fades", { title: "Set fades", description: "Set fadeIn/fadeOut on a clip or track.", inputSchema: { filmId: { type: "string" }, target: { type: ["string", "number"] }, fadeIn: { type: "number" }, fadeOut: { type: "number" } }, required: ["filmId", "target"] }, wrap(({ filmId, ...rest }) => client.setFades(filmId, rest)));
  server.registerTool("add_marker", { title: "Add marker", description: "Add a named ruler marker.", inputSchema: { filmId: { type: "string" }, at: {}, name: { type: "string" } }, required: ["filmId", "at"] }, wrap(({ filmId, ...rest }) => client.addMarker(filmId, rest)));
  server.registerTool("set_export_range", { title: "Set export range", description: "Set or clear the film export range.", inputSchema: { filmId: { type: "string" }, from: {}, to: {}, clear: { type: "boolean" } }, required: ["filmId"] }, wrap(({ filmId, ...rest }) => client.setExportRange(filmId, rest)));
  server.registerTool("render_clips", { title: "Render clips", description: "Render stale or specified clips.", inputSchema: { filmId: { type: "string" }, clips: {} }, required: ["filmId"] }, wrap(({ filmId, clips }) => client.renderClips(filmId, clips === undefined ? {} : { clips })));
  server.registerTool("wait_for_renders", {
    title: "Wait for renders",
    description: "Wait until all clip renders complete.",
    inputSchema: { filmId: { type: "string" }, timeoutSeconds: { type: "number" }, pollMs: { type: "number" } },
    required: ["filmId"],
  }, wrap(async ({ filmId, timeoutSeconds = 120, pollMs = 250 }) => {
    const safePoll = Math.max(100, pollMs);
    const deadline = now() + timeoutSeconds * 1000;
    while (true) {
      const timeline = await client.getFilm(filmId);
      const rendering = (timeline.clips || []).filter((c) => c.take === "rendering").map((c) => c.number);
      if (!rendering.length && !timeline.rendersRunning) return { timeline };
      if (now() >= deadline) return { timeline, rendering, note: "timeout_still_running" };
      await sleep(safePoll);
    }
  }));
  server.registerTool("list_takes", { title: "List takes", description: "List takes for a clip.", inputSchema: { filmId: { type: "string" }, clip: { type: ["string", "number"] } }, required: ["filmId", "clip"] }, wrap(({ filmId, clip }) => client.listTakes(filmId, clip)));
  server.registerTool("use_take", { title: "Use take", description: "Switch active take for a clip.", inputSchema: { filmId: { type: "string" }, clip: { type: ["string", "number"] }, generationId: { type: "string" } }, required: ["filmId", "clip", "generationId"] }, wrap(({ filmId, clip, generationId }) => client.useTake(filmId, clip, generationId)));
  server.registerTool("export_film", { title: "Export film", description: "Stitch and export the finished film.", inputSchema: { filmId: { type: "string" } }, required: ["filmId"] }, wrap(({ filmId }) => client.exportFilm(filmId)));
  server.registerTool("list_locations", { title: "List locations", description: "List saved Library locations.", inputSchema: {} }, wrap(() => client.listLocations()));
  server.registerTool("create_location", { title: "Create location", description: "Save a Library location from upload or finished image job.", inputSchema: { name: { type: "string" }, description: { type: "string" }, upload: { type: "string" }, fromJob: { type: "string" } }, required: ["name"] }, wrap((a) => client.createLocation(a)));
}
