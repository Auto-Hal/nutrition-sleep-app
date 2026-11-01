import { NUTRIENT_BASIS_CONTRACT } from "@/lib/nutrition/evidence-contract";
/** Compatibility for new period/output paths. Old DRI evidence remains intact.
 * A stored number is not automatically a comparable standard nutrient amount. */
export function nutrientValueCompatible(
  value: {
    nutrient_code: string;
    unit: string;
    amount: string | null;
    definition_basis: string | null;
    source_uri: string | null;
  },
  expectedUnit: string,
) {
  const {
    nutrient_code: code,
    definition_basis: basis,
    source_uri: uri,
  } = value;
  if (
    value.amount === null ||
    !/^\d+(?:\.\d+)?$/.test(value.amount) ||
    value.unit !== expectedUnit
  )
    return false;
  const contract = NUTRIENT_BASIS_CONTRACT[code];
  if (!contract || (basis !== null && !contract.allowed.includes(basis)))
    return false;
  if (
    uri?.toLowerCase().includes("openfoodfacts") &&
    ((code === "vitamin_a" && !["total_rae", "rae"].includes(basis ?? "")) ||
      (code === "vitamin_e" && basis !== "alpha_tocopherol"))
  )
    return false;
  const bad = (values: string[]) => basis !== null && values.includes(basis);
  if (
    code === "carbohydrate" &&
    (bad([
      "carbohydrates_excluding_fiber",
      "available_carbohydrate_monosaccharide",
    ]) ||
      (uri?.includes("openfoodfacts") &&
        basis !== "total_carbohydrate_including_fiber"))
  )
    return false;
  if (
    code === "vitamin_a" &&
    bad(["iu", "retinol_mass", "beta_carotene_mass", "generic_ug"])
  )
    return false;
  if (code === "vitamin_e" && bad(["iu", "alpha_te", "total_tocopherol"]))
    return false;
  if (code === "folate" && bad(["dfe", "folic_acid_only"])) return false;
  if (code === "n3_fatty_acids" && bad(["ala_only", "epa_only", "dha_only"]))
    return false;
  if (code === "n6_fatty_acids" && bad(["linoleic_acid_only"])) return false;
  if (
    code === "carbohydrate_excluding_fiber" &&
    bad(["sugars", "total_sugars", "available_carbohydrate_monosaccharide"])
  )
    return false;
  return true;
}
