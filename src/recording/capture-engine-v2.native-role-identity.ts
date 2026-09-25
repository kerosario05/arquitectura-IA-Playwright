export type NativeRoleIdentityInput = {
  tag: string;
  explicitName?: string;
  textContent?: string;
  semanticFragments?: string[];
  headingFragments?: string[];
};

export type NativeRoleIdentity = {
  displayName?: string;
  technicalRoleName?: string;
  roleTechnicalIdentityEligible?: boolean;
  contentKind: "explicit_accessibility_name" | "simple_native_text" | "compound_native_content" | "compound_structural_content" | "none";
};

/**
 * Keeps a human-facing control label independent from a replayable ARIA-role name.
 * The function is self-contained because its source also runs in Capture V2's browser script.
 */
export function classifyNativeRoleIdentity(input: NativeRoleIdentityInput): NativeRoleIdentity {
  const explicitName = String(input.explicitName ?? "").replace(/\s+/g, " ").trim();
  if (explicitName) {
    return {
      displayName: explicitName,
      technicalRoleName: explicitName,
      roleTechnicalIdentityEligible: true,
      contentKind: "explicit_accessibility_name",
    };
  }

  const textContent = String(input.textContent ?? "").replace(/\s+/g, " ").trim();
  const nativeTextBearing = ["button", "a", "summary", "option"].includes(String(input.tag ?? "").replace(/\s+/g, " ").trim().toLowerCase());
  if (!textContent) return { contentKind: "none" };

  const semanticFragmentSet = new Set<string>();
  for (const value of input.semanticFragments ?? []) {
    const normalized = String(value ?? "").replace(/\s+/g, " ").trim();
    if (normalized) semanticFragmentSet.add(normalized);
  }
  const semanticFragments = Array.from(semanticFragmentSet);
  const headingFragmentSet = new Set<string>();
  for (const value of input.headingFragments ?? []) {
    const normalized = String(value ?? "").replace(/\s+/g, " ").trim();
    if (normalized) headingFragmentSet.add(normalized);
  }
  const headingFragments = Array.from(headingFragmentSet);
  // A framework/structural owner can aggregate a primary heading and supporting prose. When
  // exactly one semantic heading exists among compound content, it is a display-only identity:
  // no role name or locator is manufactured from it. Multiple headings remain ambiguous and
  // fall through to the conservative aggregate display below.
  // Structural owners frequently place supporting copy in generic wrappers rather than a
  // semantic paragraph/list node. A single semantic heading is still an unambiguous,
  // display-only primary label in that shape; requiring the supporting copy itself to be
  // semantic would fall back to the owner's aggregate text. Native controls keep the stricter
  // compound-content rule below because their text can be executable role identity.
  if (headingFragments.length === 1 && (!nativeTextBearing || semanticFragments.length > 1)) {
    return {
      displayName: headingFragments[0],
      roleTechnicalIdentityEligible: false,
      contentKind: nativeTextBearing ? "compound_native_content" : "compound_structural_content",
    };
  }
  if (!nativeTextBearing) return { displayName: textContent, contentKind: "none" };
  if (semanticFragments.length > 1) {
    return {
      displayName: textContent,
      roleTechnicalIdentityEligible: false,
      contentKind: "compound_native_content",
    };
  }

  return {
    displayName: textContent,
    technicalRoleName: textContent,
    roleTechnicalIdentityEligible: true,
    contentKind: "simple_native_text",
  };
}

export const CLASSIFY_NATIVE_ROLE_IDENTITY_SOURCE = classifyNativeRoleIdentity.toString();
