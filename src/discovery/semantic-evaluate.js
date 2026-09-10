// This file is loaded as a string and passed to page.evaluate().
// It must remain plain JavaScript: the caller injects the __DATA__ variables.
(function() {
var allExpandedTokens = __DATA_EXPANDED__;
var targetTokens = __DATA_TOKENS__;
var matchedGroupNames = __DATA_GROUPS__;
var semanticSelectors = __DATA_SELECTORS__;
var signalWeights = {"text":1.0,"aria-label":1.0,"title":0.9,"alt":0.8,"href":0.9,"data-testid":0.9,"class":0.7,"id":0.7,"name":0.8};
var elements = document.querySelectorAll(semanticSelectors.join(","));
var candidates = [];
for (var i = 0; i < elements.length; i++) {
  var el = elements[i];
  if (el.offsetParent === null && !el.hasAttribute("aria-hidden")) continue;
  var tagName = el.tagName.toLowerCase();
  var role = el.getAttribute("role") || undefined;
  var text = (el.textContent || "").replace(/\s+/g, " ").trim() || undefined;
  var signals = [];
  function addSignal(k, v) { if (v && v.length > 0) signals.push({key:k,value:v}); }
  addSignal("text", text);
  addSignal("aria-label", el.getAttribute("aria-label") || undefined);
  addSignal("title", el.getAttribute("title") || undefined);
  addSignal("alt", el.alt || undefined);
  addSignal("href", el.href || undefined);
  var rawDataTestid = el.getAttribute("data-testid");
  var rawDataTest = el.getAttribute("data-test");
  addSignal("data-testid", rawDataTestid || rawDataTest || undefined);
  addSignal("class", el.getAttribute("class") || undefined);
  addSignal("id", el.getAttribute("id") || undefined);
  addSignal("name", el.getAttribute("name") || undefined);
  var bestScore = 0, bestSignal = "none", bestValue = "", bestGroup;
  for (var si = 0; si < signals.length; si++) {
    var signal = signals[si], weight = signalWeights[signal.key] || 0.5;
    var normalized = signal.value.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[-_\/]/g, " ").replace(/\s+/g, " ").trim();
    var signalTokens = normalized.split(/\s+/).filter(function(t){return t.length > 1;});
    var matchedCount = 0;
    for (var sti = 0; sti < signalTokens.length; sti++) {
      var st = signalTokens[sti];
      if (allExpandedTokens.indexOf(st) >= 0) matchedCount++;
      else if (st.length >= 3) for (var eti = 0; eti < allExpandedTokens.length; eti++) {
        var et = allExpandedTokens[eti];
        if (et.length >= 3 && (st.indexOf(et) >= 0 || et.indexOf(st) >= 0)) { matchedCount += 0.5; break; }
      }
    }
    if (!matchedCount || !signalTokens.length) continue;
    var score = matchedCount / Math.max(signalTokens.length, targetTokens.length) * weight;
    if (signalTokens.some(function(st){return allExpandedTokens.indexOf(st) >= 0;})) score += 0.2 * weight;
    if (matchedGroupNames.length > 0) {
      var hasGroup = signalTokens.some(function(st){return matchedGroupNames.some(function(g){return st === g || st.indexOf(g) >= 0;});});
      if (hasGroup) { score += 0.3 * matchedCount / Math.max(signalTokens.length, 1); if (!bestGroup) bestGroup = matchedGroupNames.find(function(g){return signalTokens.indexOf(g) >= 0;}); }
    }
    if (signal.key === "href" && matchedGroupNames.length > 0 && signal.value.toLowerCase().split(/[\/?#]/).some(function(p){return allExpandedTokens.indexOf(p) >= 0;})) score += 0.3;
    if (score > bestScore) { bestScore = Math.min(score, 1); bestSignal = signal.key; bestValue = signal.value; }
  }
  if (bestScore <= 0.2) continue;
  var selector = "";
  var id = el.getAttribute("id"), aria = el.getAttribute("aria-label"), name = el.getAttribute("name"), cls = el.getAttribute("class");
  if (id) selector = "#" + CSS.escape(id);
  else if (rawDataTestid) selector = "[data-testid=\"" + CSS.escape(rawDataTestid) + "\"]";
  else if (rawDataTest) selector = "[data-test=\"" + CSS.escape(rawDataTest) + "\"]";
  else if (name) selector = tagName + "[name=\"" + CSS.escape(name) + "\"]";
  else if (aria) selector = tagName + "[aria-label=\"" + CSS.escape(aria) + "\"]";
  else if (cls) selector = tagName + "." + cls.trim().split(/\s+/).map(function(c){return CSS.escape(c);}).join(".");
  var type = tagName === "a" || role === "link" ? "link" : tagName === "input" ? "input" : tagName === "select" ? "select" : tagName === "textarea" ? "textarea" : "button";
  candidates.push({elementIndex:i,tagName:tagName,type:type,role:role,text:text,signals:signals,score:bestScore,matchedSignal:bestSignal,signalValue:bestValue,semanticGroup:bestGroup,selector:selector || tagName + ":nth-child(" + (i+1) + ")"});
}
candidates.sort(function(a,b){return b.score-a.score;});
return candidates;
})();
