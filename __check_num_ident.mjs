import { loadTrace } from "./src/recording/recording-store.ts";
const trace = loadTrace("portal-comercial", "97f7c6dd-365a-4c5c-b82e-aaf25040916a");
const idx = trace.events.findIndex(e => e.target?.associatedField === "Número de identificación" && e.kind === "fill");
console.log("fill idx=", idx, JSON.stringify(trace.events[idx]?.target?.technicalTargetCandidates ?? "NONE", null, 1));
const idx2 = trace.events.findIndex(e => e.target?.associatedField === "Tasa");
console.log("Tasa idx=", idx2, JSON.stringify(trace.events[idx2]?.target?.technicalTargetCandidates ?? "NONE", null, 1));
