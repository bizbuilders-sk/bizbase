import type {Field} from './workspace-model.ts';
const normalize=(text:string)=>text.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase();
export function fieldMatchesQuery(field:Field,query:string):boolean {
 return normalize(field.label+' '+(field.groupSection||'')).includes(normalize(query.trim()));
}
