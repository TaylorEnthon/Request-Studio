import { expect, it } from 'vitest'
import { resolveTemplate } from './variable-resolver'

it('resolves one pass and reports missing or malformed placeholders',()=>{
 expect(resolveTemplate('a={{A}}&b={{B}}',[{key:'A',value:'x y',isSecret:false},{key:'B',value:'{{A}}',isSecret:true}])).toEqual({value:'a=x y&b={{A}}',used:['A','B'],secretNames:['B']})
 expect(()=>resolveTemplate('{{MISSING}}',[])).toThrow(/MISSING/)
 expect(()=>resolveTemplate('bad {{A',[])).toThrow(/placeholder/)
})
