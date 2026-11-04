export const FOLLOW_UP_STEPS: string[];
export const MARKETING_FIELD_SPECS: {key:string;label:string;names:string[];type:'text'|'textarea'|'boolean'|'number'|'select';options?:string[]}[];
export function populatedSourceField(raw:Record<string,any>,name:string):any;
export function extractMarketingFields(raw:Record<string,any>):{follow_up:string|null;marketing_fields:Record<string,unknown>};
