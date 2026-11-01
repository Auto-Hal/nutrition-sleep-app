import { describe,expect,it } from "vitest";
import { STANDARD_NUTRIENT_DEFINITIONS } from "@/lib/nutrition/catalog";
import { groupOcrWordsIntoLines,type OcrWord } from "@/lib/products/ocr-document";
import { parseNutritionLabelDocument } from "@/lib/products/nutrition-label-parser";
const word=(text:string,x:number,y:number,width=50):OcrWord=>({text,confidence:.98,box:{minX:x,minY:y,maxX:x+width,maxY:y+24}});
function document(words:OcrWord[]){return {provider:"synthetic",text:words.map(w=>w.text).join("\n"),width:800,height:1800,words,lines:groupOcrWordsIntoLines(words)};}
describe("29 nutrient geometry OCR",()=>{
 it("retains an explicit separate RAE qualifier in a shuffled 29-row table",()=>{
  const words=STANDARD_NUTRIENT_DEFINITIONS.flatMap((d,i)=>[word(d.label,20,60+i*50,250),word(String(i+1),400,60+i*50),word(d.unit==="ug_rae"?"µg":d.unit,500,60+i*50),...(d.unit==="ug_rae"?[word("RAE",560,60+i*50)]:[])]).reverse();
  const parsed=parseNutritionLabelDocument(document(words));for(const [i,d] of STANDARD_NUTRIENT_DEFINITIONS.entries())expect(parsed.nutrients.find(n=>n.code===d.code),d.code).toEqual({code:d.code,amount:i+1,unit:d.unit});
 });
 it("does not turn generic vitamin A mass or DFE/IU into canonical mass",()=>{
  const words=[word("ビタミンA",20,60,200),word("500",400,60),word("µg",500,60),word("葉酸",20,110,200),word("400",400,110),word("µg",500,110),word("DFE",560,110),word("ビタミンD",20,160,200),word("100",400,160),word("IU",500,160)];
  expect(parseNutritionLabelDocument(document(words)).nutrients).toEqual([]);
 });
});
