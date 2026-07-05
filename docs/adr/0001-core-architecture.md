# ADR-0001: File-Backed Agent SDK DM Engine + Decoupled Asset Worker

## Status
Accepted

## Context
Existing AI-DM apps (including the one currently in use) suffer from state
drift (forgotten inventory, contradicted NPCs, lost conditions) and content
repetition (recycled missions/characters). Both trace back to the same root
cause: campaign state lives only in conversational context, which is lossy
as it grows, and generation happens with no persistent novelty constraint.

## Decision
1. The DM engine is built on the **Claude Agent SDK**, not the raw Messages
   API and not the interactive Claude Code CLI. One SDK session per
   campaign, given a working directory of plain files as its actual memory.
   The model reads/updates these files each turn instead of relying on
   conversation history for ground truth.
2. Image generation is a **separate, decoupled worker** invoked headlessly
   (`grok -p` / ACP) against Grok Build, triggered by DM-engine state events
   (new NPC / location / item created), not embedded in the DM's own tool
   loop. Prompts are constructed from the entity's already-established
   description in the state files.
3. Repetition is treated as a **content-diversity problem**, not a prompting
   problem: seed tables constrain generation, and a content registry file
   excludes recent repeats before anything new is generated.

## Alternatives Considered
- **Raw Messages API, no agent loop:** rejected — would require hand-rolling
  the tool-execution loop the Agent SDK already provides, for no benefit at
  this app's scale.
- **State entirely in conversation history (status quo pattern):** rejected —
  this is the exact mechanism producing the drift she's complaining about.
- **Image generation as a tool inside the DM's own reasoning loop:** rejected —
  couples two different vendors' agent loops together unnecessarily and
  risks the DM narrating around image-generation latency/failures instead of
  just telling a story.
- **Rules-light freeform adjudication:** rejected for this project — she
  explicitly wants 5e rules followed. Revisit only if SRD-grounding proves
  too costly for the payoff.

## Consequences
- Two services to run and coordinate (DM engine, asset worker) instead of
  one — acceptable, they're loosely coupled through files, not a shared
  process.
- State-file schema becomes a first-class, versioned artifact of the
  project — changes to it are architecturally significant enough to warrant
  their own ADRs going forward.
- SRD-grounded rules adjudication is deferred to its own slice (see design
  doc §5, §10) rather than bundled into the first vertical slice.
