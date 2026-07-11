import { describe,expect,it } from 'vitest'
import { parseRange } from './range-request'

describe('parseRange',()=>{
 it.each([[undefined,{start:0,end:999,status:200}],['bytes=0-',{start:0,end:999,status:206}],['bytes=100-199',{start:100,end:199,status:206}],['bytes=-100',{start:900,end:999,status:206}]])('parses %s', (header,expected)=>expect(parseRange(header,1000)).toEqual(expected))
 it.each(['bytes=','bytes=x-y','items=0-1','bytes=1000-','bytes=20-10','bytes=0-1,4-5'])('rejects %s',header=>expect(parseRange(header,1000)).toEqual({status:416}))
})
