import { createServer } from 'node:http'
export async function startMockServer(){
 const server=createServer(async(req,res)=>{const url=new URL(req.url||'/',`http://${req.headers.host}`),chunks:Buffer[]=[];for await(const chunk of req)chunks.push(Buffer.from(chunk));const body=Buffer.concat(chunks)
  if(url.pathname==='/json'){res.setHeader('content-type','application/json');res.end(JSON.stringify({ok:true,query:[...url.searchParams]}));return}
  if(url.pathname==='/echo-json'){res.setHeader('content-type','application/json');res.end(body);return}
  if(url.pathname==='/text'){res.setHeader('content-type','text/plain');res.end('hello');return}
  if(url.pathname==='/html'){res.setHeader('content-type','text/html');res.end('<h1>safe text</h1>');return}
  if(url.pathname==='/xml'){res.setHeader('content-type','application/xml');res.end('<root/>');return}
  if(url.pathname==='/binary'){res.setHeader('content-type','application/octet-stream');res.end(Buffer.from([0,1,2,3]));return}
  if(url.pathname==='/empty'){res.statusCode=204;res.end();return}
  if(url.pathname.startsWith('/status/')){res.statusCode=Number(url.pathname.split('/').pop());res.end('status');return}
  if(url.pathname.startsWith('/delay/')){setTimeout(()=>res.end('late'),Number(url.pathname.split('/').pop()));return}
  if(url.pathname.startsWith('/large/')){res.end(Buffer.alloc(Number(url.pathname.split('/').pop()),65));return}
  res.statusCode=404;res.end('missing')})
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const address=server.address();if(!address||typeof address==='string')throw new Error('Mock server failed')
 return {baseUrl:`http://127.0.0.1:${address.port}`,close:()=>new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()))}
}
