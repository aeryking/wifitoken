// Local test only. No network services or credentials are used.
import http from 'node:http';
http.createServer(async(req,res)=>{
  if(req.url!=='/v1/chat/completions'||req.method!=='POST'){res.writeHead(404);return res.end();}
  let raw=''; for await(const chunk of req) raw+=chunk;
  const body=JSON.parse(raw);
  const usage={prompt_tokens:10,completion_tokens:8,total_tokens:18,prompt_cache_hit_tokens:0,prompt_cache_miss_tokens:10};
  if(body.stream){res.writeHead(200,{'content-type':'text/event-stream'});res.write('data: '+JSON.stringify({choices:[{delta:{content:'模拟响应'}}]})+'\n\n');res.write('data: '+JSON.stringify({choices:[],usage})+'\n\n');return res.end('data: [DONE]\n\n');}
  res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({id:'mock',choices:[{message:{role:'assistant',content:'模拟响应'}}],usage}));
}).listen(19181,'127.0.0.1',()=>console.log('mock upstream ready'));
