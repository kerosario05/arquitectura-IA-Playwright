import test from "node:test";
import assert from "node:assert/strict";
import { detailCaptureOwnsAction } from "./action-evidence-policy";
test("last route action retains generic capture even when inferred as final detail target",()=>{
 assert.equal(detailCaptureOwnsAction("Search",10,10,{isDetailEvidence:false}),false);
});
test("real detail capture keeps ownership only on its own action",()=>{
 assert.equal(detailCaptureOwnsAction("Details",10,10,{isDetailEvidence:true}),true);
 assert.equal(detailCaptureOwnsAction("Details",10,9,{isDetailEvidence:true}),false);
 assert.equal(detailCaptureOwnsAction("Details",10,10,undefined),false);
});
