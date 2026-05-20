// This file is loaded as a string and passed to page.evaluate().
// It must NOT use TypeScript or any syntax that requires transpilation.
// All data is injected via JSON.stringify before this code runs.
// Variables prefixed with __DATA__ are replaced at runtime.

(function() {
var allExpandedTokens = __DATA_EXPANDED__;
var targetTokens = __DATA_TOKENS__;
var matchedGroupNames = __DATA_GROUPS__;
var semanticSelectors = __DATA_SELECTORS__;

var signalWeights = {
  "text": 1.0, "aria-label": 1.0, "title": 0.9, "alt": 0.8,
  "href": 0.9, "data-testid": 0.9, "class": 0.7, "id": 0.7, "name": 0.8
};

var elements = document.querySelectorAll(semanticSelectors.join(","));
var candidates = [];

for (var i = 0; i < elements.length; i++) {
  var el = elements[i];
  if (el.offsetParent === null && !el.hasAttribute("aria-hidden")) continue;

  var tagName = el.tagName.toLowerCase();
  var role = el.getAttribute("role") || undefined;
  var text = (el.textContent || "").replace(/\s+/g, " ").trim() || undefined;
  var ariaLabel = el.getAttribute("aria-label") || undefined;
  var title = el.getAttribute("title") || undefined;
  var alt = el.alt || undefined;
  var href = el.href || undefined;
  var rawDataTestid = el.getAttribute("data-testid");
  var rawDataTest = el.getAttribute("data-test");
  var dataTestid = rawDataTestid || rawDataTest || undefined;
  var className = el.getAttribute("class") || undefined;
  var id = el.getAttribute("id") || undefined;
  var name = el.getAttribute("name") || undefined;

  var signals = [];
  function addSignal(k, v) { if (v && v.length > 0) signals.push({ key: k, value: v }); }
  addSignal("text", text);
  addSignal("aria-label", ariaLabel);
  addSignal("title", title);
  addSignal("alt", alt);
  addSignal("href", href);
  addSignal("data-testid", dataTestid);
  addSignal("class", className);
  addSignal("id", id);
  addSignal("name", name);

  var bestScore = 0;
  var bestSignal = "none";
  var bestValue = "";
  var bestGroup = undefined;
  var signalScores = [];
  var totalMatchedTokens = 0;
  var positiveSignalCount = 0;

  for (var si = 0; si < signals.length; si++) {
    var signal = signals[si];
    var weight = signalWeights[signal.key] || 0.5;
    var normalized = signal.value
      .toLowerCase()
      .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      .replace(/[-_\/]/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    var signalTokens = normalized.split(/\s+/).filter(function(t) { return t.length > 1; });

    var matchedCount = 0;
    for (var sti = 0; sti < signalTokens.length; sti++) {
      var st = signalTokens[sti];
      if (allExpandedTokens.indexOf(st) >= 0) {
        matchedCount++;
      } else if (st.length >= 3) {
        for (var eti = 0; eti < allExpandedTokens.length; eti++) {
          var et = allExpandedTokens[eti];
          if (et.length >= 3 && (st.indexOf(et) >= 0 || et.indexOf(st) >= 0)) {
            matchedCount += 0.5;
            break;
          }
        }
      }
    }

    if (signalTokens.length > 0 && matchedCount > 0) {
      totalMatchedTokens += matchedCount;
      positiveSignalCount++;
      var score = (matchedCount / Math.max(signalTokens.length, targetTokens.length)) * weight;

      if (signalTokens.some(function(st) { return allExpandedTokens.indexOf(st) >= 0; })) {
        score += 0.2 * weight;
      }

      if (matchedGroupNames.length > 0) {
        var hasGroupToken = signalTokens.some(function(st) {
          for (var gni = 0; gni < matchedGroupNames.length; gni++) {
            if (st === matchedGroupNames[gni] || st.indexOf(matchedGroupNames[gni]) >= 0) return true;
          }
          return false;
        });
        if (hasGroupToken) {
          // Scale group bonus by proportion of matching tokens in this signal
          var groupProportion = matchedCount / Math.max(signalTokens.length, 1);
          score += 0.3 * groupProportion;
          if (!bestGroup) {
            bestGroup = matchedGroupNames.find(function(g) { return signalTokens.indexOf(g) >= 0; });
          }
        }
      }

      if (signal.key === "href" && matchedGroupNames.length > 0) {
        var pathParts = signal.value.toLowerCase().split(/[\/?#]/).filter(Boolean);
        if (pathParts.some(function(part) { return allExpandedTokens.indexOf(part) >= 0; })) {
          score += 0.3;
        }
      }

      signalScores.push({ key: signal.key, score: Math.min(score, 1.0) });

      if (score > bestScore) {
        bestScore = Math.min(score, 1.0);
        bestSignal = signal.key;
        bestValue = signal.value;
      }
    }
  }

  if (signalScores.length > 1) {
    var strongThreshold = bestScore * 0.75;
    var strongSignalCount = signalScores.filter(function(s) { return s.score >= strongThreshold; }).length;
    if (strongSignalCount > 1) {
      bestScore = Math.min(1.0, bestScore + (strongSignalCount - 1) * 0.03);
    }
  }

  if (bestScore > 0.2) {
    var selector = "";
    if (id) {
      selector = "#" + CSS.escape(id);
    } else if (rawDataTestid) {
      selector = "[data-testid=\"" + CSS.escape(rawDataTestid) + "\"]";
    } else if (rawDataTest) {
      selector = "[data-test=\"" + CSS.escape(rawDataTest) + "\"]";
    } else if (name) {
      selector = tagName + "[name=\"" + CSS.escape(name) + "\"]";
    } else if (ariaLabel) {
      selector = tagName + "[aria-label=\"" + CSS.escape(ariaLabel) + "\"]";
    } else if (className) {
      selector = tagName + "." + className.trim().split(/\s+/).map(function(c) { return CSS.escape(c); }).join(".");
    }

    var type = "button";
    if (tagName === "a" || role === "link") type = "link";
    else if (tagName === "input") type = "input";
    else if (tagName === "select") type = "select";
    else if (tagName === "textarea") type = "textarea";

    candidates.push({
      elementIndex: i,
      tagName: tagName,
      type: type,
      role: role,
      text: text,
      signals: signals,
      score: bestScore,
      matchedSignal: bestSignal,
      signalValue: bestValue,
      semanticGroup: bestGroup,
      totalMatchedTokens: totalMatchedTokens,
      positiveSignalCount: positiveSignalCount,
      selector: selector || tagName + ":nth-child(" + (i + 1) + ")"
    });
  }
}

candidates.sort(function(a, b) {
  if (a.score !== b.score) return b.score - a.score;
  var avgA = (a.totalMatchedTokens || 0) / Math.max(a.positiveSignalCount || 1, 1);
  var avgB = (b.totalMatchedTokens || 0) / Math.max(b.positiveSignalCount || 1, 1);
  if (avgA !== avgB) return avgB - avgA;
  return (b.totalMatchedTokens || 0) - (a.totalMatchedTokens || 0);
});
return candidates;
})();
