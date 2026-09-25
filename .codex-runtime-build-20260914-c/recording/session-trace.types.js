"use strict";
/**
 * Shared trace schema for recorded exploration sessions (web and Android).
 *
 * A recording captures what a human actually did in the app so scenarios can be derived
 * from a real walkthrough instead of a written story. Two streams feed it: the ACTIONS
 * (what was tapped/typed) and the SCREENS observed around each action. Frames are sampled
 * only to give the AI visual context during derivation and are deleted afterwards — the
 * trace and the distilled narrative are what persist, which is what makes a recording
 * re-derivable later without keeping a video of a banking app on disk.
 *
 * The schema is deliberately identical for both platforms: normalization, derivation and
 * scenario building are then one pure pipeline with no per-platform branches.
 */
Object.defineProperty(exports, "__esModule", { value: true });
