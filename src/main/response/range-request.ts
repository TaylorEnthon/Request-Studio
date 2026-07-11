export type ParsedRange={start?:number;end?:number;status:200|206|416}
export function parseRange(header:string|undefined,size:number):ParsedRange{
 if(!header)return {start:0,end:Math.max(0,size-1),status:200}
 const match=/^bytes=(\d*)-(\d*)$/.exec(header);if(!match||!size)return {status:416}
 let start:number,end:number
 if(!match[1]){const suffix=Number(match[2]);if(!suffix)return {status:416};start=Math.max(0,size-suffix);end=size-1}else{start=Number(match[1]);end=match[2]?Number(match[2]):size-1}
 if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||start>=size||end<start)return {status:416}
 return {start,end:Math.min(end,size-1),status:206}
}
