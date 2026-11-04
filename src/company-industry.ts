// Pipedrive Organization / Industry choices, verified from the connected schema.
export const COMPANY_INDUSTRIES = ['Accommodation services','Administrative and support services','Construction','Consumer services','Education','Entertainment providers','Farming, ranching, forestry','Financial services','Government administration','Holding companies','Hospitals and health care','Manufacturing','Oil, gas, and mining','Professional services','Real estate and equipment rental services','Retail','Technology, information and media','Transportation, logistics, supply chain and storage','Utilities','Wholesale'];
export function companyIndustry(value:unknown):string {
 if(value===null||value===undefined)return '';
 const text=String(value).trim();return /^\d+$/.test(text)?COMPANY_INDUSTRIES[Number(text)-1]||text:text;
}
