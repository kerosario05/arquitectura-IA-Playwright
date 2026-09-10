import assert from "node:assert";
import { extractBoundedNodes, hitTest, parseBounds } from "./tap-hit-tester";
import { readableTitle } from "./android-session-recorder";
import {
  createTouchStreamParser,
  parseScreenSize,
  parseTouchDevices,
  summarizeProbedDevices,
  scalePoint,
} from "./android-touch-listener";

function test(label: string, fn: () => void): void {
  try {
    fn();
    console.log(`  PASS  ${label}`);
  } catch (err) {
    console.error(`  FAIL  ${label}: ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  }
}

function describe(name: string, fn: () => void): void {
  console.log(`\n${name}`);
  fn();
}

// A login screen where a labelled TextView sits inside the clickable button container —
// the exact shape that makes a naive "smallest node wins" hit test pick the wrong element.
const LOGIN_XML = `<?xml version="1.0" encoding="UTF-8"?>
<hierarchy rotation="0">
  <android.widget.FrameLayout package="com.bank.app" bounds="[0,0][1080,2400]" clickable="false" enabled="true">
    <android.widget.EditText resource-id="com.bank.app:id/user" text="" content-desc="Usuario" package="com.bank.app" bounds="[60,400][1020,540]" clickable="true" enabled="true" />
    <android.widget.LinearLayout resource-id="com.bank.app:id/submit" content-desc="Ingresar" package="com.bank.app" bounds="[60,700][1020,840]" clickable="true" enabled="true">
      <android.widget.TextView text="Ingresar" package="com.bank.app" bounds="[440,750][640,790]" clickable="false" enabled="true" />
    </android.widget.LinearLayout>
    <android.widget.Button resource-id="com.bank.app:id/next" text="Continuar" package="com.bank.app" bounds="[60,900][1020,1040]" clickable="true" enabled="false" />
    <android.widget.TextView text="Bienvenido" package="com.bank.app" bounds="[60,200][1020,280]" clickable="false" enabled="true" />
    <android.widget.FrameLayout package="com.android.systemui" bounds="[0,0][1080,80]" clickable="true" enabled="true" />
  </android.widget.FrameLayout>
</hierarchy>`;

describe("parseBounds", () => {
  test("parses an Android bounds pair into x/y/width/height", () => {
    assert.deepStrictEqual(parseBounds("[60,400][1020,540]"), { x: 60, y: 400, width: 960, height: 140 });
  });

  test("rejects a degenerate rectangle", () => {
    assert.strictEqual(parseBounds("[10,10][10,10]"), null);
    assert.strictEqual(parseBounds("not-bounds"), null);
    assert.strictEqual(parseBounds(undefined), null);
  });
});

describe("extractBoundedNodes", () => {
  const nodes = extractBoundedNodes(LOGIN_XML);

  test("captures every node that declares bounds", () => {
    assert.strictEqual(nodes.length, 7);
  });

  test("records the clickable and enabled attributes", () => {
    const next = nodes.find((n) => n.resourceId === "com.bank.app:id/next");
    assert.ok(next);
    assert.strictEqual(next.clickable, true);
    assert.strictEqual(next.enabled, false);
  });

  test("tracks depth so a child outranks a same-sized wrapper", () => {
    const wrapper = nodes.find((n) => n.resourceId === "com.bank.app:id/submit");
    const child = nodes.find((n) => n.text === "Ingresar");
    assert.ok(wrapper && child);
    assert.ok(child.depth > wrapper.depth);
  });
});

describe("hitTest", () => {
  const nodes = extractBoundedNodes(LOGIN_XML);

  test("a tap on the button's inner label resolves to the clickable container", () => {
    const hit = hitTest(nodes, 540, 770, { appPackage: "com.bank.app" });
    assert.ok(hit);
    assert.strictEqual(hit.target.label, "Ingresar");
    assert.strictEqual(hit.fallback, false);
    assert.deepStrictEqual(hit.target.locators[0], {
      strategy: "accessibilityId",
      value: "Ingresar",
      confidence: 0.95,
    });
  });

  test("a tap on an input resolves to the input and marks its role", () => {
    const hit = hitTest(nodes, 500, 470, { appPackage: "com.bank.app" });
    assert.ok(hit);
    assert.strictEqual(hit.target.role, "input");
    assert.strictEqual(hit.target.label, "Usuario");
  });

  test("carries the disabled state of a gated control", () => {
    const hit = hitTest(nodes, 500, 970, { appPackage: "com.bank.app" });
    assert.ok(hit);
    assert.strictEqual(hit.target.enabled, false);
  });

  test("a tap on static text falls back and says so", () => {
    const hit = hitTest(nodes, 500, 240, { appPackage: "com.bank.app" });
    assert.ok(hit);
    assert.strictEqual(hit.fallback, true);
    assert.strictEqual(hit.target.label, "Bienvenido");
  });

  test("ignores controls owned by another package", () => {
    const hit = hitTest(nodes, 540, 40, { appPackage: "com.bank.app" });
    // Only the app's root frame contains that point once System UI is filtered out.
    assert.ok(hit === null || hit.target.label === "");
  });

  test("returns null when the coordinate falls outside every node", () => {
    assert.strictEqual(hitTest(nodes, 5000, 5000, { appPackage: "com.bank.app" }), null);
  });
});

describe("touch calibration", () => {
  test("parses the touchscreen ranges from a labelled probe (getevent -lp)", () => {
    const probe = [
      "add device 1: /dev/input/event0",
      '  name:     "gpio-keys"',
      "    KEY (0001): KEY_POWER",
      "add device 2: /dev/input/event1",
      '  name:     "touchscreen"',
      "    ABS (0003): ABS_MT_SLOT           : value 0, min 0, max 9, fuzz 0, flat 0, resolution 0",
      "                ABS_MT_POSITION_X     : value 0, min 0, max 4095, fuzz 0, flat 0",
      "                ABS_MT_POSITION_Y     : value 0, min 0, max 8191, fuzz 0, flat 0",
    ].join("\n");
    assert.deepStrictEqual(parseTouchDevices(probe)[0], {
      devicePath: "/dev/input/event1",
      rawMaxX: 4095,
      rawMaxY: 8191,
      axes: "mt",
    });
  });

  // Without -l getevent prints axes as raw hex codes. Reading only the labels here is what
  // made every real device look like it had no touchscreen.
  test("parses the ranges from an unlabelled probe (getevent -p)", () => {
    const probe = [
      "add device 1: /dev/input/event0",
      '  name:     "gpio-keys"',
      "    KEY (0001): 0074  0001",
      "add device 2: /dev/input/event1",
      '  name:     "sec_touchscreen"',
      "    ABS (0003): 002f  : value 0, min 0, max 9, fuzz 0, flat 0, resolution 0",
      "                0035  : value 0, min 0, max 1439, fuzz 0, flat 0, resolution 0",
      "                0036  : value 0, min 0, max 2959, fuzz 0, flat 0, resolution 0",
    ].join("\n");
    assert.deepStrictEqual(parseTouchDevices(probe)[0], {
      devicePath: "/dev/input/event1",
      rawMaxX: 1439,
      rawMaxY: 2959,
      axes: "mt",
    });
  });

  test("falls back to a single-touch digitizer when no panel reports multitouch axes", () => {
    const probe = [
      "add device 1: /dev/input/event2",
      '  name:     "single-touch"',
      "    ABS (0003): ABS_X                 : value 0, min 0, max 1079, fuzz 0, flat 0",
      "                ABS_Y                 : value 0, min 0, max 1919, fuzz 0, flat 0",
    ].join("\n");
    assert.deepStrictEqual(parseTouchDevices(probe)[0], {
      devicePath: "/dev/input/event2",
      rawMaxX: 1079,
      rawMaxY: 1919,
      axes: "st",
    });
  });

  test("prefers a multitouch panel over a single-touch device listed first", () => {
    const probe = [
      "add device 1: /dev/input/event2",
      '  name:     "single-touch"',
      "    ABS (0003): ABS_X                 : value 0, min 0, max 1079, fuzz 0, flat 0",
      "                ABS_Y                 : value 0, min 0, max 1919, fuzz 0, flat 0",
      "add device 2: /dev/input/event1",
      '  name:     "touchscreen"',
      "    ABS (0003): ABS_MT_POSITION_X     : value 0, min 0, max 4095, fuzz 0, flat 0",
      "                ABS_MT_POSITION_Y     : value 0, min 0, max 8191, fuzz 0, flat 0",
    ].join("\n");
    assert.strictEqual(parseTouchDevices(probe)[0]?.devicePath, "/dev/input/event1");
  });

  test("does not mistake a key code for a position axis", () => {
    const probe = [
      "add device 1: /dev/input/event0",
      '  name:     "gpio-keys"',
      "    KEY (0001): 0000  0001  0035  0036",
    ].join("\n");
    assert.deepStrictEqual(parseTouchDevices(probe), []);
  });

  test("finds nothing when no device reports position axes", () => {
    assert.deepStrictEqual(parseTouchDevices('add device 1: /dev/input/event0\n  name: "gpio-keys"'), []);
  });

  // The emulator exposes eleven identical multi-touch nodes and only /dev/input/event2 ever
  // emits, so the recorder has to be handed all of them and listen to every one.
  test("returns every candidate, not just the first, on a multi-node emulator", () => {
    const probe = Array.from({ length: 3 }, (_, i) =>
      [
        `add device ${i + 1}: /dev/input/event${12 - i}`,
        `  name:     "virtio_input_multi_touch_${11 - i}"`,
        "    ABS (0003): ABS_MT_POSITION_X     : value 0, min 0, max 32767, fuzz 0, flat 0",
        "                ABS_MT_POSITION_Y     : value 0, min 0, max 32767, fuzz 0, flat 0",
      ].join("\n"),
    ).join("\n");
    assert.deepStrictEqual(
      parseTouchDevices(probe).map((device) => device.devicePath),
      ["/dev/input/event12", "/dev/input/event11", "/dev/input/event10"],
    );
  });

  test("lists the probed devices so a failed calibration can say what it saw", () => {
    const probe = [
      "add device 1: /dev/input/event0",
      '  name:     "gpio-keys"',
      "add device 2: /dev/input/event1",
      '  name:     "touchscreen"',
    ].join("\n");
    assert.deepStrictEqual(summarizeProbedDevices(probe), [
      "/dev/input/event0 (gpio-keys)",
      "/dev/input/event1 (touchscreen)",
    ]);
  });

  test("prefers an override screen size over the physical one", () => {
    const out = "Physical size: 1440x3120\nOverride size: 1080x2340";
    assert.deepStrictEqual(parseScreenSize(out), { width: 1080, height: 2340 });
  });

  test("scales a digitizer coordinate into display pixels", () => {
    const cal = { rawMaxX: 4095, rawMaxY: 8191, screenWidth: 1080, screenHeight: 2400 };
    assert.deepStrictEqual(scalePoint(2048, 4096, cal), { x: 540, y: 1200 });
  });
});

describe("createTouchStreamParser", () => {
  const calibration = { rawMaxX: 1080, rawMaxY: 2400, screenWidth: 1080, screenHeight: 2400 };

  function feed(parser: ReturnType<typeof createTouchStreamParser>, lines: string[]) {
    const out = [];
    for (const line of lines) out.push(...parser.push(line));
    return out;
  }

  test("reassembles a tap from a tracking-id framed contact", () => {
    const parser = createTouchStreamParser({ calibration });
    const gestures = feed(parser, [
      "[   1000.000000] /dev/input/event1: EV_ABS       ABS_MT_TRACKING_ID   00000001",
      "[   1000.000000] /dev/input/event1: EV_ABS       ABS_MT_POSITION_X    0000021c",
      "[   1000.000000] /dev/input/event1: EV_ABS       ABS_MT_POSITION_Y    00000302",
      "[   1000.000000] /dev/input/event1: EV_SYN       SYN_REPORT           00000000",
      "[   1000.080000] /dev/input/event1: EV_ABS       ABS_MT_TRACKING_ID   ffffffff",
      "[   1000.080000] /dev/input/event1: EV_SYN       SYN_REPORT           00000000",
    ]);
    assert.strictEqual(gestures.length, 1);
    assert.deepStrictEqual(gestures[0], { kind: "tap", x: 540, y: 770, t: 0 });
  });

  test("reassembles a tap from a BTN_TOUCH framed contact", () => {
    const parser = createTouchStreamParser({ calibration });
    const gestures = feed(parser, [
      "[   2000.000000] /dev/input/event1: EV_ABS       ABS_MT_POSITION_X    00000064",
      "[   2000.000000] /dev/input/event1: EV_ABS       ABS_MT_POSITION_Y    000000c8",
      "[   2000.000000] /dev/input/event1: EV_KEY       BTN_TOUCH            DOWN",
      "[   2000.000000] /dev/input/event1: EV_KEY       BTN_TOUCH            00000001",
      "[   2000.000000] /dev/input/event1: EV_SYN       SYN_REPORT           00000000",
      "[   2000.050000] /dev/input/event1: EV_KEY       BTN_TOUCH            00000000",
    ]);
    assert.strictEqual(gestures.length, 1);
    assert.strictEqual(gestures[0].kind, "tap");
    assert.strictEqual(gestures[0].x, 100);
    assert.strictEqual(gestures[0].y, 200);
  });

  test("classifies a long travel as a swipe with its endpoints", () => {
    const parser = createTouchStreamParser({ calibration });
    const gestures = feed(parser, [
      "[   3000.000000] /dev/input/event1: EV_ABS       ABS_MT_TRACKING_ID   00000002",
      "[   3000.000000] /dev/input/event1: EV_ABS       ABS_MT_POSITION_X    00000064",
      "[   3000.000000] /dev/input/event1: EV_ABS       ABS_MT_POSITION_Y    00000640",
      "[   3000.000000] /dev/input/event1: EV_SYN       SYN_REPORT           00000000",
      "[   3000.200000] /dev/input/event1: EV_ABS       ABS_MT_POSITION_Y    000000c8",
      "[   3000.200000] /dev/input/event1: EV_SYN       SYN_REPORT           00000000",
      "[   3000.300000] /dev/input/event1: EV_ABS       ABS_MT_TRACKING_ID   ffffffff",
    ]);
    assert.strictEqual(gestures.length, 1);
    const swipe = gestures[0];
    assert.strictEqual(swipe.kind, "swipe");
    if (swipe.kind !== "swipe") return;
    assert.strictEqual(swipe.y, 1600);
    assert.strictEqual(swipe.toY, 200);
    assert.strictEqual(swipe.durationMs, 300);
  });

  // Seen for real on the emulator: a release followed by a new tracking id that reports no
  // position of its own. Reusing the previous coordinates would invent a tap on whatever
  // control sits there.
  test("drops a contact that never reports a coordinate", () => {
    const parser = createTouchStreamParser({ calibration });
    const gestures = feed(parser, [
      "[   6000.000000] /dev/input/event1: EV_ABS       ABS_MT_TRACKING_ID   00000001",
      "[   6000.000000] /dev/input/event1: EV_ABS       ABS_MT_POSITION_X    00000064",
      "[   6000.000000] /dev/input/event1: EV_ABS       ABS_MT_POSITION_Y    000000c8",
      "[   6000.000000] /dev/input/event1: EV_SYN       SYN_REPORT           00000000",
      "[   6000.100000] /dev/input/event1: EV_ABS       ABS_MT_TRACKING_ID   ffffffff",
      "[   6000.100000] /dev/input/event1: EV_SYN       SYN_REPORT           00000000",
      "[   6000.200000] /dev/input/event1: EV_ABS       ABS_MT_TRACKING_ID   00000002",
      "[   6000.200000] /dev/input/event1: EV_SYN       SYN_REPORT           00000000",
      "[   6000.300000] /dev/input/event1: EV_ABS       ABS_MT_TRACKING_ID   ffffffff",
      "[   6000.300000] /dev/input/event1: EV_SYN       SYN_REPORT           00000000",
    ]);
    assert.strictEqual(gestures.length, 1);
    assert.deepStrictEqual(gestures[0], { kind: "tap", x: 100, y: 200, t: 0 });
  });

  test("reassembles a tap on a single-touch digitizer (ABS_X / ABS_Y)", () => {
    const parser = createTouchStreamParser({ calibration });
    const gestures = feed(parser, [
      "[   7000.000000] /dev/input/event1: EV_ABS       ABS_X                000001f4",
      "[   7000.000000] /dev/input/event1: EV_ABS       ABS_Y                000003e8",
      "[   7000.000000] /dev/input/event1: EV_KEY       BTN_TOUCH            00000001",
      "[   7000.000000] /dev/input/event1: EV_SYN       SYN_REPORT           00000000",
      "[   7000.060000] /dev/input/event1: EV_KEY       BTN_TOUCH            00000000",
    ]);
    assert.deepStrictEqual(gestures, [{ kind: "tap", x: 500, y: 1000, t: 0 }]);
  });

  test("ignores lines from another input device", () => {
    const parser = createTouchStreamParser({ calibration, devicePath: "/dev/input/event1" });
    const gestures = feed(parser, [
      "[   4000.000000] /dev/input/event0: EV_KEY       KEY_POWER            00000001",
      "[   4000.000000] /dev/input/event0: EV_KEY       KEY_POWER            00000000",
    ]);
    assert.deepStrictEqual(gestures, []);
  });

  test("a jitter smaller than the tap threshold stays a tap", () => {
    const parser = createTouchStreamParser({ calibration, tapMaxDistancePx: 24 });
    const gestures = feed(parser, [
      "[   5000.000000] /dev/input/event1: EV_ABS       ABS_MT_TRACKING_ID   00000003",
      "[   5000.000000] /dev/input/event1: EV_ABS       ABS_MT_POSITION_X    000000c8",
      "[   5000.000000] /dev/input/event1: EV_ABS       ABS_MT_POSITION_Y    000000c8",
      "[   5000.000000] /dev/input/event1: EV_SYN       SYN_REPORT           00000000",
      "[   5000.100000] /dev/input/event1: EV_ABS       ABS_MT_POSITION_X    000000d2",
      "[   5000.100000] /dev/input/event1: EV_SYN       SYN_REPORT           00000000",
      "[   5000.150000] /dev/input/event1: EV_ABS       ABS_MT_TRACKING_ID   ffffffff",
    ]);
    assert.strictEqual(gestures.length, 1);
    assert.strictEqual(gestures[0].kind, "tap");
  });
});

describe("readableTitle", () => {
  // This app's headers are icon-font glyphs in the private-use area: they slug down to
  // nothing, which is what collapsed every screen onto one key.
  test("skips a title made of icon-font glyphs", () => {
    const snapshot = {
      title: "\uf110",
      assertionTargets: ["\uf110", "Hola, valida tus datos de contacto.", "Continuar"],
    };
    assert.strictEqual(readableTitle(snapshot), "Hola, valida tus datos de contacto.");
  });

  test("keeps a real title", () => {
    assert.strictEqual(
      readableTitle({ title: "Iniciar sesión", assertionTargets: ["Usuario"] }),
      "Iniciar sesión",
    );
  });

  test("returns undefined when no text carries letters or digits", () => {
    assert.strictEqual(readableTitle({ title: "", assertionTargets: ["···", "—"] }), undefined);
  });
});

// The shape that makes a recorded locator useless: the same accessibility label on two
// different controls. This is verbatim from com.appconversacionalbsc — one "Enviar código de
// validación" for the email, another for the phone.
const DUPLICATE_LABEL_XML = `<?xml version="1.0" encoding="UTF-8"?>
<hierarchy rotation="0">
  <node class="android.view.ViewGroup" package="com.bank.app" bounds="[0,0][1440,3120]" clickable="false" enabled="true">
    <node class="android.view.ViewGroup" content-desc="kev*****05@gmail.com, " package="com.bank.app" bounds="[84,902][1356,1070]" clickable="true" enabled="true" />
    <node class="android.view.ViewGroup" content-desc="Enviar código de validación" package="com.bank.app" bounds="[84,1098][1356,1250]" clickable="true" enabled="true" />
    <node class="android.view.ViewGroup" content-desc="(829) ***-**00, " package="com.bank.app" bounds="[84,1421][1356,1589]" clickable="true" enabled="true" />
    <node class="android.view.ViewGroup" content-desc="Enviar código de validación" package="com.bank.app" bounds="[84,1617][1356,1769]" clickable="true" enabled="true" />
    <node class="android.view.ViewGroup" content-desc="Salir" package="com.bank.app" bounds="[84,2886][1356,3036]" clickable="true" enabled="true" />
  </node>
</hierarchy>`;

describe("locator uniqueness", () => {
  const nodes = extractBoundedNodes(DUPLICATE_LABEL_XML);

  test("a label that is unique on the screen is offered as-is", () => {
    const hit = hitTest(nodes, 720, 2950, { appPackage: "com.bank.app" });
    assert.deepStrictEqual(hit?.target.locators[0], {
      strategy: "accessibilityId",
      value: "Salir",
      confidence: 0.95,
    });
  });

  test("two controls sharing a label resolve to different locators", () => {
    const email = hitTest(nodes, 720, 1170, { appPackage: "com.bank.app" });
    const phone = hitTest(nodes, 720, 1690, { appPackage: "com.bank.app" });
    const first = email?.target.locators[0];
    const second = phone?.target.locators[0];
    assert.ok(first && second);
    assert.notStrictEqual(first.value, second.value);
    assert.strictEqual(first.value, 'new UiSelector().description("Enviar código de validación").instance(0)');
    assert.strictEqual(second.value, 'new UiSelector().description("Enviar código de validación").instance(1)');
  });

  test("a positional locator is marked ambiguous and drops below the uncertainty threshold", () => {
    const phone = hitTest(nodes, 720, 1690, { appPackage: "com.bank.app" });
    const locator = phone?.target.locators[0];
    assert.strictEqual(locator?.ambiguous, true);
    assert.strictEqual(locator?.matchIndex, 1);
    assert.ok((locator?.confidence ?? 1) < 0.7);
  });

  test("a composite content-desc is anchored on its longest segment and stays unique", () => {
    const hit = hitTest(nodes, 720, 980, { appPackage: "com.bank.app" });
    assert.strictEqual(hit?.target.locators[0].ambiguous, undefined);
    assert.match(hit?.target.locators[0].value ?? "", /descriptionContains\("kev\*\*\*\*\*05@gmail\.com"\)/);
  });
});
