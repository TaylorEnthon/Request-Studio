export type EnvironmentValue={key:string;value:string;isSecret:boolean}
export function resolveTemplate(template:string,variables:EnvironmentValue[]){
 const dangling=template.replace(/\{\{[A-Za-z_][A-Za-z0-9_]*\}\}/g,'')
 if(dangling.includes('{{')||dangling.includes('}}'))throw new Error('Malformed environment variable placeholder')
 const map=new Map(variables.map(v=>[v.key,v])),used:string[]=[],secretNames:string[]=[]
 const value=template.replace(/\{\{([A-Za-z_][A-Za-z0-9_]*)\}\}/g,(_,name:string)=>{const found=map.get(name);if(!found)throw new Error(`Missing environment variable: ${name}`);used.push(name);if(found.isSecret)secretNames.push(name);return found.value})
 return {value,used:[...new Set(used)],secretNames:[...new Set(secretNames)]}
}
