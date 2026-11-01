import { describe,expect,it } from "vitest";
import { harness,nodes,textOf } from "./helpers/component-harness.mjs";
import * as catalog from "@/lib/nutrition/catalog";
import * as calculations from "@/lib/nutrition/manual-calculations";
import { nutrientWriteSchema } from "@/lib/nutrition/nutrient-schema";
const item:catalog.CatalogItem={id:"11111111-1111-4111-8111-111111111821",user_id:"11111111-1111-4111-8111-111111111811",item_type:"product",name:"old",brand:null,serving_size:100,serving_unit:"g",active:true,revision:3,nutrients:[{code:"protein",amount:12,unit:"g",quality:"unverified",provenance:"estimated_dish",value_origin:"estimated",contains_estimates:true,definition_basis:"total_protein",derivation:null},{code:"selenium",amount:null,unit:"ug",quality:"unverified",provenance:"approved_external_db",value_origin:"database",contains_estimates:null,definition_basis:"elemental_mass",source_uri:"https://example.invalid/nutrition"}]};
function setup(){const saved:unknown[]=[];const h=harness({"@/lib/nutrition/catalog":catalog,"@/lib/nutrition/manual-calculations":calculations,"@/lib/nutrition/nutrient-schema":{nutrientWriteSchema},"@/components/nutrient-calculation-actions":{NutrientCalculationActions:"Calculations"}});const {ProductManualEditor}=h.load("components/product-manual-editor.tsx");const render=()=>h.render(ProductManualEditor,{item,busy:false,onSave:async(v:unknown)=>{saved.push(v);},onClose(){}});return {h,render,saved};}
describe("manual product evidence",()=>{
 it("renames without losing unknown nutrients, estimate flags or chemical definitions",async()=>{
  const {render,saved}=setup();let tree=render();nodes(tree).find(n=>n?.props?.id==="manual-product-name")!.props.onChange({target:{value:"renamed"}});tree=render();await nodes(tree).find(n=>n?.type==="button"&&textOf(n)==="入力内容を確認して端末に保存")!.props.onClick();
  expect(saved[0]).toMatchObject({name:"renamed",nutrients:item.nutrients});
 });
 it("requires a serving-basis review and refreshes claims only after explicit confirmation",async()=>{
  const {render,saved}=setup();let tree=render();nodes(tree).find(n=>n?.props?.id==="manual-product-size")!.props.onChange({target:{value:"50"}});tree=render();await nodes(tree).find(n=>n?.type==="button"&&textOf(n)==="入力内容を確認して端末に保存")!.props.onClick();expect(saved).toHaveLength(0);expect(textOf(render())).toContain("基準量変更後");
  tree=render();nodes(tree).find(n=>n?.type==="input"&&n.props.type==="checkbox")!.props.onChange({target:{checked:true}});tree=render();await nodes(tree).find(n=>n?.type==="button"&&textOf(n)==="入力内容を確認して端末に保存")!.props.onClick();expect(saved[0]).toMatchObject({serving_size:50,nutrients:expect.arrayContaining([expect.objectContaining({code:"protein",value_origin:"user_reported"})])});
 });
});
