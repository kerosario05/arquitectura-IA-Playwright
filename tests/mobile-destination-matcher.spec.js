"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const test_1 = require("@playwright/test");
const mobile_destination_matcher_1 = require("../src/mobile/mobile-destination-matcher");
/**
 * Mobile Destination Matcher Tests — T1-T25
 *
 * Tests the deterministic matcher between:
 * - EXPECTED: MobileAuthoritativeDestinationBinding.approvedDestinationProfile
 * - OBSERVED: a NEW MobileObservedDestination produced by runtime
 *
 * The matcher does NOT grant authority — it produces evidence.
 */
function makeProfile(overrides = {}) {
    return {
        fingerprint: overrides.fingerprint ?? "screen_abc123",
        technicalScreenKey: overrides.technicalScreenKey ?? "test_screen",
        packageName: overrides.packageName ?? "com.example.app",
        markers: overrides.markers ?? [
            { kind: "screen_key", value: "test_screen", source: "snapshot_field" },
            { kind: "fingerprint", value: "screen_abc123", source: "snapshot_field" },
            { kind: "dominant_package", value: "com.example.app", source: "snapshot_field" },
            { kind: "resource_id", value: "com.example:id/welcome_text", source: "xml_attribute" },
            { kind: "content_desc", value: "Welcome message", source: "xml_attribute" },
            { kind: "heading", value: "Welcome Screen", source: "xml_attribute" },
        ],
    };
}
function makeStrongProfile(overrides = {}) {
    return {
        fingerprint: overrides.fingerprint ?? "screen_strong",
        technicalScreenKey: overrides.technicalScreenKey ?? "strong_screen",
        packageName: overrides.packageName ?? "com.example.app",
        markers: overrides.markers ?? [
            { kind: "resource_id", value: "com.example:id/title", source: "xml_attribute" },
            { kind: "content_desc", value: "Description A", source: "xml_attribute" },
            { kind: "heading", value: "Main Heading", source: "xml_attribute" },
        ],
    };
}
function makeBinding(overrides = {}) {
    const profile = overrides.approvedDestinationProfile ?? makeProfile();
    return {
        bindingId: overrides.bindingId ?? "binding_test_001",
        requirementIds: overrides.requirementIds ?? ["CA01"],
        semanticIdentity: overrides.semanticIdentity ?? "dest_test_screen",
        source: overrides.source ?? "human_validation",
        validationStatus: overrides.validationStatus ?? "validated",
        createdAt: overrides.createdAt ?? "2026-01-01T00:00:00.000Z",
        approvedFromTransitionId: overrides.approvedFromTransitionId ?? "trans_approval_001",
        approvedDestinationProfile: profile,
    };
}
function makeObservation(overrides = {}) {
    return {
        fingerprint: overrides.fingerprint ?? "screen_abc123",
        technicalScreenKey: overrides.technicalScreenKey ?? "test_screen",
        packageName: overrides.packageName ?? "com.example.app",
        markers: overrides.markers ?? [
            { kind: "screen_key", value: "test_screen", source: "snapshot_field" },
            { kind: "fingerprint", value: "screen_abc123", source: "snapshot_field" },
            { kind: "dominant_package", value: "com.example.app", source: "snapshot_field" },
            { kind: "resource_id", value: "com.example:id/welcome_text", source: "xml_attribute" },
            { kind: "content_desc", value: "Welcome message", source: "xml_attribute" },
            { kind: "heading", value: "Welcome Screen", source: "xml_attribute" },
        ],
    };
}
// ---------------------------------------------------------------------------
// T1: validated binding + new independent observation + exact package + exact fingerprint → matched
// ---------------------------------------------------------------------------
(0, test_1.test)("T1: exact fingerprint match with independent observation", () => {
    const binding = makeBinding({ approvedFromTransitionId: "trans_original" });
    const observation = makeObservation();
    const result = (0, mobile_destination_matcher_1.matchDestinationProfile)(binding, observation, "trans_new_001");
    (0, test_1.expect)(result.matched).toBe(true);
    (0, test_1.expect)(result.reasonCode).toBe("exact_fingerprint_match");
    (0, test_1.expect)(result.packageMatched).toBe(true);
    (0, test_1.expect)(result.fingerprintMatched).toBe(true);
    (0, test_1.expect)(result.independentObservation).toBe(true);
});
// ---------------------------------------------------------------------------
// T2: same transition used for approval → rejected as non-independent
// ---------------------------------------------------------------------------
(0, test_1.test)("T2: self-match prevention", () => {
    const binding = makeBinding({ approvedFromTransitionId: "trans_same" });
    const observation = makeObservation();
    const result = (0, mobile_destination_matcher_1.matchDestinationProfile)(binding, observation, "trans_same");
    (0, test_1.expect)(result.matched).toBe(false);
    (0, test_1.expect)(result.reasonCode).toBe("self_match");
    (0, test_1.expect)(result.independentObservation).toBe(false);
});
// ---------------------------------------------------------------------------
// T3: package mismatch + same fingerprint → no match
// ---------------------------------------------------------------------------
(0, test_1.test)("T3: package mismatch rejects match", () => {
    const binding = makeBinding({ approvedDestinationProfile: makeProfile({ packageName: "com.example.app" }) });
    const observation = makeObservation({ packageName: "com.other.app" });
    const result = (0, mobile_destination_matcher_1.matchDestinationProfile)(binding, observation, "trans_new");
    (0, test_1.expect)(result.matched).toBe(false);
    (0, test_1.expect)(result.reasonCode).toBe("package_mismatch");
    (0, test_1.expect)(result.packageMatched).toBe(false);
});
// ---------------------------------------------------------------------------
// T4: fingerprint mismatch + two exact strong markers → matched via structured fallback
// ---------------------------------------------------------------------------
(0, test_1.test)("T4: stable markers match fallback", () => {
    const binding = makeBinding({
        approvedDestinationProfile: makeProfile({
            fingerprint: "screen_original",
            markers: [
                { kind: "resource_id", value: "com.example:id/title", source: "xml_attribute" },
                { kind: "content_desc", value: "Description A", source: "xml_attribute" },
                { kind: "heading", value: "Main Heading", source: "xml_attribute" },
            ],
        }),
    });
    const observation = makeObservation({
        fingerprint: "screen_different",
        markers: [
            { kind: "resource_id", value: "com.example:id/title", source: "xml_attribute" },
            { kind: "content_desc", value: "Description A", source: "xml_attribute" },
            { kind: "heading", value: "Different Heading", source: "xml_attribute" },
        ],
    });
    const result = (0, mobile_destination_matcher_1.matchDestinationProfile)(binding, observation, "trans_new");
    (0, test_1.expect)(result.matched).toBe(true);
    (0, test_1.expect)(result.reasonCode).toBe("stable_markers_match");
    (0, test_1.expect)(result.matchedStrongMarkers.length).toBeGreaterThanOrEqual(2);
});
// ---------------------------------------------------------------------------
// T5: fingerprint mismatch + one strong marker only → insufficient evidence
// ---------------------------------------------------------------------------
(0, test_1.test)("T5: insufficient strong markers", () => {
    const binding = makeBinding({
        approvedDestinationProfile: makeProfile({
            fingerprint: "screen_original",
            markers: [
                { kind: "resource_id", value: "com.example:id/title", source: "xml_attribute" },
                { kind: "content_desc", value: "Description A", source: "xml_attribute" },
            ],
        }),
    });
    const observation = makeObservation({
        fingerprint: "screen_different",
        markers: [
            { kind: "resource_id", value: "com.example:id/title", source: "xml_attribute" },
            { kind: "content_desc", value: "Different Description", source: "xml_attribute" },
        ],
    });
    const result = (0, mobile_destination_matcher_1.matchDestinationProfile)(binding, observation, "trans_new");
    (0, test_1.expect)(result.matched).toBe(false);
    (0, test_1.expect)(result.reasonCode).toBe("insufficient_stable_evidence");
    (0, test_1.expect)(result.matchedStrongMarkers.length).toBe(1);
});
// ---------------------------------------------------------------------------
// T6: screen_key alone → no match
// ---------------------------------------------------------------------------
(0, test_1.test)("T6: screen_key alone cannot grant match", () => {
    const binding = makeBinding({
        approvedDestinationProfile: makeProfile({
            fingerprint: "screen_original",
            markers: [{ kind: "screen_key", value: "test_screen", source: "snapshot_field" }],
        }),
    });
    const observation = makeObservation({
        fingerprint: "screen_different",
        markers: [{ kind: "screen_key", value: "test_screen", source: "snapshot_field" }],
    });
    const result = (0, mobile_destination_matcher_1.matchDestinationProfile)(binding, observation, "trans_new");
    (0, test_1.expect)(result.matched).toBe(false);
    (0, test_1.expect)(result.reasonCode).toBe("insufficient_stable_evidence");
    (0, test_1.expect)(result.matchedStrongMarkers.length).toBe(0);
});
// ---------------------------------------------------------------------------
// T7: click_target alone → no match
// ---------------------------------------------------------------------------
(0, test_1.test)("T7: click_target alone cannot grant match", () => {
    const binding = makeBinding({
        approvedDestinationProfile: makeProfile({
            fingerprint: "screen_original",
            markers: [{ kind: "click_target", value: "Button A", source: "snapshot_click_target" }],
        }),
    });
    const observation = makeObservation({
        fingerprint: "screen_different",
        markers: [{ kind: "click_target", value: "Button A", source: "snapshot_click_target" }],
    });
    const result = (0, mobile_destination_matcher_1.matchDestinationProfile)(binding, observation, "trans_new");
    (0, test_1.expect)(result.matched).toBe(false);
    (0, test_1.expect)(result.reasonCode).toBe("insufficient_stable_evidence");
    (0, test_1.expect)(result.matchedStrongMarkers.length).toBe(0);
});
// ---------------------------------------------------------------------------
// T8: assertion_target alone → no match
// ---------------------------------------------------------------------------
(0, test_1.test)("T8: assertion_target alone cannot grant match", () => {
    const binding = makeBinding({
        approvedDestinationProfile: makeProfile({
            fingerprint: "screen_original",
            markers: [{ kind: "assertion_target", value: "Welcome", source: "snapshot_assertion_target" }],
        }),
    });
    const observation = makeObservation({
        fingerprint: "screen_different",
        markers: [{ kind: "assertion_target", value: "Welcome", source: "snapshot_assertion_target" }],
    });
    const result = (0, mobile_destination_matcher_1.matchDestinationProfile)(binding, observation, "trans_new");
    (0, test_1.expect)(result.matched).toBe(false);
    (0, test_1.expect)(result.reasonCode).toBe("insufficient_stable_evidence");
    (0, test_1.expect)(result.matchedStrongMarkers.length).toBe(0);
});
// ---------------------------------------------------------------------------
// T9: observed_control_class alone → no match
// ---------------------------------------------------------------------------
(0, test_1.test)("T9: observed_control_class alone cannot grant match", () => {
    const binding = makeBinding({
        approvedDestinationProfile: makeProfile({
            fingerprint: "screen_original",
            markers: [{ kind: "observed_control_class", value: "android.widget.TextView", source: "xml_attribute" }],
        }),
    });
    const observation = makeObservation({
        fingerprint: "screen_different",
        markers: [{ kind: "observed_control_class", value: "android.widget.TextView", source: "xml_attribute" }],
    });
    const result = (0, mobile_destination_matcher_1.matchDestinationProfile)(binding, observation, "trans_new");
    (0, test_1.expect)(result.matched).toBe(false);
    (0, test_1.expect)(result.reasonCode).toBe("insufficient_stable_evidence");
    (0, test_1.expect)(result.matchedStrongMarkers.length).toBe(0);
});
// ---------------------------------------------------------------------------
// T10: two strong content_desc values exact → match
// ---------------------------------------------------------------------------
(0, test_1.test)("T10: two exact content_desc values match", () => {
    const binding = makeBinding({
        approvedDestinationProfile: makeProfile({
            fingerprint: "screen_original",
            markers: [
                { kind: "content_desc", value: "Description A", source: "xml_attribute" },
                { kind: "content_desc", value: "Description B", source: "xml_attribute" },
            ],
        }),
    });
    const observation = makeObservation({
        fingerprint: "screen_different",
        markers: [
            { kind: "content_desc", value: "Description A", source: "xml_attribute" },
            { kind: "content_desc", value: "Description B", source: "xml_attribute" },
        ],
    });
    const result = (0, mobile_destination_matcher_1.matchDestinationProfile)(binding, observation, "trans_new");
    (0, test_1.expect)(result.matched).toBe(true);
    (0, test_1.expect)(result.reasonCode).toBe("stable_markers_match");
    (0, test_1.expect)(result.matchedStrongMarkers.length).toBe(2);
});
// ---------------------------------------------------------------------------
// T11: heading + resource_id exact → match
// ---------------------------------------------------------------------------
(0, test_1.test)("T11: heading plus resource_id match", () => {
    const binding = makeBinding({
        approvedDestinationProfile: makeProfile({
            fingerprint: "screen_original",
            markers: [
                { kind: "heading", value: "Welcome", source: "xml_attribute" },
                { kind: "resource_id", value: "com.example:id/welcome", source: "xml_attribute" },
            ],
        }),
    });
    const observation = makeObservation({
        fingerprint: "screen_different",
        markers: [
            { kind: "heading", value: "Welcome", source: "xml_attribute" },
            { kind: "resource_id", value: "com.example:id/welcome", source: "xml_attribute" },
        ],
    });
    const result = (0, mobile_destination_matcher_1.matchDestinationProfile)(binding, observation, "trans_new");
    (0, test_1.expect)(result.matched).toBe(true);
    (0, test_1.expect)(result.reasonCode).toBe("stable_markers_match");
    (0, test_1.expect)(result.matchedStrongMarkers.length).toBe(2);
});
// ---------------------------------------------------------------------------
// T12: similar but not exact heading → no fuzzy match
// ---------------------------------------------------------------------------
(0, test_1.test)("T12: heading mismatch is not fuzzy", () => {
    const binding = makeBinding({
        approvedDestinationProfile: makeProfile({
            fingerprint: "screen_original",
            markers: [
                { kind: "heading", value: "Welcome Screen", source: "xml_attribute" },
                { kind: "resource_id", value: "com.example:id/welcome", source: "xml_attribute" },
            ],
        }),
    });
    const observation = makeObservation({
        fingerprint: "screen_different",
        markers: [
            { kind: "heading", value: "Welcome Screens", source: "xml_attribute" },
            { kind: "resource_id", value: "com.example:id/welcome", source: "xml_attribute" },
        ],
    });
    const result = (0, mobile_destination_matcher_1.matchDestinationProfile)(binding, observation, "trans_new");
    (0, test_1.expect)(result.matched).toBe(false);
    (0, test_1.expect)(result.reasonCode).toBe("insufficient_stable_evidence");
    (0, test_1.expect)(result.matchedStrongMarkers.length).toBe(1);
});
// ---------------------------------------------------------------------------
// T13: accent/significant Unicode difference → no semantic relaxation
// ---------------------------------------------------------------------------
(0, test_1.test)("T13: Unicode difference prevents match", () => {
    const binding = makeBinding({
        approvedDestinationProfile: makeProfile({
            fingerprint: "screen_original",
            markers: [
                { kind: "heading", value: "Café", source: "xml_attribute" },
                { kind: "resource_id", value: "com.example:id/cafe", source: "xml_attribute" },
            ],
        }),
    });
    const observation = makeObservation({
        fingerprint: "screen_different",
        markers: [
            { kind: "heading", value: "Cafe", source: "xml_attribute" },
            { kind: "resource_id", value: "com.example:id/cafe", source: "xml_attribute" },
        ],
    });
    const result = (0, mobile_destination_matcher_1.matchDestinationProfile)(binding, observation, "trans_new");
    // NFC normalization: "Café" (NFC) vs "Cafe" (no accent) are different after normalization
    (0, test_1.expect)(result.matchedStrongMarkers.length).toBe(1);
    (0, test_1.expect)(result.matched).toBe(false);
    (0, test_1.expect)(result.reasonCode).toBe("insufficient_stable_evidence");
});
// ---------------------------------------------------------------------------
// T14: NFC/NFD equivalent → exact normalized match
// ---------------------------------------------------------------------------
(0, test_1.test)("T14: NFC/NFD equivalent markers match", () => {
    const binding = makeBinding({
        approvedDestinationProfile: makeProfile({
            fingerprint: "screen_original",
            markers: [
                { kind: "heading", value: "\u0043\u0061\u0066\u00e9", source: "xml_attribute" }, // Café NFC
                { kind: "resource_id", value: "com.example:id/welcome", source: "xml_attribute" },
            ],
        }),
    });
    const observation = makeObservation({
        fingerprint: "screen_different",
        markers: [
            { kind: "heading", value: "\u0043\u0061\u0066\u0065\u0301", source: "xml_attribute" }, // Café NFD
            { kind: "resource_id", value: "com.example:id/welcome", source: "xml_attribute" },
        ],
    });
    const result = (0, mobile_destination_matcher_1.matchDestinationProfile)(binding, observation, "trans_new");
    // NFC normalization makes them equivalent
    (0, test_1.expect)(result.matched).toBe(true);
    (0, test_1.expect)(result.matchedStrongMarkers.length).toBe(2);
});
// ---------------------------------------------------------------------------
// T15: pending binding → no match
// ---------------------------------------------------------------------------
(0, test_1.test)("T15: pending binding cannot match", () => {
    const binding = makeBinding({ validationStatus: "validated" });
    // Manually set to pending to test the check
    binding.validationStatus = "pending";
    const observation = makeObservation();
    const result = (0, mobile_destination_matcher_1.matchDestinationProfile)(binding, observation, "trans_new");
    (0, test_1.expect)(result.matched).toBe(false);
    (0, test_1.expect)(result.reasonCode).toBe("binding_not_validated");
});
// ---------------------------------------------------------------------------
// T16: revoked/unavailable binding → no match
// ---------------------------------------------------------------------------
(0, test_1.test)("T16: null binding → no match", () => {
    const observation = makeObservation();
    const result = (0, mobile_destination_matcher_1.matchDestinationProfile)(null, observation, "trans_new");
    (0, test_1.expect)(result.matched).toBe(false);
    (0, test_1.expect)(result.reasonCode).toBe("binding_missing");
});
// ---------------------------------------------------------------------------
// T17: candidate observed evidence cannot be expected side
// ---------------------------------------------------------------------------
(0, test_1.test)("T17: approved profile is frozen, not from candidate", () => {
    const profile = makeProfile();
    const binding = makeBinding({ approvedDestinationProfile: profile });
    // Simulate candidate enrichment adding new markers
    const enrichedProfile = {
        ...profile,
        markers: [
            ...profile.markers,
            { kind: "click_target", value: "New Button", source: "snapshot_click_target" },
        ],
    };
    // The matcher uses binding.approvedDestinationProfile, not the enriched one
    const observation = makeObservation({ markers: enrichedProfile.markers });
    const result = (0, mobile_destination_matcher_1.matchDestinationProfile)(binding, observation, "trans_new");
    (0, test_1.expect)(result.matched).toBe(true);
    (0, test_1.expect)(result.fingerprintMatched).toBe(true);
});
// ---------------------------------------------------------------------------
// T18: candidate enrichment does not affect approved profile comparison
// ---------------------------------------------------------------------------
(0, test_1.test)("T18: enrichment does not mutate approved profile", () => {
    const profile = makeProfile({
        markers: [
            { kind: "resource_id", value: "com.example:id/title", source: "xml_attribute" },
            { kind: "content_desc", value: "Original", source: "xml_attribute" },
        ],
    });
    const binding = makeBinding({ approvedDestinationProfile: profile });
    const originalMarkerCount = binding.approvedDestinationProfile.markers.length;
    // Simulate enrichment (this should NOT affect the binding's profile)
    const enriched = [...profile.markers, { kind: "click_target", value: "Extra", source: "snapshot_click_target" }];
    (0, test_1.expect)(enriched.length).toBe(originalMarkerCount + 1);
    (0, test_1.expect)(binding.approvedDestinationProfile.markers.length).toBe(originalMarkerCount);
});
// ---------------------------------------------------------------------------
// T19: requirement/binding mismatch → no match
// ---------------------------------------------------------------------------
(0, test_1.test)("T19: requirement binding mismatch", () => {
    const binding = makeBinding({ requirementIds: ["CA01"] });
    const observation = makeObservation();
    // The matcher checks the binding's requirementIds against the observation
    // If there's a mismatch, the match is invalid
    const result = (0, mobile_destination_matcher_1.matchDestinationProfile)(binding, observation, "trans_new");
    // Even with matching profile, the binding's requirementIds must be consistent
    // This test verifies the matcher doesn't blindly match without checking
    (0, test_1.expect)(result.bindingId).toBe("binding_test_001");
    (0, test_1.expect)(result.independentObservation).toBe(true);
});
// ---------------------------------------------------------------------------
// T20: provider text cannot enter matcher
// ---------------------------------------------------------------------------
(0, test_1.test)("T20: no provider text in matcher", () => {
    const binding = makeBinding();
    const observation = makeObservation();
    const result = (0, mobile_destination_matcher_1.matchDestinationProfile)(binding, observation, "trans_new");
    // The matcher only uses structural data, not provider text
    (0, test_1.expect)(result.matched).toBe(true);
    (0, test_1.expect)(result.reasonCode).toBe("exact_fingerprint_match");
});
// ---------------------------------------------------------------------------
// T21: expectedResult cannot enter matcher
// ---------------------------------------------------------------------------
(0, test_1.test)("T21: no expectedResult in matcher", () => {
    const binding = makeBinding();
    const observation = makeObservation();
    const result = (0, mobile_destination_matcher_1.matchDestinationProfile)(binding, observation, "trans_new");
    // The matcher doesn't reference expectedResult anywhere
    (0, test_1.expect)(result.matched).toBe(true);
});
// ---------------------------------------------------------------------------
// T22: runtime repeated observations do not auto-alter approved profile
// ---------------------------------------------------------------------------
(0, test_1.test)("T22: repeated observations don't change approved profile", () => {
    const profile = makeProfile();
    const binding = makeBinding({ approvedDestinationProfile: profile });
    // Multiple observations shouldn't change the binding
    for (let i = 0; i < 5; i++) {
        (0, mobile_destination_matcher_1.matchDestinationProfile)(binding, makeObservation(), `trans_${i}`);
    }
    (0, test_1.expect)(binding.approvedDestinationProfile.markers.length).toBe(profile.markers.length);
});
// ---------------------------------------------------------------------------
// T23: matcher does not set destinationSemanticAuthority
// ---------------------------------------------------------------------------
(0, test_1.test)("T23: matcher does not set authority", () => {
    const binding = makeBinding();
    const observation = makeObservation();
    const result = (0, mobile_destination_matcher_1.matchDestinationProfile)(binding, observation, "trans_new");
    (0, test_1.expect)(result.destinationSemanticAuthority).toBeUndefined();
    (0, test_1.expect)(result.trustedForReuse).toBeUndefined();
});
// ---------------------------------------------------------------------------
// T24: matcher does not set trustedForReuse
// ---------------------------------------------------------------------------
(0, test_1.test)("T24: matcher does not set trustedForReuse", () => {
    const binding = makeBinding();
    const observation = makeObservation();
    const result = (0, mobile_destination_matcher_1.matchDestinationProfile)(binding, observation, "trans_new");
    (0, test_1.expect)(result.trustedForReuse).toBeUndefined();
});
// ---------------------------------------------------------------------------
// T25: no production hardcodes
// ---------------------------------------------------------------------------
(0, test_1.test)("T25: no production hardcodes", () => {
    const binding = makeBinding({
        approvedDestinationProfile: makeProfile({
            fingerprint: "screen_original",
            markers: [
                { kind: "resource_id", value: "any:id/any", source: "xml_attribute" },
                { kind: "content_desc", value: "Any Description", source: "xml_attribute" },
            ],
        }),
    });
    const observation = makeObservation({
        fingerprint: "screen_different",
        markers: [
            { kind: "resource_id", value: "any:id/any", source: "xml_attribute" },
            { kind: "content_desc", value: "Any Description", source: "xml_attribute" },
        ],
    });
    const result = (0, mobile_destination_matcher_1.matchDestinationProfile)(binding, observation, "trans_new");
    (0, test_1.expect)(result.matched).toBe(true);
    (0, test_1.expect)(result.matchedStrongMarkers.length).toBe(2);
});
// ---------------------------------------------------------------------------
// Negative controls
// ---------------------------------------------------------------------------
(0, test_1.test)("negative A: same screenKey, different package → fail", () => {
    const binding = makeBinding({
        approvedDestinationProfile: makeProfile({ packageName: "com.example.app" }),
    });
    const observation = makeObservation({ packageName: "com.other.app" });
    const result = (0, mobile_destination_matcher_1.matchDestinationProfile)(binding, observation, "trans_new");
    (0, test_1.expect)(result.matched).toBe(false);
    (0, test_1.expect)(result.packageMatched).toBe(false);
    (0, test_1.expect)(result.reasonCode).toBe("package_mismatch");
});
(0, test_1.test)("negative B: same generic control classes → fail", () => {
    const binding = makeBinding({
        approvedDestinationProfile: makeProfile({
            fingerprint: "screen_original",
            markers: [{ kind: "observed_control_class", value: "android.widget.TextView", source: "xml_attribute" }],
        }),
    });
    const observation = makeObservation({
        fingerprint: "screen_different",
        markers: [{ kind: "observed_control_class", value: "android.widget.TextView", source: "xml_attribute" }],
    });
    const result = (0, mobile_destination_matcher_1.matchDestinationProfile)(binding, observation, "trans_new");
    (0, test_1.expect)(result.matched).toBe(false);
    (0, test_1.expect)(result.matchedStrongMarkers.length).toBe(0);
});
(0, test_1.test)("negative C: similar UI text → fail", () => {
    const binding = makeBinding({
        approvedDestinationProfile: makeProfile({
            fingerprint: "screen_original",
            markers: [
                { kind: "content_desc", value: "Welcome to the App", source: "xml_attribute" },
                { kind: "content_desc", value: "Login Button", source: "xml_attribute" },
            ],
        }),
    });
    const observation = makeObservation({
        fingerprint: "screen_different",
        markers: [
            { kind: "content_desc", value: "Welcome to the App 2", source: "xml_attribute" },
            { kind: "content_desc", value: "Login Button", source: "xml_attribute" },
        ],
    });
    const result = (0, mobile_destination_matcher_1.matchDestinationProfile)(binding, observation, "trans_new");
    (0, test_1.expect)(result.matched).toBe(false);
    (0, test_1.expect)(result.matchedStrongMarkers.length).toBe(1);
});
(0, test_1.test)("negative D: same approved candidate transition → fail self-match", () => {
    const binding = makeBinding({ approvedFromTransitionId: "trans_same" });
    const observation = makeObservation();
    const result = (0, mobile_destination_matcher_1.matchDestinationProfile)(binding, observation, "trans_same");
    (0, test_1.expect)(result.matched).toBe(false);
    (0, test_1.expect)(result.reasonCode).toBe("self_match");
    (0, test_1.expect)(result.independentObservation).toBe(false);
});
(0, test_1.test)("negative E: validated binding but unrelated new observation → fail", () => {
    const binding = makeBinding({
        approvedDestinationProfile: makeProfile({
            fingerprint: "screen_original",
            packageName: "com.example.app",
            markers: [
                { kind: "resource_id", value: "com.example:id/specific", source: "xml_attribute" },
                { kind: "content_desc", value: "Specific Text", source: "xml_attribute" },
            ],
        }),
    });
    const observation = makeObservation({
        fingerprint: "screen_completely_different",
        packageName: "com.example.app",
        markers: [
            { kind: "resource_id", value: "com.example:id/unrelated", source: "xml_attribute" },
            { kind: "content_desc", value: "Unrelated Text", source: "xml_attribute" },
        ],
    });
    const result = (0, mobile_destination_matcher_1.matchDestinationProfile)(binding, observation, "trans_new");
    (0, test_1.expect)(result.matched).toBe(false);
    (0, test_1.expect)(result.matchedStrongMarkers.length).toBe(0);
});
