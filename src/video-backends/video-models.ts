// ADR-0035: local video model registry, ported from imagegen-service. Lets the local
// backend dispatch across image-to-video models by a `model` id, each contributing
// its own preflight file list and workflow renderer. The transport (upload → POST
// /prompt → poll → /view) is shared in local.ts. Pure data + renderers; imports the
// per-model renderers but NOT the backend, so there is no import cycle.
import { renderWanWorkflow, WAN_DIFFUSION_MODEL, WAN_TEXT_ENCODER, WAN_VAE } from "./wan-workflow.js";
import { renderLtxvWorkflow, LTXV_CHECKPOINT, LTXV_TEXT_ENCODER } from "./ltxv-workflow.js";

/** Accepted local video model ids. Add a model = extend this union + add its spec.
 * (Scriptorium's `remix-14b` id was never implemented service-side and is omitted.) */
export type AnimateModel = "wan-5b" | "ltxv";

/** A ComfyUI API-format graph (flat {id: {class_type, inputs}}). */
export type VideoGraph = Record<string, { class_type: string; inputs: Record<string, unknown> }>;

/** The params a renderer receives — identical across models; each snaps/ignores what it must. */
export interface VideoRenderParams {
  prompt: string;
  negativePrompt?: string;
  seed?: number;
  width?: number;
  height?: number;
  frames?: number;
  fps?: number;
  /** The filename ComfyUI returned from /upload/image for the input still. */
  imageName: string;
}

/** One model file the workflow needs ComfyUI to have loaded. `loaderClass`/`inputName`
 * are the object_info node + combo the preflight probes; `subdir` shapes the message. */
export interface VideoModelFile {
  loaderClass: string;
  inputName: string;
  file: string;
  subdir: string;
}

export interface VideoModelSpec {
  model: AnimateModel;
  label: string;
  files: readonly VideoModelFile[];
  /** How to install the files — named in the "not installed" error. */
  fetchHint: string;
  render: (params: VideoRenderParams) => VideoGraph;
}

const WAN_5B: VideoModelSpec = {
  model: "wan-5b",
  label: "Wan 2.2 TI2V 5B",
  files: [
    { loaderClass: "UNETLoader", inputName: "unet_name", file: WAN_DIFFUSION_MODEL, subdir: "diffusion_models" },
    { loaderClass: "CLIPLoader", inputName: "clip_name", file: WAN_TEXT_ENCODER, subdir: "text_encoders" },
    { loaderClass: "VAELoader", inputName: "vae_name", file: WAN_VAE, subdir: "vae" },
  ],
  fetchHint: "scripts/fetch-wan22-models.ts",
  render: renderWanWorkflow,
};

const LTXV: VideoModelSpec = {
  model: "ltxv",
  label: "LTX-Video 2B",
  files: [
    { loaderClass: "CheckpointLoaderSimple", inputName: "ckpt_name", file: LTXV_CHECKPOINT, subdir: "checkpoints" },
    { loaderClass: "CLIPLoader", inputName: "clip_name", file: LTXV_TEXT_ENCODER, subdir: "text_encoders" },
  ],
  fetchHint: "scripts/fetch-ltxv-models.ts",
  render: renderLtxvWorkflow,
};

/** Registry keys are the accepted `model` ids. `ltxv` is the default: it's lighter
 * (~11.5 GB vs ~18 GB) and faster, the realistic pick on the 12 GB reference host —
 * Wan 5B fp16 swaps hard there (comfyui-host-layout). */
export const VIDEO_MODELS: Record<AnimateModel, VideoModelSpec> = {
  "wan-5b": WAN_5B,
  ltxv: LTXV,
};

export const ANIMATE_MODELS = Object.keys(VIDEO_MODELS) as AnimateModel[];
export const DEFAULT_ANIMATE_MODEL: AnimateModel = "ltxv";

export function isAnimateModel(v: unknown): v is AnimateModel {
  return typeof v === "string" && Object.prototype.hasOwnProperty.call(VIDEO_MODELS, v);
}

/** The spec for a model id, or the default spec when none/unknown. */
export function getVideoModel(model?: string | null): VideoModelSpec {
  return (isAnimateModel(model) && VIDEO_MODELS[model]) || VIDEO_MODELS[DEFAULT_ANIMATE_MODEL];
}
