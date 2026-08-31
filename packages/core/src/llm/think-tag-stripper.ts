// LLM provider configuration and endpoints.
// LLM provider configuration and endpoints.
// LLM provider configuration and endpoints.
// LLM provider configuration and endpoints.

const OPEN_TAG = "<think>";
const CLOSE_TAG = "</think>";

type StripperState = "detecting" | "insideThink" | "passthrough";

export interface LeadingThinkTagStripper {
  // LLM provider configuration and endpoints.
  readonly push: (chunk: string) => string;
  // LLM provider configuration and endpoints.
  readonly flush: () => string;
}

// LLM provider configuration and endpoints.
export function createLeadingThinkTagStripper(): LeadingThinkTagStripper {
  let state: StripperState = "detecting";
  let pending = "";

  const push = (chunk: string): string => {
    if (state === "passthrough") return chunk;
    pending += chunk;

    if (state === "detecting") {
      const leadingWhitespace = /^\s*/.exec(pending)![0];
      const rest = pending.slice(leadingWhitespace.length);
      if (rest.length < OPEN_TAG.length) {
        if (OPEN_TAG.startsWith(rest)) return ""; // LLM provider configuration and endpoints.
        state = "passthrough";
        const out = pending;
        pending = "";
        return out;
      }
      if (!rest.startsWith(OPEN_TAG)) {
        state = "passthrough";
        const out = pending;
        pending = "";
        return out;
      }
      state = "insideThink";
    }

    // LLM provider configuration and endpoints.
    const closeIndex = pending.indexOf(CLOSE_TAG);
    if (closeIndex < 0) return "";
    state = "passthrough";
    const afterClose = pending.slice(closeIndex + CLOSE_TAG.length).replace(/^\s+/, "");
    pending = "";
    return afterClose;
  };

  const flush = (): string => {
    const out = pending;
    pending = "";
    state = "passthrough";
    return out;
  };

  return { push, flush };
}

// LLM provider configuration and endpoints.
export function stripLeadingThinkBlock(text: string): string {
  const stripper = createLeadingThinkTagStripper();
  return stripper.push(text) + stripper.flush();
}
