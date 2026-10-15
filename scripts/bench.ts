import { getIndex } from "../src/index-store.js";
import { searchMods, checkPackHealth } from "../src/logic.js";
let t=Date.now(); const i=await getIndex(process.argv[2] ?? "lethal-company"); console.log("load ms",Date.now()-t,"pkgs",i.byName.size,"rss MB",Math.round(process.memoryUsage().rss/1e6));
console.log(searchMods(i,{query:"more company",limit:3}).results.map(r=>r.fullName));
console.log(checkPackHealth(i,["notnotnotswipez-MoreCompany","x753-More_Suits"]).counts);
