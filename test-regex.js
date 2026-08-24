const regex = /promotedRuntime\.([A-Za-z_]\w*)\s*\(\s*\{([\s\S]*?)\}\s*\)/gm;

const testBody1 = `
await promotedRuntime.selectFirstVisibleByLabel({
  stepIndex: 6,
  target: 'button',
  label: 'Depósitos a plazo',
  action: async () => {
    await page.click('text=Depósitos a plazo');
  }
});
`;

const testBody2 = `
await promotedRuntime.selectFirstVisibleByLabel({
  stepIndex: 6,
  target: { strategy: 'role', value: 'button' },
  label: 'Depósitos a plazo',
  action: async () => {
    await page.click('text=Depósitos a plazo');
  }
});
`;

const testBody3 = `
await promotedRuntime.selectByOrdinal({
  stepIndex: 7,
  selector: 'select',
  ordinal: 1,
  action: async (el) => {
    await el.selectOption({ value: 'option1', label: 'Option 1' });
  }
});
`;

function extractActionCallbackBody(callBody) {
  const actionKey = /\baction\s*:/g;
  let keyMatch;
  let searchFrom = 0;
  while ((keyMatch = actionKey.exec(callBody)) !== null) {
    let i = keyMatch.index + keyMatch[0].length;
    while (i < callBody.length && /\s/.test(callBody[i])) i += 1;
    const asyncMatch = /^async\b/.exec(callBody.slice(i));
    if (asyncMatch) i += asyncMatch[0].length;
    while (i < callBody.length && /\s/.test(callBody[i])) i += 1;
    if (callBody[i] === "(") {
      let depth = 0;
      while (i < callBody.length) {
        if (callBody[i] === "(") depth += 1;
        else if (callBody[i] === ")") { depth -= 1; if (depth === 0) { i += 1; break; } }
        i += 1;
      }
    }
    while (i < callBody.length && /\s/.test(callBody[i])) i += 1;
    if (callBody[i] === "=" && callBody[i + 1] === ">") i += 2;
    else { searchFrom = i; continue; }
    while (i < callBody.length && /\s/.test(callBody[i])) i += 1;
    if (callBody[i] !== "{") { searchFrom = i; continue; }
    return extractBalancedBraces(callBody, i);
  }
  return undefined;
}

function extractBalancedBraces(body, startIdx) {
  let depth = 0;
  let i = startIdx;
  let inString = null;
  let escaped = false;
  while (i < body.length) {
    const ch = body[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === inString) inString = null;
      i += 1;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") { inString = ch; i += 1; continue; }
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return body.slice(startIdx + 1, i);
    }
    i += 1;
  }
  return undefined;
}

function extractStringLiterals(body) {
  const literals = [];
  let i = 0;
  let depth = 0;
  let inCall = false;
  let callDepth = 0;
  while (i < body.length) {
    const ch = body[i];
    if (ch === '"' || ch === "'") {
      const quote = ch;
      let j = i + 1;
      let value = "";
      while (j < body.length && body[j] !== quote) {
        if (body[j] === "\\") { j += 2; continue; }
        value += body[j];
        j += 1;
      }
      if (j < body.length && inCall && (depth - callDepth) === 1) {
        if (value.trim().length > 0) literals.push(value);
      }
      i = j < body.length ? j + 1 : body.length;
      continue;
    }
    if (ch === "(") {
      const isFuncCall = i > 0 && /[a-zA-Z_$\d]/.test(body[i - 1]);
      depth += 1;
      if (isFuncCall && !inCall) { inCall = true; callDepth = depth; }
      i += 1;
      continue;
    }
    if (ch === ")") {
      depth -= 1;
      if (depth < callDepth) { inCall = false; callDepth = 0; }
      i += 1;
      continue;
    }
    i += 1;
  }
  return literals;
}

function normalizeOracleMatch(s) {
  return s.replace(/['"]/g, '').trim().toLowerCase();
}

for (const [name, testBody] of [['test1 (simple)', testBody1], ['test2 (object target)', testBody2], ['test3 (selectByOrdinal)', testBody3]]) {
  console.log('=== ' + name + ' ===');
  let match;
  while ((match = regex.exec(testBody)) !== null) {
    console.log('Method:', match[1]);
    console.log('Body length:', match[2].length);
    const callbackBody = extractActionCallbackBody(match[2]);
    if (callbackBody) {
      console.log('Callback found, length:', callbackBody.length);
      const literals = extractStringLiterals(callbackBody);
      console.log('String literals:', literals);
      console.log('Contains Depósitos:', literals.some(l => normalizeOracleMatch(l) === normalizeOracleMatch('Depósitos a plazo')));
    } else {
      console.log('NO callback found');
    }
  }
  regex.lastIndex = 0;
  console.log('');
}
