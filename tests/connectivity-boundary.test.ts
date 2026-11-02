import { describe,expect,it } from "vitest";
import { harness,nodes,textOf,settle } from "./helpers/component-harness.mjs";
describe("loaded offline screen",()=>{
 it("retains the open form, clearly labels old known data and updates local queue counts",async()=>{
  let count=0;const events=new Map<string,()=>void>();const h=harness({"@/lib/offline/outbox-idb":{countUnsyncedOutbox:async()=>count}});
  h.context.window.addEventListener=(name:string,fn:()=>void)=>events.set(name,fn);
  const {ConnectivityBoundary}=h.load("components/connectivity-boundary.tsx");const child={type:"form",props:{id:"open-entry",children:"in-memory input"}};
  const render=()=>h.render(ConnectivityBoundary,{binding:{ownerUserId:"owner",environmentId:"local"},children:child});
  render();h.effects[0]();h.context.navigator.onLine=false;events.get("offline")!();await settle();let tree=render();
  expect(nodes(tree)).toContain(child);expect(textOf(tree)).toContain("最後に取得した時点");expect(textOf(tree)).toContain("正式な達成判定ではありません");
  count=1;events.get("outbox")!();await settle();expect(textOf(render())).toContain("未同期の操作が1件");
  h.context.navigator.onLine=true;events.get("online")!();tree=render();expect(nodes(tree)).toContain(child);expect(textOf(tree)).not.toContain("オフライン・取得済み");
 });
});
