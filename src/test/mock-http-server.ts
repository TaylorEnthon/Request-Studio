import { createServer } from 'node:http'
export async function startMockServer(){
 const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nH0AAAAASUVORK5CYII=','base64'),wav=Buffer.concat([Buffer.from('RIFF'),Buffer.alloc(4),Buffer.from('WAVEfmt '),Buffer.from([16,0,0,0,1,0,1,0,64,31,0,0,64,31,0,0,1,0,8,0]),Buffer.from('data'),Buffer.alloc(4)])
 const server=createServer(async(req,res)=>{const url=new URL(req.url||'/',`http://${req.headers.host}`),chunks:Buffer[]=[];for await(const chunk of req)chunks.push(Buffer.from(chunk));const body=Buffer.concat(chunks)
  if(url.pathname==='/json'){res.setHeader('content-type','application/json');res.end(JSON.stringify({ok:true,query:[...url.searchParams]}));return}
  if(url.pathname==='/echo-json'){res.setHeader('content-type','application/json');res.end(body);return}
  if(url.pathname==='/text'){res.setHeader('content-type','text/plain');res.end('hello');return}
  if(url.pathname==='/html'){res.setHeader('content-type','text/html');res.end('<h1>safe text</h1>');return}
  if(url.pathname==='/xml'){res.setHeader('content-type','application/xml');res.end('<root/>');return}
  if(url.pathname==='/binary'){res.setHeader('content-type','application/octet-stream');res.end(Buffer.from([0,1,2,3]));return}
  const media:Record<string,[string,Buffer]>= {'/image/png':['image/png',png],'/image/jpeg':['image/jpeg',Buffer.from('ffd8ffe000104a4649460001ffd9','hex')],'/image/webp':['image/webp',Buffer.from('RIFF0000WEBP')],'/audio/wav':['audio/wav',wav],'/audio/mp3':['audio/mpeg',Buffer.from('ID3\u0004\u0000\u0000')],'/video/mp4':['video/mp4',Buffer.from('000000186674797069736f6d00000000','hex')],'/pdf':['application/pdf',Buffer.from('%PDF-1.4\n%%EOF')],'/binary/zip':['application/zip',Buffer.from('504b0304','hex')],'/binary/executable-signature':['application/octet-stream',Buffer.from('MZsafe')],'/wrong-mime/png-as-text':['text/plain',png],'/wrong-mime/text-as-image':['image/png',Buffer.from('plain text')]}
  if(media[url.pathname]){const [type,data]=media[url.pathname];res.setHeader('content-type',type);if(url.pathname==='/audio/wav'||url.pathname==='/video/mp4')res.setHeader('accept-ranges','bytes');const match=/^bytes=(\d+)-(\d*)$/.exec(String(req.headers.range||''));if(match){const start=Number(match[1]),end=match[2]?Math.min(Number(match[2]),data.length-1):data.length-1;if(start>=data.length){res.statusCode=416;res.setHeader('content-range',`bytes */${data.length}`);res.end();return}res.statusCode=206;res.setHeader('content-range',`bytes ${start}-${end}/${data.length}`);res.end(data.subarray(start,end+1));return}res.end(data);return}
  if(url.pathname==='/json/base64-image'){res.setHeader('content-type','application/json');res.end(JSON.stringify({image:png.toString('base64')}));return}
  if(url.pathname==='/json/base64-audio'){res.setHeader('content-type','application/json');res.end(JSON.stringify({audio:wav.toString('base64')}));return}
  if(url.pathname==='/json/data-url-image'){res.setHeader('content-type','application/json');res.end(JSON.stringify({image:`data:image/png;base64,${png.toString('base64')}`}));return}
  if(url.pathname==='/json/invalid-base64'){res.setHeader('content-type','application/json');res.end(JSON.stringify({data:'@@@='}));return}
  if(url.pathname==='/empty'){res.statusCode=204;res.end();return}
  if(url.pathname.startsWith('/status/')){res.statusCode=Number(url.pathname.split('/').pop());res.end('status');return}
  if(url.pathname.startsWith('/delay/')){setTimeout(()=>res.end('late'),Number(url.pathname.split('/').pop()));return}
  if(url.pathname.startsWith('/large/')){res.end(Buffer.alloc(Number(url.pathname.split('/').pop()),65));return}
  res.statusCode=404;res.end('missing')})
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const address=server.address();if(!address||typeof address==='string')throw new Error('Mock server failed')
 return {baseUrl:`http://127.0.0.1:${address.port}`,close:()=>new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()))}
}
