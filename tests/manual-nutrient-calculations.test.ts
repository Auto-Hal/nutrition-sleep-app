import { describe,expect,it } from "vitest";
import { explicitCalculation,applyManualCalculations } from "@/lib/nutrition/manual-calculations";
import { nutrientWriteSchema } from "@/lib/nutrition/nutrient-schema";
import type { NutrientValue } from "@/lib/nutrition/catalog";
const sodium:NutrientValue={code:"sodium",amount:1000,unit:"mg",provenance:"user_entered",quality:"unverified",value_origin:"estimated",contains_estimates:true};
describe("explicit calculations in manual forms",()=>{
 it("retains estimates and invalidates the result after a source change",()=>{const result=explicitCalculation("salt_equivalent",[sodium]);expect(applyManualCalculations([sodium,{...result.nutrient,derivation:null}],[result])[1]).toEqual(result.nutrient);expect(()=>applyManualCalculations([{...sodium,amount:1200},result.nutrient],[result])).toThrow();expect(()=>applyManualCalculations([sodium,{...result.nutrient,amount:1}],[result])).toThrow();});
 it("records the matching Japanese label confirmation without changing input evidence",()=>{const c:NutrientValue={code:"carbohydrate",amount:20,unit:"g",provenance:"product_label",quality:"user_verified",value_origin:"label",contains_estimates:false};const f={...c,code:"fiber" as const,amount:3};const result=explicitCalculation("carbohydrate_excluding_fiber",[c,f],true);expect(result.nutrient.amount).toBe(17);expect(nutrientWriteSchema.safeParse(result.nutrient).success).toBe(true);expect(c.definition_basis).toBeUndefined();expect(()=>explicitCalculation("carbohydrate_excluding_fiber",[{...c,definition_basis:"carbohydrates_excluding_fiber"},f],true)).toThrow();});
});
